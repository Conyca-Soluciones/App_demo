-- Borrar del maestro los insumos con IVA dudoso (decisión del usuario,
-- 2026-10-15). Se quedan solo los 868 cuyo historial de compras es todo al
-- 19 % y ya quedaron con el IVA bien (grupos G1 y G2 de
-- 20261114100000_maestro_iva_doble.sql). Los demás (911: IVA dudoso, mezclas,
-- 0 %, 5 %, precio que no coincide y sin historial) se borran; si después hace
-- falta uno, se vuelve a crear bien.
--
-- Decisiones del usuario sobre lo que cuelga de esos insumos:
--   * Las líneas de APU que los usan se borran y se recalcula el valor de sus
--     ítems (Malecón y Estuario Casa).
--   * Las requisiciones que los usan se borran (solo esas líneas; la
--     requisición entera si se queda sin líneas), y las órdenes de compra de
--     prueba que las compraban (OC 44 y 49) se borran completas con sus
--     entradas y pagos.
--   * Se borra todo lo que involucre esos insumos: historial de compras,
--     requisiciones, órdenes de compra, entradas y salidas de almacén.
--   * La revisión del import que tenía uno de esos insumos asignado vuelve a
--     "pendiente", y se quitan de los candidatos de todas las líneas.
-- Todo lo borrado queda copiado (como jsonb) en respaldo_borrado_20261015, sin
-- acceso por la API.

-- ---------------------------------------------------------------- respaldo
create table if not exists public.respaldo_borrado_20261015 (
  tabla text not null,
  id uuid not null,
  datos jsonb not null,
  borrado_at timestamptz not null default now(),
  primary key (tabla, id)
);
alter table public.respaldo_borrado_20261015 enable row level security;
revoke all on public.respaldo_borrado_20261015 from anon, authenticated;

-- Insumos a borrar: todo el maestro menos G1 y G2.
create table if not exists public._insumos_a_borrar_20261015 (id uuid primary key);
alter table public._insumos_a_borrar_20261015 enable row level security;
revoke all on public._insumos_a_borrar_20261015 from anon, authenticated;
insert into public._insumos_a_borrar_20261015 (id)
select mi.id from public.maestro_insumos mi
where mi.id not in (select r.id from public.maestro_insumos_respaldo_iva_20261015 r where r.grupo in ('G1', 'G2'))
on conflict do nothing;

-- Órdenes de compra que compraban requisiciones de esos insumos (OC 44 y 49).
create table if not exists public._oc_a_borrar_20261015 (id uuid primary key);
alter table public._oc_a_borrar_20261015 enable row level security;
revoke all on public._oc_a_borrar_20261015 from anon, authenticated;
insert into public._oc_a_borrar_20261015 (id)
select distinct oci.orden_compra_id
from public.ordenes_compra_items oci
join public.pedidos_insumos pe on pe.id = oci.pedido_insumo_id
where pe.insumo_id in (select id from public._insumos_a_borrar_20261015)
on conflict do nothing;

insert into public.respaldo_borrado_20261015 (tabla, id, datos)
select 'maestro_insumos', mi.id, to_jsonb(mi) from public.maestro_insumos mi
where mi.id in (select id from public._insumos_a_borrar_20261015)
union all
select 'ordenes_compra', oc.id, to_jsonb(oc) from public.ordenes_compra oc where oc.id in (select id from public._oc_a_borrar_20261015)
union all
select 'ordenes_compra_items', oci.id, to_jsonb(oci) from public.ordenes_compra_items oci where oci.orden_compra_id in (select id from public._oc_a_borrar_20261015)
union all
select 'entradas_almacen', e.id, to_jsonb(e) from public.entradas_almacen e where e.orden_compra_id in (select id from public._oc_a_borrar_20261015)
union all
select 'entradas_almacen_items', ei.id, to_jsonb(ei) from public.entradas_almacen_items ei
  join public.entradas_almacen e on e.id = ei.entrada_id where e.orden_compra_id in (select id from public._oc_a_borrar_20261015)
union all
select 'pagos', p.id, to_jsonb(p) from public.pagos p where p.orden_compra_id in (select id from public._oc_a_borrar_20261015)
union all
select 'pedidos_insumos', pe.id, to_jsonb(pe) from public.pedidos_insumos pe where pe.insumo_id in (select id from public._insumos_a_borrar_20261015)
union all
select 'item_apu', ia.id, to_jsonb(ia) from public.item_apu ia where ia.insumo_id in (select id from public._insumos_a_borrar_20261015)
union all
select 'historico_precios_compra', h.id, to_jsonb(h) from public.historico_precios_compra h where h.insumo_id in (select id from public._insumos_a_borrar_20261015)
union all
select 'salidas_insumos', si.id, to_jsonb(si) from public.salidas_insumos si where si.insumo_id in (select id from public._insumos_a_borrar_20261015)
on conflict do nothing;

-- ---------------------------------------------------------------- órdenes de compra de prueba
delete from public.pagos where orden_compra_id in (select id from public._oc_a_borrar_20261015);
delete from public.entradas_almacen where orden_compra_id in (select id from public._oc_a_borrar_20261015); -- sus líneas en cascada
update public.pedidos_insumos set orden_compra_id = null where orden_compra_id in (select id from public._oc_a_borrar_20261015);
delete from public.notificaciones where entidad_tipo = 'orden_compra' and entidad_id in (select id from public._oc_a_borrar_20261015);
delete from public.ordenes_compra where id in (select id from public._oc_a_borrar_20261015); -- líneas en cascada

-- ---------------------------------------------------------------- salidas de almacén
delete from public.salidas_insumos where insumo_id in (select id from public._insumos_a_borrar_20261015);

-- ---------------------------------------------------------------- requisiciones
delete from public.pedidos_insumos where insumo_id in (select id from public._insumos_a_borrar_20261015);

-- Requisiciones que se quedaron sin líneas.
insert into public.respaldo_borrado_20261015 (tabla, id, datos)
select 'requisiciones', r.id, to_jsonb(r) from public.requisiciones r
where not exists (select 1 from public.pedidos_insumos pe where pe.grupo_pedido_id = r.id)
  and exists (select 1 from public.respaldo_borrado_20261015 b
              where b.tabla = 'pedidos_insumos' and (b.datos->>'grupo_pedido_id')::uuid = r.id)
on conflict do nothing;
delete from public.notificaciones
 where entidad_tipo = 'requisicion'
   and entidad_id in (select id from public.respaldo_borrado_20261015 where tabla = 'requisiciones');
delete from public.requisiciones
 where id in (select id from public.respaldo_borrado_20261015 where tabla = 'requisiciones')
   and not exists (select 1 from public.pedidos_insumos pe where pe.grupo_pedido_id = requisiciones.id);

-- ---------------------------------------------------------------- APU
-- La revisión del import que apuntaba a esas líneas o insumos vuelve a pendiente.
update public.apu_import_revision
   set estado = 'pendiente', insumo_id_asignado = null, item_apu_id = null
 where insumo_id_asignado in (select id from public._insumos_a_borrar_20261015)
    or item_apu_id in (select id from public.item_apu where insumo_id in (select id from public._insumos_a_borrar_20261015));

delete from public.item_apu where insumo_id in (select id from public._insumos_a_borrar_20261015);

-- Valor de los ítems cuyo APU perdió líneas.
select public.recalcular_valor_apus(array(
  select distinct (b.datos->>'apu_id')::uuid from public.respaldo_borrado_20261015 b where b.tabla = 'item_apu'
));

-- Candidatos de la revisión: fuera los insumos borrados.
update public.apu_import_revision a
   set candidatos = coalesce((
         select jsonb_agg(c) from jsonb_array_elements(a.candidatos) c
         where c->>'id' is null or (c->>'id')::uuid not in (select id from public._insumos_a_borrar_20261015)
       ), '[]'::jsonb)
 where jsonb_typeof(a.candidatos) = 'array'
   and exists (select 1 from jsonb_array_elements(a.candidatos) c
               where (c->>'id')::uuid in (select id from public._insumos_a_borrar_20261015));

-- ---------------------------------------------------------------- maestro
-- Su historial de compras se borra en cascada (ya quedó en el respaldo).
delete from public.maestro_insumos where id in (select id from public._insumos_a_borrar_20261015);

drop table public._insumos_a_borrar_20261015;
drop table public._oc_a_borrar_20261015;
