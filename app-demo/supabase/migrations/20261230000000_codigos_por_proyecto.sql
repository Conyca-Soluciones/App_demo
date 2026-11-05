-- Códigos por proyecto (decisión del usuario, 2026-11-05).
-- * Cada proyecto tiene un NÚMERO de 3 dígitos (001, 002...): al crearlo se le
--   da el siguiente libre; se puede cambiar a uno que no tenga otro proyecto,
--   pero no después de que el proyecto tenga órdenes, contratos o pagos con REF
--   (esos documentos ya salieron con el número).
-- * Órdenes de compra: `numero` pasa a ser el consecutivo DEL PROYECTO y
--   `codigo` = 'OC-001-0001'. Contratos: igual, `codigo` = 'CJ-001-0001',
--   desde la solicitud; al aprobar la minuta numero_contrato = codigo (antes
--   'CJ-<solicitud>-<año>'). Contadores en `contadores_proyecto` (una fila por
--   proyecto y tipo: rápido). El código se guarda y no cambia nunca.
-- * Los textos de la base (Mis pendientes, avisos, auditoría, verificar
--   documento, concepto del pago) usan el código. Parches por texto exacto
--   sobre las funciones VIVAS (falla si no encuentra el texto).
-- Se puede correr dos veces. Va después de 20261229000000.

-- ---------------------------------------------------------------- utilidades
create table if not exists public.contadores_proyecto (
  proyecto_id uuid not null references public.proyectos(id) on delete cascade,
  tipo text not null check (tipo in ('oc', 'contrato', 'pago')),
  ultimo integer not null,
  primary key (proyecto_id, tipo)
);
alter table public.contadores_proyecto enable row level security;

-- n con al menos d dígitos (sin cortar si pasa de d).
create or replace function public._con_ceros(n bigint, d integer)
returns text language sql immutable set search_path = public
as $$ select case when length(n::text) >= d then n::text else lpad(n::text, d, '0') end $$;

-- Siguiente consecutivo del proyecto para ese tipo.
create or replace function public._siguiente_consecutivo(p_proyecto_id uuid, p_tipo text)
returns integer language plpgsql security definer set search_path = public
as $$
declare v integer;
begin
  insert into public.contadores_proyecto as c (proyecto_id, tipo, ultimo)
  values (p_proyecto_id, p_tipo, 1)
  on conflict (proyecto_id, tipo) do update set ultimo = c.ultimo + 1
  returning c.ultimo into v;
  return v;
end;
$$;
revoke all on function public._siguiente_consecutivo(uuid, text) from public, anon, authenticated;


-- ------------------------------------------------------- número del proyecto
alter table public.proyectos add column if not exists numero smallint;
update public.proyectos p set numero = x.n
  from (select id, row_number() over (order by created_at, id) as n from public.proyectos) x
 where x.id = p.id and p.numero is null;
alter table public.proyectos alter column numero set not null;
alter table public.proyectos drop constraint if exists proyectos_numero_rango;
alter table public.proyectos add constraint proyectos_numero_rango check (numero between 1 and 999);
create unique index if not exists proyectos_numero_unico on public.proyectos (numero);

-- (Después de crear la columna: una función SQL revisa sus columnas al crearse.)
create or replace function public._numero_proyecto(p_proyecto_id uuid)
returns text language sql stable security definer set search_path = public
as $$ select public._con_ceros(numero, 3) from public.proyectos where id = p_proyecto_id $$;
revoke all on function public._numero_proyecto(uuid) from public, anon;
grant execute on function public._numero_proyecto(uuid) to authenticated;

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
       or exists (select 1 from public.pagos where proyecto_id = new.id and referencia is not null) then
      raise exception 'El proyecto ya tiene órdenes, contratos o pagos con su número (%): ya no se le cambia.', public._con_ceros(old.numero, 3);
    end if;
  end if;
  if exists (select 1 from public.proyectos where numero = new.numero and id <> new.id) then
    raise exception 'El número % ya lo tiene otro proyecto.', public._con_ceros(new.numero, 3);
  end if;
  return new;
end;
$$;

-- (pagos.referencia la crea la parte B; si todavía no existe, se crea aquí vacía.)
alter table public.pagos add column if not exists referencia text;

drop trigger if exists trg_proyecto_numero on public.proyectos;
create trigger trg_proyecto_numero before insert or update of numero on public.proyectos
  for each row execute function public._proyecto_numero();

-- ------------------------------------------------------- órdenes de compra
alter table public.ordenes_compra add column if not exists codigo text;
alter table public.ordenes_compra alter column numero drop default;
alter table public.ordenes_compra drop constraint if exists ordenes_compra_numero_key;

-- Las que ya existan: consecutivo por proyecto en orden de creación.
update public.ordenes_compra o set numero = x.n,
       codigo = 'OC-' || public._con_ceros(p.numero, 3) || '-' || public._con_ceros(x.n, 4)
  from (select id, row_number() over (partition by proyecto_id order by created_at, id) as n
          from public.ordenes_compra) x, public.proyectos p
 where x.id = o.id and p.id = o.proyecto_id and o.codigo is null;
insert into public.contadores_proyecto (proyecto_id, tipo, ultimo)
select proyecto_id, 'oc', max(numero) from public.ordenes_compra group by proyecto_id
on conflict (proyecto_id, tipo) do update set ultimo = greatest(contadores_proyecto.ultimo, excluded.ultimo);

alter table public.ordenes_compra alter column codigo set not null;
create unique index if not exists ordenes_compra_codigo_unico on public.ordenes_compra (codigo);
create unique index if not exists ordenes_compra_proyecto_numero on public.ordenes_compra (proyecto_id, numero);

create or replace function public._oc_codigo()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.numero := public._siguiente_consecutivo(new.proyecto_id, 'oc');
  new.codigo := 'OC-' || public._numero_proyecto(new.proyecto_id) || '-' || public._con_ceros(new.numero, 4);
  return new;
end;
$$;
revoke all on function public._oc_codigo() from public, anon, authenticated;
drop trigger if exists trg_oc_codigo on public.ordenes_compra;
create trigger trg_oc_codigo before insert on public.ordenes_compra
  for each row execute function public._oc_codigo();

-- ---------------------------------------------------------------- contratos
alter table public.contratos add column if not exists codigo text;
alter table public.contratos alter column numero drop identity if exists;
alter table public.contratos drop constraint if exists contratos_numero_key;

update public.contratos c set numero = x.n,
       codigo = 'CJ-' || public._con_ceros(p.numero, 3) || '-' || public._con_ceros(x.n, 4)
  from (select id, row_number() over (partition by proyecto_id order by created_at, id) as n
          from public.contratos) x, public.proyectos p
 where x.id = c.id and p.id = c.proyecto_id and c.codigo is null;
update public.contratos set numero_contrato = codigo where numero_contrato is not null and numero_contrato <> codigo;
insert into public.contadores_proyecto (proyecto_id, tipo, ultimo)
select proyecto_id, 'contrato', max(numero) from public.contratos group by proyecto_id
on conflict (proyecto_id, tipo) do update set ultimo = greatest(contadores_proyecto.ultimo, excluded.ultimo);

alter table public.contratos alter column codigo set not null;
create unique index if not exists contratos_codigo_unico on public.contratos (codigo);
create unique index if not exists contratos_proyecto_numero on public.contratos (proyecto_id, numero);

-- Mismo disparador de antes (BEFORE INSERT OR UPDATE OF estado, minuta_estado):
-- al crear, el consecutivo y el código; al aprobar la minuta, el número del
-- contrato es el mismo código.
create or replace function public._asignar_numero_contrato()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.numero := public._siguiente_consecutivo(new.proyecto_id, 'contrato');
    new.codigo := 'CJ-' || public._numero_proyecto(new.proyecto_id) || '-' || public._con_ceros(new.numero, 4);
  end if;
  if new.estado = 'aprobada' and new.minuta_estado = 'aprobada' and new.numero_contrato is null then
    new.numero_contrato := new.codigo;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------- textos de la base: códigos
do $$
declare
  d text;
  n text;
  i int;
  -- [función, texto, reemplazo] (reemplaza todas las veces que aparece)
  p text[][] := array[
    ['public._pendientes_de(uuid)', '''OC N° '' || o.numero', 'o.codigo'],
    ['public._pendientes_de(uuid)', '''Solicitud N° '' || c.numero', 'c.codigo'],
    ['public._pendientes_de(uuid)', '''N° '' || c.numero', 'c.codigo'],
    ['public.listar_auditoria(text, uuid, date, date, integer, integer)', ''' · OC '' || o.numero', ''' · '' || o.codigo'],
    ['public.listar_auditoria(text, uuid, date, date, integer, integer)', '''OC '' || o.numero', 'o.codigo'],
    ['public.listar_auditoria(text, uuid, date, date, integer, integer)', '''Solicitud N° '' || c.numero', 'c.codigo'],
    ['public._aprobar_acta(uuid, uuid, uuid)', '''Solicitud N° '' || c.numero', 'c.codigo'],
    ['public._rechazar_acta(uuid, uuid, text)', '''Solicitud N° '' || c.numero', 'c.codigo'],
    ['public._pago_de_acta(uuid)', '''Solicitud N° '' || c.numero', 'c.codigo'],
    ['public._fila_contrato_poliza(uuid)', '''Solicitud N° '' || c.numero', 'c.codigo'],
    ['public.verificar_documento(text, text)', '''Solicitud N° '' || c.numero', 'c.codigo'],
    ['public.verificar_documento(text, text)', '''Orden de compra N° '' || o.numero', '''Orden de compra '' || o.codigo'],
    ['public._avisar_contratos_vencidos()', '''N° '' || c.numero', 'c.codigo'],
    ['public.subir_poliza(uuid, text, text, bigint, text)', '''N° '' || c.numero', 'c.codigo'],
    ['public._avisar_poliza_pendiente()', '''N° '' || new.numero', 'new.codigo'],
    ['public._crear_pagos_orden(uuid)', '''ORDEN DE COMPRA N° '' || v_oc.numero', '''ORDEN DE COMPRA '' || (select codigo from public.ordenes_compra where id = p_orden_id)'],
    ['public.notificar_insumo_sobre_presupuesto()', 'Orden de compra #'' || new.numero', 'Orden de compra '' || new.codigo'],
    ['public.notificar_resolucion_oc()', '''La orden de compra #'' || new.numero', '''La orden de compra '' || new.codigo'],
    ['public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)', '''Solicitud N° '' || v_numero', '''Solicitud '' || (select codigo from public.contratos where id = p_id)'],
    ['public._guardar_contrato_general(uuid, jsonb, jsonb, boolean)', '''Contrato general N° '' || v_numero', '''Contrato general '' || (select codigo from public.contratos where id = p_id)'],
    ['public.enviar_minuta_contrato(uuid, jsonb)', '''Minuta de la solicitud N° '' || v.numero', '''Minuta del contrato '' || (select codigo from public.contratos where id = v.id)'],
    ['public.resolver_minuta_contrato(uuid, text, text)', '''Minuta de la solicitud N° '' || v.numero || '' aprobada por Subgerencia. Contrato '' || v_numero_contrato || ''.''', '''Minuta del contrato '' || v_numero_contrato || '' aprobada por Subgerencia.'''],
    ['public.resolver_minuta_contrato(uuid, text, text)', '''Minuta de la solicitud N° '' || v.numero', '''Minuta del contrato '' || (select codigo from public.contratos where id = v.id)'],
    ['public.resolver_minuta_contrato(uuid, text, text)', ''' (solicitud N° '' || v.numero || ''): minuta', ''': minuta'],
    ['public.resolver_solicitud_contrato(uuid, text, text)', '''Solicitud N° '' || v.numero', '''Solicitud '' || (select codigo from public.contratos where id = v.id)'],
    ['public.contrato_para_ver_otrosi(uuid)', '''numero'', c.numero, ''numero_contrato''', '''numero'', c.numero, ''codigo'', c.codigo, ''numero_contrato''']
  ];
begin
  for i in 1 .. array_length(p, 1) loop
    d := pg_get_functiondef(p[i][1]::regprocedure);
    if position(p[i][2] in d) = 0 then
      if position(p[i][3] in d) > 0 then
        continue;  -- ya aplicado
      end if;
      raise exception '% no tiene el texto esperado: %', p[i][1], p[i][2];
    end if;
    n := replace(d, p[i][2], p[i][3]);
    execute n;
  end loop;
end $$;

-- ------------------------------------- listas que devuelven el código también
do $$
declare
  d text;
  f regprocedure := 'public.listar_ordenes_entradas(uuid, integer, text, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer)'::regprocedure;
begin
  d := pg_get_functiondef(f);
  if position('codigo text' in d) = 0 then
    if position('RETURNS TABLE(id uuid, numero integer, estado_entrega text' in d) = 0
       or position('    o.numero::integer,' in d) = 0 or position('  order by o.numero desc' in d) = 0 then
      raise exception 'listar_ordenes_entradas no tiene el texto esperado.';
    end if;
    d := replace(d, 'RETURNS TABLE(id uuid, numero integer, estado_entrega text', 'RETURNS TABLE(id uuid, numero integer, codigo text, estado_entrega text');
    d := replace(d, '    o.numero::integer,', '    o.numero::integer, o.codigo,');
    d := replace(d, '  order by o.numero desc', '  order by o.created_at desc');
    execute format('drop function %s', f);
    execute d;
  end if;

  d := pg_get_functiondef('public._detalle_orden_para_entrada(uuid)'::regprocedure);
  if position('''codigo'', v_orden.codigo' in d) = 0 then
    if position('select o.id, o.numero, o.estado, o.estado_entrega,' in d) = 0 or position('''numero'', v_orden.numero,' in d) = 0 then
      raise exception '_detalle_orden_para_entrada no tiene el texto esperado.';
    end if;
    d := replace(d, 'select o.id, o.numero, o.estado, o.estado_entrega,', 'select o.id, o.numero, o.codigo, o.estado, o.estado_entrega,');
    d := replace(d, '''numero'', v_orden.numero,', '''numero'', v_orden.numero, ''codigo'', v_orden.codigo,');
    execute d;
  end if;

  d := pg_get_functiondef('public.control_proyecto(uuid)'::regprocedure);
  if position('''codigo'', codigo' in d) = 0 then
    if position('select c.id, c.numero, c.numero_contrato,' in d) = 0 or position('''numero'', numero, ''numero_contrato''' in d) = 0 then
      raise exception 'control_proyecto no tiene el texto esperado.';
    end if;
    d := replace(d, 'select c.id, c.numero, c.numero_contrato,', 'select c.id, c.numero, c.codigo, c.numero_contrato,');
    d := replace(d, '''numero'', numero, ''numero_contrato''', '''numero'', numero, ''codigo'', codigo, ''numero_contrato''');
    execute d;
  end if;
end $$;
revoke all on function public.listar_ordenes_entradas(uuid, integer, text, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) from public, anon;
grant execute on function public.listar_ordenes_entradas(uuid, integer, text, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer) to authenticated;
