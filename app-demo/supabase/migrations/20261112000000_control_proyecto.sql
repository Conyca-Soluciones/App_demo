-- Control del proyecto (Control › Visualización): a dónde va la plata de UN
-- proyecto, para Gerencia. Una sola llamada que devuelve todo como jsonb (una
-- fila: no se corta en 1000 y se calcula una vez), igual que
-- resumen_ejecucion_proyecto_completo.
--
-- Definiciones (decisiones del usuario, 2026-10-14):
--   * Gastado = órdenes de compra APROBADAS (con descuento e IVA: lo que se va
--     a pagar) + actas APROBADAS.
--   * Por capítulo: cada línea de orden de compra viene de una línea de
--     requisición, que dice a qué ítem va; las actas también tienen su ítem.
--     Se cruza por CÓDIGO contra la versión vigente (las requisiciones y actas
--     pueden ser de una versión anterior). Lo que no cuadra va en 'sin_item'.
--   * Disponible = presupuesto − gastado (en la app). Las requisiciones aún
--     sin orden de compra NO se descuentan: pueden no aprobarse o cambiar.
--   * Avance de bodega = salidas (valoradas al precio PROMEDIO de compra del
--     proyecto, sin IVA; sin compras, al del maestro) ÷ presupuesto de
--     materiales (líneas de insumo de los APU).
--   * Avance de actas = actas aprobadas ÷ valor de los contratos con minuta
--     aprobada. 'presupuesto_mano_obra' es para "contratado: X % de la MO".
--   * Precio por proveedor = PROMEDIO ponderado de lo comprado (sin IVA, con
--     descuento), comparado con vr_unitario del maestro (sin IVA).
-- Permiso: pestaña admin.visualizacion + acceso al proyecto.
-- Se puede correr más de una vez.

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
           mi.id as insumo_id, mi.vr_unitario, moc.valor_unitario as valor_mo
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
  actas_lineas as (
    select al.item_codigo, al.total
    from acta_lineas al
    join actas a on a.id = al.acta_id
    join contratos c on c.id = a.contrato_id
    where c.proyecto_id = p_proyecto_id and a.estado = 'aprobada'
  ),
  -- Precio promedio de compra por insumo en el proyecto (sin IVA), para
  -- valorar las salidas de bodega.
  precio_compra as (
    select insumo_id, sum(costo_sin_iva) / nullif(sum(cantidad), 0) as precio from oc_lineas group by insumo_id
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
                                   * coalesce(precio_unitario_congelado, vr_unitario / coalesce(nullif(factor_unidad, 0), 1)))
                                 from lineas_apu where insumo_id is not null), 0),
    'presupuesto_mano_obra', coalesce((select sum(cant_item * valor_mo) from lineas_apu where valor_mo is not null), 0),
    'compras', coalesce((select sum(costo) from oc_lineas), 0),
    'actas', coalesce((select sum(total) from actas_lineas), 0),
    'excedentes', coalesce((select sum(v.costo_excedentes_compras) from v_ordenes_compra_items_costos v
                            where v.proyecto_id = p_proyecto_id and v.estado_orden = 'aprobada'), 0),
    'salidas_valor', coalesce((select sum(s.cantidad * coalesce(pc.precio, mi.vr_unitario, 0))
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
                          where not exists (select 1 from por_codigo pc where pc.codigo = gi.codigo)), 0),
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
