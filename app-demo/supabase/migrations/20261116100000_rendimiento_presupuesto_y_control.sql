-- Rendimiento con volumen (prueba de carga del 15-oct-2026; decisión del
-- usuario).
--
-- 1. Abrir un presupuesto grande: la pantalla traía los ítems y, para pintar
--    los colores de cada APU, partía los ids en tandas de 200 y hacía ~10
--    rondas seguidas a Supabase (~3 s con 1.500 ítems, casi todo viaje de red).
--    cargar_presupuesto(presupuesto, versión) devuelve en UN jsonb los ítems,
--    el estado de su APU (rechazado / pendiente / listo con los motivos), las
--    diferencias de líneas contra la hoja APU y el transporte pendiente.
--    estado_apu_items(ids) da lo mismo para unos ítems (refresco de colores).
--    Las dos son SECURITY INVOKER: ven lo mismo que las consultas de antes (RLS).
-- 2. Control del proyecto: la pantalla pide los precios por proveedor × insumo
--    con precios_control_proyecto(proyecto, proveedor, texto) solo al abrir un
--    proveedor o al buscar un insumo. Quitarlos de control_proyecto (la mayor
--    parte de su jsonb, ~178 KB con 1.000 OC) va en
--    20261116200000_control_sin_precios.sql, DESPUÉS de desplegar este código
--    (el código anterior los lee de control_proyecto).
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- 1
create or replace function public.estado_apu_items(p_ids uuid[])
returns jsonb
language sql
stable
set search_path = public
as $$
  with rev as (
    select r.presupuesto_item_id as id, r.estado, r.tipo, r.descripcion_original, r.motivo_rechazo
    from apu_import_revision r
    where r.presupuesto_item_id = any (p_ids)
  ),
  por_item as (
    select id,
           case when bool_or(estado = 'rechazado') then 'rechazado'
                when bool_or(estado in ('pendiente', 'solicitud_pendiente')) then 'pendiente'
                else 'listo' end as estado,
           jsonb_agg(jsonb_build_object('descripcion', descripcion_original, 'motivo', motivo_rechazo))
             filter (where estado = 'rechazado') as motivos
    from rev
    group by id
  ),
  -- Líneas del APU guardado contra las del bloque de la hoja APU, solo en los
  -- ítems sin nada pendiente.
  candidatos as (
    select pi.id, pi.apu_id, pi.lineas_apu_oficial as oficial
    from presupuesto_items pi
    left join por_item p on p.id = pi.id
    where pi.id = any (p_ids)
      and pi.lineas_apu_oficial is not null and pi.apu_id is not null
      and (p.estado is null or p.estado = 'listo')
  ),
  lineas as (
    select ia.apu_id, count(*) as actual
    from item_apu ia
    where ia.apu_id in (select apu_id from candidatos)
    group by ia.apu_id
  )
  select jsonb_build_object(
    'estados', coalesce((select jsonb_object_agg(id, estado) from por_item), '{}'::jsonb),
    'motivosRechazo', coalesce((select jsonb_object_agg(id, motivos) from por_item where motivos is not null), '{}'::jsonb),
    'diferenciasLineas', coalesce((
      select jsonb_object_agg(c.id, jsonb_build_object('oficial', c.oficial, 'actual', coalesce(l.actual, 0)))
      from candidatos c left join lineas l on l.apu_id = c.apu_id
      where coalesce(l.actual, 0) <> c.oficial
    ), '{}'::jsonb),
    'transportePendiente', coalesce((
      select jsonb_agg(distinct id) from rev where tipo = 'TRANSPORTE' and estado = 'pendiente'
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.estado_apu_items(uuid[]) from public, anon;
grant execute on function public.estado_apu_items(uuid[]) to authenticated;

-- Con p_version_id se carga esa versión; si no, la vigente del presupuesto.
create or replace function public.cargar_presupuesto(p_presupuesto_id uuid, p_version_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_version uuid := p_version_id;
  v_items jsonb;
  v_ids uuid[];
begin
  if v_version is null then
    select version_actual_id into v_version from presupuestos where id = p_presupuesto_id;
  end if;
  if v_version is null then
    return jsonb_build_object('items', '[]'::jsonb) || public.estado_apu_items('{}'::uuid[]);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'padre_id', padre_id, 'nivel', nivel, 'codigo', codigo, 'descripcion', descripcion,
           'unidad', unidad, 'cantidad', cantidad, 'valor_unitario', valor_unitario, 'valor_total', valor_total,
           'apu_id', apu_id, 'precio_original', precio_original) order by id), '[]'::jsonb),
         array_agg(id)
    into v_items, v_ids
  from presupuesto_items
  where version_id = v_version;

  return jsonb_build_object('items', v_items) || public.estado_apu_items(coalesce(v_ids, '{}'::uuid[]));
end;
$$;
revoke all on function public.cargar_presupuesto(uuid, uuid) from public, anon;
grant execute on function public.cargar_presupuesto(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- 2
-- Lo comprado de cada insumo a cada proveedor (OC aprobadas del proyecto):
-- de un proveedor, o de los insumos cuyo código o descripción contiene el
-- texto (sin tildes ni mayúsculas). Misma regla que tenía control_proyecto.
create or replace function public.precios_control_proyecto(p_proyecto_id uuid, p_proveedor_id uuid default null, p_texto text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower(translate(btrim(coalesce(p_texto, '')), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
  v_resultado jsonb;
begin
  if not (public.tiene_pestana(auth.uid(), 'admin.visualizacion')
          and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)) then
    raise exception 'No tienes permiso para ver el control de este proyecto.';
  end if;
  if p_proveedor_id is null and length(v_q) < 2 then
    return '[]'::jsonb;
  end if;

  with oc_lineas as (
    select oc.proveedor_id, coalesce(oc.aprobada_at, oc.created_at) as fecha, pe.insumo_id, oci.cantidad,
           oci.cantidad * oci.precio_unitario * (1 - coalesce(oci.porcentaje_descuento, 0) / 100.0) as costo_sin_iva,
           oci.cantidad * oci.precio_unitario * (1 - coalesce(oci.porcentaje_descuento, 0) / 100.0)
             * (1 + coalesce(oci.porcentaje_iva, 0) / 100.0) as costo
    from ordenes_compra_items oci
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
    where oc.proyecto_id = p_proyecto_id and oc.estado = 'aprobada'
      and (p_proveedor_id is null or oc.proveedor_id = p_proveedor_id)
  ),
  insumos as (
    select mi.id, mi.codigo, mi.descripcion, mi.u_m, mi.vr_unitario
    from maestro_insumos mi
    where mi.id in (select insumo_id from oc_lineas)
      and (v_q = '' or mi.codigo::text like '%' || v_q || '%'
           or lower(translate(mi.descripcion, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) like '%' || v_q || '%')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'proveedor_id', l.proveedor_id, 'insumo_id', l.insumo_id, 'codigo', i.codigo, 'descripcion', i.descripcion,
           'um', i.u_m, 'cantidad', l.cantidad, 'valor', l.valor, 'precio_promedio', l.valor_sin_iva / nullif(l.cantidad, 0),
           'ultima', l.ultima, 'precio_presupuesto', i.vr_unitario)), '[]'::jsonb)
    into v_resultado
  from (select proveedor_id, insumo_id, sum(cantidad) as cantidad, sum(costo) as valor, sum(costo_sin_iva) as valor_sin_iva,
               max(fecha) as ultima
        from oc_lineas group by proveedor_id, insumo_id) l
  join insumos i on i.id = l.insumo_id;

  return v_resultado;
end;
$$;
revoke all on function public.precios_control_proyecto(uuid, uuid, text) from public, anon;
grant execute on function public.precios_control_proyecto(uuid, uuid, text) to authenticated;

