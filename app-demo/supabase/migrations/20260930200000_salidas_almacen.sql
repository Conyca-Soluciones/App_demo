-- SALIDAS de bodega hacia obra, limitadas por el inventario disponible
-- (entradas - salidas no anuladas, ver inventario_proyecto).
--
-- Antes las policies de salidas_insumos dejaban a cualquiera que viera el
-- proyecto insertar/borrar directo, sin tope. Ahora todo pasa por funciones
-- security definer que validan permiso (es_admin / admin_insumos) y stock.

alter table public.salidas_insumos
  add column if not exists retira text,
  add column if not exists anulada_at timestamptz,
  add column if not exists anulada_por uuid references public.perfiles(id),
  add column if not exists motivo_anulacion text;

create index if not exists salidas_insumos_proyecto_insumo_idx
  on public.salidas_insumos (proyecto_id, insumo_id);

-- Solo queda la policy de SELECT; INSERT/UPDATE/DELETE directos se cierran.
drop policy if exists salidas_insumos_insert on public.salidas_insumos;
drop policy if exists salidas_insumos_update on public.salidas_insumos;
drop policy if exists salidas_insumos_delete on public.salidas_insumos;

-- Disponible de UN insumo en UN proyecto (misma cuenta que inventario_proyecto).
create or replace function public._disponible_insumo_proyecto(p_proyecto_id uuid, p_insumo_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select sum(ei.cantidad)
      from entradas_almacen_items ei
      join entradas_almacen e on e.id = ei.entrada_id
      join ordenes_compra oc on oc.id = e.orden_compra_id
      join ordenes_compra_items oci on oci.id = ei.orden_compra_item_id
      join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
      where oc.proyecto_id = p_proyecto_id and pe.insumo_id = p_insumo_id
    ), 0)
    - coalesce((
      select sum(s.cantidad)
      from salidas_insumos s
      where s.proyecto_id = p_proyecto_id and s.insumo_id = p_insumo_id and s.anulada_at is null
    ), 0);
$$;

-- p_lineas: [{ "insumo_id": uuid, "cantidad": number }, ...]
-- Devuelve cuántas líneas se registraron. Todo o nada.
create or replace function public.registrar_salida_almacen(
  p_proyecto_id uuid,
  p_lineas jsonb,
  p_retira text,
  p_observaciones text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linea jsonb;
  v_insumo uuid;
  v_cantidad numeric;
  v_disponible numeric;
  v_desc text;
  v_registradas int := 0;
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para registrar salidas de almacén.';
  end if;

  -- Serializa las salidas de un mismo proyecto: dos almacenistas no pueden
  -- sacar a la vez el mismo saldo.
  perform pg_advisory_xact_lock(hashtext(p_proyecto_id::text));

  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
  loop
    v_insumo := (v_linea->>'insumo_id')::uuid;
    v_cantidad := coalesce((v_linea->>'cantidad')::numeric, 0);
    continue when v_cantidad = 0;
    if v_cantidad < 0 then
      raise exception 'Las cantidades no pueden ser negativas.';
    end if;

    v_disponible := public._disponible_insumo_proyecto(p_proyecto_id, v_insumo);
    if v_cantidad > v_disponible then
      select descripcion into v_desc from maestro_insumos where id = v_insumo;
      raise exception 'No hay suficiente inventario de "%": disponible %, intentas sacar %.',
        coalesce(v_desc, v_insumo::text), v_disponible, v_cantidad;
    end if;

    insert into salidas_insumos (proyecto_id, insumo_id, cantidad, registrado_por, retira, observaciones)
    values (p_proyecto_id, v_insumo, v_cantidad, auth.uid(),
            nullif(trim(p_retira), ''), nullif(trim(p_observaciones), ''));
    v_registradas := v_registradas + 1;
  end loop;

  if v_registradas = 0 then
    raise exception 'Ingresa la cantidad a sacar de al menos un insumo.';
  end if;

  return v_registradas;
end;
$$;

create or replace function public.anular_salida_almacen(p_salida_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para anular salidas de almacén.';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de anulación es obligatorio.';
  end if;

  update salidas_insumos
     set anulada_at = now(), anulada_por = auth.uid(), motivo_anulacion = trim(p_motivo)
   where id = p_salida_id and anulada_at is null;

  if not found then
    raise exception 'La salida no existe o ya estaba anulada.';
  end if;
end;
$$;

create or replace function public.listar_salidas_proyecto(p_proyecto_id uuid)
returns table (
  id uuid,
  fecha date,
  created_at timestamptz,
  insumo_codigo integer,
  insumo_descripcion text,
  insumo_um text,
  cantidad numeric,
  retira text,
  observaciones text,
  registrado_por_nombre text,
  anulada_at timestamptz,
  motivo_anulacion text
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
    raise exception 'No tienes permiso para ver las salidas de este proyecto.';
  end if;

  return query
  select s.id, s.fecha, s.created_at, mi.codigo, mi.descripcion, mi.u_m, s.cantidad,
         s.retira, s.observaciones, pf.nombre, s.anulada_at, s.motivo_anulacion
  from salidas_insumos s
  join maestro_insumos mi on mi.id = s.insumo_id
  left join perfiles pf on pf.id = s.registrado_por
  where s.proyecto_id = p_proyecto_id
  order by s.created_at desc
  limit 200;
end;
$$;

revoke all on function public._disponible_insumo_proyecto(uuid, uuid) from public;
revoke all on function public.registrar_salida_almacen(uuid, jsonb, text, text) from public;
revoke all on function public.anular_salida_almacen(uuid, text) from public;
revoke all on function public.listar_salidas_proyecto(uuid) from public;
grant execute on function public.registrar_salida_almacen(uuid, jsonb, text, text) to authenticated;
grant execute on function public.anular_salida_almacen(uuid, text) to authenticated;
grant execute on function public.listar_salidas_proyecto(uuid) to authenticated;

-- resumen_ejecucion_proyecto (panel admin/visualizacion): igual que antes
-- salvo que las salidas ANULADAS ya no cuentan.
create or replace function public.resumen_ejecucion_proyecto(p_proyecto_id uuid)
returns table(insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_presupuestada numeric, valor_presupuestado numeric, cantidad_pedida numeric, cantidad_comprada numeric, valor_comprado numeric, cantidad_salida numeric, valor_salida numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with presupuesto_del_proyecto as (
    select p.version_actual_id
    from presupuestos p
    where p.proyecto_id = p_proyecto_id
    order by p.created_at desc
    limit 1
  ),
  presupuestado as (
    select
      ia.insumo_id,
      sum(pi.cantidad * ia.cantidad) as cantidad_presupuestada,
      sum(pi.cantidad * ia.cantidad * coalesce(mi.vr_neto, mi.vr_unitario, 0)) as valor_presupuestado
    from presupuesto_items pi
    join presupuesto_del_proyecto pp on pi.version_id = pp.version_actual_id
    join item_apu ia on ia.apu_id = pi.apu_id
    join maestro_insumos mi on mi.id = ia.insumo_id
    where pi.apu_id is not null and ia.insumo_id is not null
    group by ia.insumo_id
  ),
  pedido as (
    select pe.insumo_id, sum(pe.cantidad) as cantidad_pedida
    from pedidos_insumos pe
    where pe.proyecto_id = p_proyecto_id and pe.estado = 'aprobado'
    group by pe.insumo_id
  ),
  comprado as (
    select
      pe.insumo_id,
      sum(oci.cantidad) as cantidad_comprada,
      sum(oci.cantidad * oci.precio_unitario * (1 - oci.porcentaje_descuento / 100.0) * (1 + oci.porcentaje_iva / 100.0)) as valor_comprado
    from ordenes_compra_items oci
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
    where oc.proyecto_id = p_proyecto_id and oc.estado = 'aprobada'
    group by pe.insumo_id
  ),
  salida as (
    select s.insumo_id, sum(s.cantidad) as cantidad_salida
    from salidas_insumos s
    where s.proyecto_id = p_proyecto_id and s.anulada_at is null
    group by s.insumo_id
  ),
  todos_los_insumos as (
    select insumo_id from presupuestado
    union select insumo_id from pedido
    union select insumo_id from comprado
    union select insumo_id from salida
  )
  select
    t.insumo_id, mi.codigo as insumo_codigo, mi.descripcion as insumo_descripcion, mi.u_m as insumo_um,
    coalesce(presupuestado.cantidad_presupuestada, 0) as cantidad_presupuestada,
    coalesce(presupuestado.valor_presupuestado, 0) as valor_presupuestado,
    coalesce(pedido.cantidad_pedida, 0) as cantidad_pedida,
    coalesce(comprado.cantidad_comprada, 0) as cantidad_comprada,
    coalesce(comprado.valor_comprado, 0) as valor_comprado,
    coalesce(salida.cantidad_salida, 0) as cantidad_salida,
    coalesce(salida.cantidad_salida, 0)
      * coalesce(presupuestado.valor_presupuestado / nullif(presupuestado.cantidad_presupuestada, 0), 0) as valor_salida
  from todos_los_insumos t
  join maestro_insumos mi on mi.id = t.insumo_id
  left join presupuestado on presupuestado.insumo_id = t.insumo_id
  left join pedido on pedido.insumo_id = t.insumo_id
  left join comprado on comprado.insumo_id = t.insumo_id
  left join salida on salida.insumo_id = t.insumo_id
  order by mi.codigo;
$function$;
