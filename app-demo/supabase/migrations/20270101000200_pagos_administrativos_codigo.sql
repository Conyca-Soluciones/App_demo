-- Pagos administrativos (decisiones del usuario, 2026-11-11).
--
-- 1. Cada pago (ítem del cuadro) tiene su código con el proyecto del ítem, como
--    RQ / OC / CJ: requisicion_admin_items.codigo = 'PA-001-0001' (consecutivo
--    del proyecto, contador tipo 'pago_admin'). Se da al guardar el cuadro; al
--    modificarlo, el ítem que sigue en la misma posición y con el mismo proyecto
--    conserva su código (los ítems se borran y se vuelven a crear). Los ítems que
--    ya existían reciben su código aquí (en orden de creación).
-- 2. Aprobación de pagos: el cuadro se sigue aprobando completo, pero
--    lote_requisicion_admin trae el desglose (código, quien factura, concepto,
--    proyecto, valor) para mostrarlo.
-- 3. detalle_requisicion_admin y listar_requisiciones_admin traen los códigos.
--
-- Parches por texto exacto sobre la versión viva (fallan si no encuentran el
-- texto, no hacen nada si ya están). Se puede correr dos veces. Reversa en
-- supabase/reversa/20270101000200_pagos_administrativos_codigo.sql.

begin;

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_b in d) > 0 then
    return;
  end if;
  if position(p_a in d) = 0 then
    raise exception '% no tiene el texto esperado: %', p_fn, left(p_a, 120);
  end if;
  execute replace(d, p_a, p_b);
end;
$$;

-- 1. Código de cada pago -------------------------------------------------------
alter table public.contadores_proyecto drop constraint if exists contadores_proyecto_tipo_check;
alter table public.contadores_proyecto add constraint contadores_proyecto_tipo_check
  check (tipo = any (array['oc', 'contrato', 'pago', 'requisicion', 'pago_admin']));

alter table public.requisicion_admin_items add column if not exists codigo text;
create unique index if not exists requisicion_admin_items_codigo_key on public.requisicion_admin_items (codigo);

create or replace function public._codigo_pago_admin(p_proyecto_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  select 'PA-' || public._numero_proyecto(p_proyecto_id) || '-'
         || public._con_ceros(public._siguiente_consecutivo(p_proyecto_id, 'pago_admin'), 4)
$$;
revoke all on function public._codigo_pago_admin(uuid) from public, anon, authenticated;

-- Los que ya existen, en orden de creación.
do $$
declare
  v record;
begin
  for v in
    select i.id, i.proyecto_id
      from public.requisicion_admin_items i
      join public.requisiciones_admin r on r.id = i.requisicion_id
     where i.codigo is null
     order by r.creado_en, r.id, i.orden
  loop
    update public.requisicion_admin_items set codigo = public._codigo_pago_admin(v.proyecto_id) where id = v.id;
  end loop;
end $$;

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$  v_metodo text;
begin$a$,
  $b$  v_metodo text;
  v_viejos jsonb;
  v_codigo text;
begin$b$);

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$  delete from public.requisicion_admin_items where requisicion_id = p_id;$a$,
  $b$  -- Códigos de antes (PA-001-0001): los conserva el ítem que sigue en la misma
  -- posición y con el mismo proyecto.
  select jsonb_object_agg(i.orden || ':' || i.proyecto_id, i.codigo) into v_viejos
    from public.requisicion_admin_items i
   where i.requisicion_id = p_id and i.codigo is not null;
  delete from public.requisicion_admin_items where requisicion_id = p_id;$b$);

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$    perform public._validar_soporte_req_admin(v_it -> 'soporte', v_fila);$a$,
  $b$    perform public._validar_soporte_req_admin(v_it -> 'soporte', v_fila);
    v_codigo := v_viejos ->> (v_n || ':' || v_proyecto);
    if v_codigo is null then
      v_codigo := public._codigo_pago_admin(v_proyecto);
    end if;$b$);

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$      concepto, proyecto_id, valor, observaciones, soporte_ruta, soporte_nombre, soporte_mime, soporte_tamano, soporte_tipo)$a$,
  $b$      concepto, proyecto_id, valor, observaciones, soporte_ruta, soporte_nombre, soporte_mime, soporte_tamano, soporte_tipo, codigo)$b$);

select pg_temp._parche('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $a$      case when nullif(btrim(coalesce(v_it -> 'soporte' ->> 'ruta', '')), '') is not null then v_it -> 'soporte' ->> 'tipo' end);$a$,
  $b$      case when nullif(btrim(coalesce(v_it -> 'soporte' ->> 'ruta', '')), '') is not null then v_it -> 'soporte' ->> 'tipo' end,
      v_codigo);$b$);

-- 2. Desglose del cuadro en Aprobación de pagos --------------------------------
create or replace function public.lote_requisicion_admin(p pagos)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select case when p.requisicion_admin_lote is null then null else
    (select jsonb_build_object(
              'items', count(*),
              'total', coalesce(sum(g.valor), 0),
              'detalle', coalesce(jsonb_agg(jsonb_build_object(
                           'pago_id', g.id,
                           'codigo', i.codigo,
                           'factura', coalesce(i.factura_nombre, t.razon_social),
                           'concepto', i.concepto,
                           'proyecto', pr.codigo,
                           'valor', g.valor,
                           'metodo', i.metodo
                         ) order by i.orden, g.id), '[]'::jsonb))
       from public.pagos g
       left join public.requisicion_admin_items i on i.id = g.requisicion_admin_item_id
       left join public.terceros t on t.id = g.tercero_id
       left join public.proyectos pr on pr.id = g.proyecto_id
      where g.requisicion_admin_lote = p.requisicion_admin_lote) end
$$;

-- 3. Códigos en el detalle y en la lista ------------------------------------------
select pg_temp._parche('public.detalle_requisicion_admin(uuid)'::regprocedure,
  $a$               'id', i.id, 'orden', i.orden, 'metodo', i.metodo,$a$,
  $b$               'id', i.id, 'orden', i.orden, 'metodo', i.metodo, 'codigo', i.codigo,$b$);

select pg_temp._parche('public.listar_requisiciones_admin(boolean,text,integer,integer,integer)'::regprocedure,
  $a$             'motivo_rechazo', r.motivo_rechazo,
$a$,
  $b$             'motivo_rechazo', r.motivo_rechazo,
             'codigos', (select coalesce(jsonb_agg(i.codigo order by i.orden), '[]'::jsonb)
                           from public.requisicion_admin_items i where i.requisicion_id = r.id),
$b$);

commit;
