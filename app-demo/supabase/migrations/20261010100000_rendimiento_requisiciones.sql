-- Rendimiento de requisiciones agrupadas (revisión después de 20261008000000).
--
-- 1. Índices de `requisiciones` para los filtros de Registro y Aprobación
--    (proyecto, solicitante, orden por fecha). Sin ellos, cada consulta recorre
--    la tabla completa, que crece con cada requisición.
-- 2. `pedidos_insumos(grupo_pedido_id)` tenía DOS índices idénticos
--    (idx_pedidos_insumos_grupo, creado a mano, y pedidos_insumos_grupo_idx, de
--    la migración): cada INSERT/UPDATE pagaba los dos. Se deja el de la
--    migración.
-- 3. `insumos_presupuesto_por_ids`: lo que "Modificar requisición" necesita
--    (los ítems de la versión donde aparece cada insumo, con su disponible) en
--    UNA llamada. Antes hacía una llamada a buscar_insumos_presupuesto por
--    insumo (hasta 50), buscando el CÓDIGO del insumo como texto parcial con
--    límite de 200 filas ordenadas por descripción: un código corto ("12")
--    coincide con cientos de filas y los ítems del insumo correcto podían
--    quedar fuera del límite y desaparecer del diálogo.

create index if not exists idx_requisiciones_proyecto_created
  on public.requisiciones (proyecto_id, created_at desc);
create index if not exists idx_requisiciones_solicitado_created
  on public.requisiciones (solicitado_por, created_at desc);
create index if not exists idx_requisiciones_created
  on public.requisiciones (created_at desc);

drop index if exists public.idx_pedidos_insumos_grupo;

-- Mismas columnas y misma fórmula que buscar_insumos_presupuesto, filtrando por
-- id exacto de insumo en vez de por texto.
create or replace function public.insumos_presupuesto_por_ids(p_version_id uuid, p_insumo_ids uuid[])
returns table(
  presupuesto_item_id uuid, item_codigo text, item_descripcion text, item_apu_id uuid,
  insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text,
  cantidad_apu numeric, rendimiento numeric, cantidad_maxima numeric,
  cantidad_comprometida numeric, cantidad_disponible numeric
)
language sql
stable
as $$
  select
    pi.id,
    pi.codigo,
    pi.descripcion,
    ia.id,
    mi.id,
    mi.codigo,
    mi.descripcion,
    mi.u_m,
    ia.cantidad,
    ia.rendimiento,
    (ia.cantidad * coalesce(pi.cantidad, 0)),
    c.total,
    greatest((ia.cantidad * coalesce(pi.cantidad, 0)) - c.total, 0)
  from public.presupuesto_items pi
  join public.item_apu ia        on ia.apu_id = pi.apu_id
  join public.maestro_insumos mi on mi.id = ia.insumo_id
  cross join lateral (select public._comprometido_insumo_item(pi.id, mi.id) as total) c
  where pi.version_id = p_version_id
    and pi.apu_id is not null
    and ia.insumo_id = any (p_insumo_ids)
  order by mi.descripcion, pi.codigo;
$$;

revoke all on function public.insumos_presupuesto_por_ids(uuid, uuid[]) from public, anon;
grant execute on function public.insumos_presupuesto_por_ids(uuid, uuid[]) to authenticated, service_role;
