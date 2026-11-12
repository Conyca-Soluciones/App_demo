-- Reversa de 20270101000200_pagos_administrativos_codigo.sql.
-- Deshace los parches y el desglose. La columna requisicion_admin_items.codigo
-- y el contador 'pago_admin' se dejan (borrarlos perdería los códigos dados).

begin;

create or replace function pg_temp._deshacer(p_fn regprocedure, p_nuevo text, p_viejo text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_nuevo := replace(p_nuevo, E'\r\n', E'\n');
  p_viejo := replace(p_viejo, E'\r\n', E'\n');
  if position(p_nuevo in d) = 0 then
    return;
  end if;
  execute replace(d, p_nuevo, p_viejo);
end;
$$;

select pg_temp._deshacer('public.listar_requisiciones_admin(boolean,text,integer,integer,integer)'::regprocedure,
  $b$             'codigos', (select coalesce(jsonb_agg(i.codigo order by i.orden), '[]'::jsonb)
                           from public.requisicion_admin_items i where i.requisicion_id = r.id),
$b$, '');
select pg_temp._deshacer('public.detalle_requisicion_admin(uuid)'::regprocedure,
  $b$ 'codigo', i.codigo,$b$, '');

create or replace function public.lote_requisicion_admin(p pagos)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select case when p.requisicion_admin_lote is null then null else
    (select jsonb_build_object('items', count(*), 'total', coalesce(sum(g.valor), 0))
       from public.pagos g where g.requisicion_admin_lote = p.requisicion_admin_lote) end
$$;

select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$,
      v_codigo);$b$, ');');
select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$soporte_tamano, soporte_tipo, codigo)$b$, 'soporte_tamano, soporte_tipo)');
select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$
    v_codigo := v_viejos ->> (v_n || ':' || v_proyecto);
    if v_codigo is null then
      v_codigo := public._codigo_pago_admin(v_proyecto);
    end if;$b$, '');
select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$  -- Códigos de antes (PA-001-0001): los conserva el ítem que sigue en la misma
  -- posición y con el mismo proyecto.
  select jsonb_object_agg(i.orden || ':' || i.proyecto_id, i.codigo) into v_viejos
    from public.requisicion_admin_items i
   where i.requisicion_id = p_id and i.codigo is not null;
$b$, '');
select pg_temp._deshacer('public._guardar_requisicion_admin(uuid,text,jsonb)'::regprocedure,
  $b$
  v_viejos jsonb;
  v_codigo text;$b$, '');

commit;
