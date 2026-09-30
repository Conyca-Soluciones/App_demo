-- INVENTARIO de bodega por proyecto = entradas - salidas (calculado, no
-- guardado: no hay tabla de saldos que pueda descuadrarse).
--
--   entradas: entradas_almacen_items (vía OC -> proyecto -> insumo)
--   salidas : salidas_insumos no anuladas
--   costo   : promedio ponderado de lo recibido, con descuento e IVA de la
--             línea de OC (misma base que "comprado" en
--             resumen_ejecucion_proyecto)

-- Columnas para poder ANULAR una salida sin borrarla (las usará Salidas).
alter table public.salidas_insumos
  add column if not exists anulada_at timestamptz,
  add column if not exists anulada_por uuid references public.perfiles(id),
  add column if not exists motivo_anulacion text;

create or replace function public.inventario_proyecto(p_proyecto_id uuid)
returns table (
  insumo_id uuid,
  insumo_codigo integer,
  insumo_descripcion text,
  insumo_um text,
  cantidad_entrada numeric,
  cantidad_salida numeric,
  cantidad_disponible numeric,
  costo_promedio numeric,
  valor_inventario numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (
    coalesce((select p.es_admin or p.admin_insumos from perfiles p where p.id = auth.uid()), false)
    or usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)
  ) then
    raise exception 'No tienes permiso para ver el inventario de este proyecto.';
  end if;

  return query
  with ent as (
    select
      pe.insumo_id,
      sum(ei.cantidad) as cantidad,
      sum(ei.cantidad * oci.precio_unitario
          * (1 - oci.porcentaje_descuento / 100.0)
          * (1 + oci.porcentaje_iva / 100.0)) as valor
    from entradas_almacen_items ei
    join entradas_almacen e on e.id = ei.entrada_id
    join ordenes_compra oc on oc.id = e.orden_compra_id
    join ordenes_compra_items oci on oci.id = ei.orden_compra_item_id
    join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
    where oc.proyecto_id = p_proyecto_id
    group by pe.insumo_id
  ),
  sal as (
    select s.insumo_id, sum(s.cantidad) as cantidad
    from salidas_insumos s
    where s.proyecto_id = p_proyecto_id and s.anulada_at is null
    group by s.insumo_id
  ),
  todos as (
    select ent.insumo_id from ent
    union
    select sal.insumo_id from sal
  )
  select
    t.insumo_id,
    mi.codigo,
    mi.descripcion,
    mi.u_m,
    coalesce(ent.cantidad, 0),
    coalesce(sal.cantidad, 0),
    coalesce(ent.cantidad, 0) - coalesce(sal.cantidad, 0),
    coalesce(ent.valor / nullif(ent.cantidad, 0), 0),
    (coalesce(ent.cantidad, 0) - coalesce(sal.cantidad, 0))
      * coalesce(ent.valor / nullif(ent.cantidad, 0), 0)
  from todos t
  join maestro_insumos mi on mi.id = t.insumo_id
  left join ent on ent.insumo_id = t.insumo_id
  left join sal on sal.insumo_id = t.insumo_id
  order by mi.codigo;
end;
$$;

revoke all on function public.inventario_proyecto(uuid) from public;
grant execute on function public.inventario_proyecto(uuid) to authenticated;
