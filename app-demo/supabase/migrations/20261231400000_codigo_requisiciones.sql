-- Requisiciones con código por proyecto (decisión del usuario, 2026-11-06):
-- RQ-001-0001, igual que OC-001-0001 y CJ-001-0001 (20261230000000).
-- `requisiciones.numero` pasa a ser el consecutivo DEL PROYECTO y `codigo`
-- guarda el texto (no cambia nunca). Vale para normales, extraordinarias y
-- administrativas (todas son filas de `requisiciones`). Los textos de la base
-- (Mis pendientes, avisos, auditoría) usan el código; parches por texto exacto
-- sobre las funciones VIVAS. Se puede correr dos veces. Va después de
-- 20261231300000.

alter table public.contadores_proyecto drop constraint if exists contadores_proyecto_tipo_check;
alter table public.contadores_proyecto add constraint contadores_proyecto_tipo_check
  check (tipo in ('oc', 'contrato', 'pago', 'requisicion'));

alter table public.requisiciones add column if not exists codigo text;
alter table public.requisiciones alter column numero drop default;
alter table public.requisiciones drop constraint if exists requisiciones_numero_key;

-- Las que ya existen: consecutivo por proyecto en orden de creación.
update public.requisiciones q set numero = x.n,
       codigo = 'RQ-' || public._con_ceros(p.numero, 3) || '-' || public._con_ceros(x.n, 4)
  from (select id, row_number() over (partition by proyecto_id order by created_at, id) as n
          from public.requisiciones) x, public.proyectos p
 where x.id = q.id and p.id = q.proyecto_id and q.codigo is null;
insert into public.contadores_proyecto (proyecto_id, tipo, ultimo)
select proyecto_id, 'requisicion', max(numero) from public.requisiciones group by proyecto_id
on conflict (proyecto_id, tipo) do update set ultimo = greatest(contadores_proyecto.ultimo, excluded.ultimo);

alter table public.requisiciones alter column codigo set not null;
create unique index if not exists requisiciones_codigo_unico on public.requisiciones (codigo);
create unique index if not exists requisiciones_proyecto_numero on public.requisiciones (proyecto_id, numero);

create or replace function public._requisicion_codigo()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.numero := public._siguiente_consecutivo(new.proyecto_id, 'requisicion');
  new.codigo := 'RQ-' || public._numero_proyecto(new.proyecto_id) || '-' || public._con_ceros(new.numero, 4);
  return new;
end;
$$;
revoke all on function public._requisicion_codigo() from public, anon, authenticated;
drop trigger if exists trg_requisicion_codigo on public.requisiciones;
create trigger trg_requisicion_codigo before insert on public.requisiciones
  for each row execute function public._requisicion_codigo();

-- Un proyecto con requisiciones ya no cambia de número (como con OC y contratos).
create or replace function public._proyecto_numero()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.numero is null then
      select coalesce(max(numero), 0) + 1 into new.numero from public.proyectos;
    end if;
  elsif new.numero is distinct from old.numero then
    if exists (select 1 from public.ordenes_compra where proyecto_id = new.id)
       or exists (select 1 from public.contratos where proyecto_id = new.id)
       or exists (select 1 from public.requisiciones where proyecto_id = new.id)
       or exists (select 1 from public.pagos where proyecto_id = new.id and referencia is not null) then
      raise exception 'El proyecto ya tiene requisiciones, órdenes, contratos o pagos con su número (%): ya no se le cambia.', public._con_ceros(old.numero, 3);
    end if;
  end if;
  if exists (select 1 from public.proyectos where numero = new.numero and id <> new.id) then
    raise exception 'El número % ya lo tiene otro proyecto.', public._con_ceros(new.numero, 3);
  end if;
  return new;
end;
$$;

-- La vista del registro: el código al final (mismas columnas de antes).
create or replace view public.requisiciones_vista with (security_invoker = true) as
 SELECT r.id,
    r.numero,
    r.proyecto_id,
    pr.codigo AS proyecto_codigo,
    pr.nombre AS proyecto_nombre,
    r.solicitado_por,
    pf.nombre AS solicitante_nombre,
    r.fecha_requerida,
    r.urgente,
    r.observaciones,
    r.soporte_url,
    r.created_at,
    r.n_lineas,
    r.estado,
    r.estado_compra,
    r.extraordinaria,
    r.justificacion,
    r.codigo
   FROM ((requisiciones r
     LEFT JOIN proyectos pr ON ((pr.id = r.proyecto_id)))
     LEFT JOIN perfiles pf ON ((pf.id = r.solicitado_por)));

-- ------------------------------------------------- textos de la base: código
do $$
declare
  d text;
  i int;
  c text := '(select codigo from public.requisiciones where id = v_id)';
  p text[][] := array[
    ['public._pendientes_de(uuid)', '''Requisición extraordinaria N° '' || r.numero', '''Requisición extraordinaria '' || r.codigo'],
    ['public._pendientes_de(uuid)', '''Requisición N° '' || r.numero', '''Requisición '' || r.codigo'],
    ['public.listar_auditoria(text, uuid, date, date, integer, integer)', '''Requisición '' || q.numero', '''Requisición '' || q.codigo'],
    ['public.crear_requisicion()', 'return jsonb_build_object(''id'', v_id, ''numero'', v_numero);', 'return jsonb_build_object(''id'', v_id, ''numero'', v_numero, ''codigo'', ' || c || ');'],
    ['public.crear_requisicion_extraordinaria()', '''Requisición extraordinaria #'' || v_numero', '''Requisición extraordinaria '' || ' || c],
    ['public.crear_requisicion_extraordinaria()', 'return jsonb_build_object(''id'', v_id, ''numero'', v_numero);', 'return jsonb_build_object(''id'', v_id, ''numero'', v_numero, ''codigo'', ' || c || ');'],
    ['public.crear_requisicion_administrativa()', '''Requisición #'' || v_numero', '''Requisición '' || ' || c],
    ['public.crear_requisicion_administrativa()', 'return jsonb_build_object(''id'', v_id, ''numero'', v_numero);', 'return jsonb_build_object(''id'', v_id, ''numero'', v_numero, ''codigo'', ' || c || ');'],
    ['public.notificar_resolucion_pedido()', ''') de tu requisición #'' || coalesce(v_numero::text, ''?'')', ''') de tu requisición '' || coalesce((select codigo from public.requisiciones where id = new.grupo_pedido_id), ''?'')'],
    ['public.listar_requisiciones_extraordinarias()', '''numero'', pg.numero,', '''numero'', pg.numero, ''codigo'', (select codigo from public.requisiciones where id = pg.id),'],
    ['public.listar_requisiciones_administrativas()', '''numero'', r.numero,', '''numero'', r.numero, ''codigo'', (select codigo from public.requisiciones where id = r.id),'],
    ['public.detalle_requisicion_administrativa()', '''numero'', v_r.numero,', '''numero'', v_r.numero, ''codigo'', v_r.codigo,']
  ];
  f regprocedure;
begin
  for i in 1 .. array_length(p, 1) loop
    -- La firma de cada una se busca por nombre (algunas tienen varios parámetros).
    select oid::regprocedure into f from pg_proc
     where pronamespace = 'public'::regnamespace and proname = split_part(replace(p[i][1], 'public.', ''), '(', 1)
     order by oid limit 1;
    if f is null then
      raise exception 'No existe la función %.', p[i][1];
    end if;
    d := pg_get_functiondef(f);
    if position(p[i][2] in d) = 0 then
      if position(p[i][3] in d) > 0 then
        continue;  -- ya aplicado
      end if;
      raise exception '% no tiene el texto esperado: %', f, p[i][2];
    end if;
    execute replace(d, p[i][2], p[i][3]);
  end loop;
end $$;
