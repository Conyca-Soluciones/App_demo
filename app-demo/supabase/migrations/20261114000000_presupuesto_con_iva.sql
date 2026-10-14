-- Presupuesto con IVA (decisión del usuario, 2026-10-15).
--
-- En los contratos de obra con AIU (como el Malecón: lista oficial de precios
-- de la Gobernación de Casanare, Resolución 0122 de 2025) el IVA que CONYCA
-- paga en los materiales no se recupera: es costo. Los precios oficiales ya lo
-- traen dentro del precio unitario, así que el presupuesto va CON IVA.
--   * Los precios que vienen del Excel oficial no cambian (ya traen IVA).
--   * Cuando el precio de una línea de insumo sale de la app (maestro de
--     insumos o promedio de compras), ahora entra CON el IVA del insumo:
--     precio × (1 + iva_porcentaje / 100). Los insumos con IVA 0 % o marcados
--     "excluye IVA" quedan igual. Mano de obra, equipo y transporte no cambian.
--   * precios_efectivos_insumos NO cambia: sigue sin IVA porque la usan el
--     aviso de precio de OC y la Maestra, que comparan contra precios sin IVA.
--     La app usa la nueva precios_presupuesto_insumos para las líneas del APU.
--   * Las líneas que ya están congeladas en presupuestos cargados no se tocan
--     (igual que cuando cambia un precio del maestro).
--   * Control del proyecto: el presupuesto de materiales y las salidas de
--     bodega se valoran con IVA, igual que las compras. Y las actas se cuentan
--     con las actas sobre el contrato (20261112000000_actas_sobre_contrato.sql):
--     total = valor bruto de las aprobadas; por ítem, sus actividades del anexo
--     (y las líneas de APU de las actas viejas); lo demás va a "sin ítem".
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- precio para el APU
create or replace function public.precios_presupuesto_insumos(p_insumo_ids uuid[])
returns table(insumo_id uuid, precio_efectivo numeric, tipo text)
language sql
stable
security definer
set search_path = public
as $$
  select pe.insumo_id,
         -- Precios de prueba (0 o 1) se devuelven tal cual: la app los
         -- reconoce y no deja usarlos.
         case
           when pe.precio_efectivo is null or pe.precio_efectivo in (0, 1) or coalesce(mi.excluye_iva, false)
             then pe.precio_efectivo
           else round(pe.precio_efectivo * (1 + coalesce(mi.iva_porcentaje, 0) / 100.0), 2)
         end,
         pe.tipo
  from public.precios_efectivos_insumos(p_insumo_ids) pe
  join public.maestro_insumos mi on mi.id = pe.insumo_id
$$;
revoke all on function public.precios_presupuesto_insumos(uuid[]) from public, anon;
grant execute on function public.precios_presupuesto_insumos(uuid[]) to authenticated;

-- ---------------------------------------------------------------- recálculo del APU
-- Solo cambia el respaldo para una línea sin precio congelado: vr_neto (con
-- IVA) en vez de vr_unitario.
create or replace function public.recalcular_valor_apus(p_apu_ids uuid[])
returns table(apu_id uuid, valor numeric)
language sql
set search_path = public
as $$
  with apus as (
    select distinct unnest(p_apu_ids) as id
  ),
  totales as (
    select a.id as apu_id,
      round(
        coalesce(sum(moc.valor_unitario), 0)
        + coalesce(sum(ia.cantidad * ia.rendimiento
                       * coalesce(ia.precio_unitario_congelado, coalesce(mi.vr_neto, mi.vr_unitario) / ia.factor_unidad))
                     filter (where mi.id is not null), 0)
        + coalesce(sum(ia.cantidad * ia.rendimiento * ec.valor_unitario), 0)
        + coalesce(sum(tp.valor_unitario), 0)
        + coalesce(sum(ia.porcentaje_mano_obra / 100.0) * coalesce(sum(moc.valor_unitario), 0), 0),
        2) as total
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
        valor_total = case when pi.cantidad is not null then round(t.total * pi.cantidad, 2) else null end
    from totales t
    where pi.apu_id = t.apu_id
    returning pi.id
  )
  select t.apu_id, t.total from totales t
$$;

-- ---------------------------------------------------------------- Control del proyecto
create or replace function public.control_proyecto(p_proyecto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if not (public.tiene_pestana(auth.uid(), 'admin.visualizacion')
          and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)) then
    raise exception 'No tienes permiso para ver el control de este proyecto.';
  end if;

  with recursive
  version as (
    select p.version_actual_id as id from presupuestos p where p.proyecto_id = p_proyecto_id
  ),
  items as (
    select pi.id, pi.padre_id, pi.codigo, pi.descripcion, pi.nivel, pi.cantidad, pi.valor_total, pi.apu_id
    from presupuesto_items pi join version v on pi.version_id = v.id
  ),
  arbol as (
    select i.id, i.id as capitulo_id from items i where i.padre_id is null
    union all
    select i.id, a.capitulo_id from items i join arbol a on i.padre_id = a.id
  ),
  hojas as (
    select i.*, a.capitulo_id from items i join arbol a on a.id = i.id
    where not exists (select 1 from items h where h.padre_id = i.id)
  ),
  -- código -> ítem y capítulo de la versión vigente (las requisiciones y las
  -- actas pueden apuntar a ítems de una versión anterior: se cruzan por código)
  por_codigo as (
    select distinct on (h.codigo) h.codigo, h.id, h.capitulo_id from hojas h order by h.codigo, h.id
  ),
  lineas_apu as (
    select h.cantidad as cant_item, ia.cantidad, ia.rendimiento, ia.factor_unidad, ia.precio_unitario_congelado,
           mi.id as insumo_id, coalesce(mi.vr_neto, mi.vr_unitario) as vr_neto, moc.valor_unitario as valor_mo
    from hojas h
    join item_apu ia on ia.apu_id = h.apu_id
    left join maestro_insumos mi on mi.id = ia.insumo_id
    left join mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
  ),
  oc_lineas as (
    select oci.id, oc.id as orden_id, oc.proveedor_id, coalesce(oc.aprobada_at, oc.created_at) as fecha,
           pe.insumo_id, pi2.codigo as item_codigo, oci.cantidad,
           oci.cantidad * oci.precio_unitario * (1 - coalesce(oci.porcentaje_descuento, 0) / 100.0) as costo_sin_iva,
           oci.cantidad * oci.precio_unitario * (1 - coalesce(oci.porcentaje_descuento, 0) / 100.0)
             * (1 + coalesce(oci.porcentaje_iva, 0) / 100.0) as costo
    from ordenes_compra_items oci
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
    left join presupuesto_items pi2 on pi2.id = pe.presupuesto_item_id
    where oc.proyecto_id = p_proyecto_id and oc.estado = 'aprobada'
  ),
  actas_ap as (
    select a.id, a.valor_bruto
    from actas a
    join contratos c on c.id = a.contrato_id
    where c.proyecto_id = p_proyecto_id and a.estado = 'aprobada'
  ),
  -- Lo que se puede ubicar en un ítem: las actividades del anexo del contrato
  -- cobradas en el acta (actas sobre el contrato) y las líneas de APU de las
  -- actas del formato anterior. Un acta por % de avance (valor global) no
  -- tiene ítem: cuenta en el total y en "sin ítem".
  actas_lineas as (
    select pi3.codigo as item_codigo, x.valor as total
    from acta_actividades x
    join actas_ap a on a.id = x.acta_id
    left join contrato_anexo_items ca on ca.id = x.contrato_anexo_item_id
    left join presupuesto_items pi3 on pi3.id = ca.presupuesto_item_id
    union all
    select al.item_codigo, al.total
    from acta_lineas al
    join actas_ap a on a.id = al.acta_id
  ),
  -- Precio promedio de compra por insumo en el proyecto (CON IVA, como el
  -- presupuesto), para valorar las salidas de bodega.
  precio_compra as (
    select insumo_id, sum(costo) / nullif(sum(cantidad), 0) as precio from oc_lineas group by insumo_id
  ),
  salidas as (
    select s.insumo_id, sum(s.cantidad) as cantidad
    from salidas_insumos s where s.proyecto_id = p_proyecto_id and s.anulada_at is null group by s.insumo_id
  ),
  gasto_item as (
    select x.codigo, sum(x.compras) as compras, sum(x.actas) as actas
    from (
      select item_codigo as codigo, costo as compras, 0::numeric as actas from oc_lineas
      union all
      select item_codigo, 0, total from actas_lineas
    ) x
    group by x.codigo
  ),
  contratos_p as (
    select c.id, c.numero, c.numero_contrato, c.tipo, c.valor, c.minuta_estado, k.nombre as contratista,
           coalesce(sum(a.total) filter (where a.estado = 'aprobada'), 0) as actas_aprobadas,
           coalesce(sum(a.total) filter (where a.estado = 'pendiente'), 0) as actas_por_aprobar
    from contratos c
    join contratistas k on k.id = c.contratista_id
    left join actas a on a.contrato_id = c.id
    where c.proyecto_id = p_proyecto_id and c.estado = 'aprobada'
    group by c.id, k.nombre
  )
  select jsonb_build_object(
    'tiene_presupuesto', exists (select 1 from items),
    'presupuesto', coalesce((select sum(valor_total) from hojas), 0),
    'presupuesto_materiales', coalesce((select sum(cant_item * cantidad * rendimiento
                                   * coalesce(precio_unitario_congelado, vr_neto / coalesce(nullif(factor_unidad, 0), 1)))
                                 from lineas_apu where insumo_id is not null), 0),
    'presupuesto_mano_obra', coalesce((select sum(cant_item * valor_mo) from lineas_apu where valor_mo is not null), 0),
    'compras', coalesce((select sum(costo) from oc_lineas), 0),
    'actas', coalesce((select sum(valor_bruto) from actas_ap), 0),
    'excedentes', coalesce((select sum(v.costo_excedentes_compras) from v_ordenes_compra_items_costos v
                            where v.proyecto_id = p_proyecto_id and v.estado_orden = 'aprobada'), 0),
    'salidas_valor', coalesce((select sum(s.cantidad * coalesce(pc.precio, mi.vr_neto, mi.vr_unitario, 0))
                               from salidas s join maestro_insumos mi on mi.id = s.insumo_id
                               left join precio_compra pc on pc.insumo_id = s.insumo_id), 0),
    'contratado', coalesce((select sum(valor) from contratos_p where minuta_estado = 'aprobada'), 0),
    'actas_contratadas', coalesce((select sum(actas_aprobadas) from contratos_p where minuta_estado = 'aprobada'), 0),
    'capitulos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'codigo', c.codigo, 'descripcion', c.descripcion,
               'presupuesto', coalesce(t.presupuesto, 0), 'compras', coalesce(g.compras, 0), 'actas', coalesce(g.actas, 0))
             order by c.codigo)
      from items c
      left join (select capitulo_id, sum(valor_total) as presupuesto from hojas group by capitulo_id) t on t.capitulo_id = c.id
      left join (select pc.capitulo_id, sum(gi.compras) as compras, sum(gi.actas) as actas
                 from gasto_item gi join por_codigo pc on pc.codigo = gi.codigo group by pc.capitulo_id) g on g.capitulo_id = c.id
      where c.padre_id is null
    ), '[]'::jsonb),
    'sin_item', coalesce((select sum(gi.compras + gi.actas) from gasto_item gi
                          where not exists (select 1 from por_codigo pc where pc.codigo = gi.codigo)), 0)
                + greatest(coalesce((select sum(valor_bruto) from actas_ap), 0)
                           - coalesce((select sum(total) from actas_lineas), 0), 0),
    'items_sobre', coalesce((
      select jsonb_agg(x order by x.exceso desc) from (
        select h.codigo, h.descripcion, cap.descripcion as capitulo, coalesce(h.valor_total, 0) as presupuesto,
               gi.compras + gi.actas as gastado, gi.compras + gi.actas - coalesce(h.valor_total, 0) as exceso
        from gasto_item gi
        join por_codigo pc on pc.codigo = gi.codigo
        join hojas h on h.id = pc.id
        join items cap on cap.id = h.capitulo_id
        where gi.compras + gi.actas > coalesce(h.valor_total, 0)
        order by gi.compras + gi.actas - coalesce(h.valor_total, 0) desc
        limit 50
      ) x
    ), '[]'::jsonb),
    'proveedores', coalesce((
      select jsonb_agg(jsonb_build_object('id', pr.unique_id, 'nombre', pr.nombre, 'total', l.total,
                                          'ordenes', l.ordenes, 'insumos', l.insumos) order by l.total desc)
      from (select proveedor_id, sum(costo) as total, count(distinct orden_id) as ordenes, count(distinct insumo_id) as insumos
            from oc_lineas group by proveedor_id) l
      join proveedores pr on pr.unique_id = l.proveedor_id
    ), '[]'::jsonb),
    'precios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'proveedor_id', l.proveedor_id, 'insumo_id', l.insumo_id, 'codigo', mi.codigo, 'descripcion', mi.descripcion,
               'um', mi.u_m, 'cantidad', l.cantidad, 'valor', l.valor, 'precio_promedio', l.valor_sin_iva / nullif(l.cantidad, 0),
               'ultima', l.ultima, 'precio_presupuesto', mi.vr_unitario))
      from (select proveedor_id, insumo_id, sum(cantidad) as cantidad, sum(costo) as valor, sum(costo_sin_iva) as valor_sin_iva,
                   max(fecha) as ultima
            from oc_lineas group by proveedor_id, insumo_id) l
      join maestro_insumos mi on mi.id = l.insumo_id
    ), '[]'::jsonb),
    'contratos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'numero', numero, 'numero_contrato', numero_contrato, 'tipo', tipo, 'contratista', contratista,
               'valor', valor, 'minuta_aprobada', minuta_estado = 'aprobada',
               'actas_aprobadas', actas_aprobadas, 'actas_por_aprobar', actas_por_aprobar) order by numero)
      from contratos_p
    ), '[]'::jsonb)
  ) into v_resultado;

  return v_resultado;
end;
$$;
revoke all on function public.control_proyecto(uuid) from public, anon;
grant execute on function public.control_proyecto(uuid) to authenticated;
