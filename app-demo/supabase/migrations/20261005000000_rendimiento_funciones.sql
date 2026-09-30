-- Rendimiento de funciones (puntos 5.3, 5.4 y 5.5 de
-- REPORTE-cambios-y-rendimiento.md). Mismos resultados que antes: antes de
-- aplicar se comparó la lógica vieja contra la nueva sobre TODOS los datos
-- (22/22 APU y 1.794/1.794 precios idénticos, diferencia 0).

-- ---------------------------------------------------------------------------
-- 1. recalcular_valor_apus(uuid[]): recálculo EN LOTE.
--    Antes: recalcular_valor_apu hacía 5 SELECT separados sobre item_apu por
--    APU, y el código lo llamaba una vez por ítem/APU (cientos de viajes en
--    un import). Ahora: UNA consulta agrupada para N APUs y UN solo UPDATE.
--    Herramienta menor: sum(p/100 * mo) = mo * sum(p/100) (numeric es exacto
--    en + y *, así que el resultado es idéntico).
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_valor_apus(p_apu_ids uuid[])
returns table(apu_id uuid, valor numeric)
language sql
as $$
  with apus as (
    -- distinct: un id repetido duplicaría las sumas del GROUP BY
    select distinct unnest(p_apu_ids) as id
  ),
  totales as (
    select a.id as apu_id,
      coalesce(sum(moc.valor_unitario), 0)
      + coalesce(sum(ia.cantidad * ia.rendimiento * coalesce(ia.precio_unitario_congelado, mi.vr_unitario))
                   filter (where mi.id is not null), 0)
      + coalesce(sum(ia.cantidad * ia.rendimiento * ec.valor_unitario), 0)
      + coalesce(sum(tp.valor_unitario), 0)
      + coalesce(sum(ia.porcentaje_mano_obra / 100.0) * coalesce(sum(moc.valor_unitario), 0), 0)
        as total
    from apus a
    left join public.item_apu ia on ia.apu_id = a.id
    left join public.mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
    left join public.maestro_insumos mi on mi.id = ia.insumo_id
    left join public.equipo_categorias ec on ec.id = ia.equipo_categoria_id
    left join public.transporte_precios tp on tp.id = ia.transporte_precio_id
    group by a.id
  ),
  actualizados as (
    update public.presupuesto_items pi
    set valor_unitario = t.total,
        valor_total = case when pi.cantidad is not null then t.total * pi.cantidad else null end
    from totales t
    where pi.apu_id = t.apu_id
    returning pi.id
  )
  select t.apu_id, t.total from totales t
$$;

-- La versión de UN APU (la usan triggers y código existente) queda como
-- envoltura de la de lote: misma firma, mismo resultado.
create or replace function public.recalcular_valor_apu(p_apu_id uuid)
returns numeric
language sql
as $$
  select valor from public.recalcular_valor_apus(array[p_apu_id])
$$;

-- ---------------------------------------------------------------------------
-- 2. precios_efectivos_insumos: de "una función por insumo" a una consulta
--    agrupada. Antes llamaba precio_promedio_compra_insumo() por CADA
--    insumo (dos subconsultas por fila). Ahora: una sola pasada por las
--    compras de todos los insumos pedidos. Misma firma y mismo resultado:
--    promedio de los últimos 6 meses; si no hay, promedio histórico; si no
--    hay compras, vr_unitario.
-- ---------------------------------------------------------------------------
create or replace function public.precios_efectivos_insumos(p_insumo_ids uuid[])
returns table(insumo_id uuid, precio_efectivo numeric, tipo text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with compras as (
    select h.insumo_id,
           h.precio_unitario * (1 - h.porcentaje_descuento / 100.0) as precio,
           h.fecha_compra as fecha
    from historico_precios_compra h
    where h.insumo_id = any(p_insumo_ids)

    union all

    select pi.insumo_id,
           oci.precio_unitario * (1 - oci.porcentaje_descuento / 100.0),
           oci.created_at::date
    from ordenes_compra_items oci
    join pedidos_insumos pi on pi.id = oci.pedido_insumo_id
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    where pi.insumo_id = any(p_insumo_ids)
      and oc.estado = 'aprobada'
  ),
  promedios as (
    select c.insumo_id,
           avg(c.precio) filter (where c.fecha >= (now() - interval '6 months')::date) as reciente,
           avg(c.precio) as historico
    from compras c
    group by c.insumo_id
  )
  select mi.id, coalesce(p.reciente, p.historico, mi.vr_unitario), mi.tipo
  from maestro_insumos mi
  left join promedios p on p.insumo_id = mi.id
  where mi.id = any(p_insumo_ids)
$$;

-- ---------------------------------------------------------------------------
-- 3. buscar_insumos_candidatos_lote: candidatos de MUCHAS descripciones en
--    un solo viaje (import de APU). Antes: una llamada a
--    buscar_insumos_candidatos por cada descripción única del Excel.
--    Una fila por término (idx = posición en p_terminos, desde 1), con sus
--    candidatos en jsonb ordenados por cercanía -- así el límite de filas
--    de la API cuenta términos, no candidatos. Usa el índice GiST de
--    maestro_insumos.descripcion. Sin security definer: aplica RLS igual
--    que buscar_insumos_candidatos.
-- ---------------------------------------------------------------------------
create or replace function public.buscar_insumos_candidatos_lote(
  p_terminos text[],
  p_limite integer default 50
)
returns table(idx integer, candidatos jsonb)
language sql
stable
as $$
  select t.idx::integer,
         coalesce(
           (select jsonb_agg(to_jsonb(m) order by m.distancia)
            from (
              select mi.*, mi.descripcion <-> t.termino as distancia
              from public.maestro_insumos mi
              order by mi.descripcion <-> t.termino
              limit p_limite
            ) m),
           '[]'::jsonb
         )
  from unnest(p_terminos) with ordinality as t(termino, idx)
$$;

-- ---------------------------------------------------------------------------
-- 4. disponible_insumos_items: tope de cantidad de VARIOS pares (ítem,
--    insumo) en un viaje. crearPedido lo llamaba una vez por par (hasta
--    cientos con 50 insumos por pedido). Reusa disponible_insumo_item por
--    dentro, así que el resultado es idéntico por construcción.
--    idx = posición del par (desde 1).
-- ---------------------------------------------------------------------------
create or replace function public.disponible_insumos_items(p_items uuid[], p_insumos uuid[])
returns table(idx integer, disponible numeric)
language sql
stable
as $$
  select t.idx::integer, public.disponible_insumo_item(t.item, t.insumo)
  from unnest(p_items, p_insumos) with ordinality as t(item, insumo, idx)
$$;
