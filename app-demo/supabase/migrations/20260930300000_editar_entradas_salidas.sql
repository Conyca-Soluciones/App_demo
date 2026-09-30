-- Corrección de errores en ENTRADAS y SALIDAS.
--
--  Entradas: editar cantidades / remisión / observaciones, o ANULAR la
--            entrada completa (queda registrada, no se borra).
--  Salidas : editar cantidad / quién retira / observaciones.
--
-- Reglas que se validan aquí (no en la pantalla):
--  * una entrada nunca deja una línea de OC por encima de lo ordenado;
--  * reducir o anular una entrada no puede dejar el inventario negativo
--    (es decir, no se puede "des-recibir" material que ya salió);
--  * editar una salida no puede superar lo disponible;
--  * el estado de entrega de la OC (sin_entregar / entrega_parcial /
--    entregada) se recalcula siempre desde las entradas vigentes.

-- ---------------------------------------------------------------- columnas
alter table public.entradas_almacen
  add column if not exists anulada_at timestamptz,
  add column if not exists anulada_por uuid references public.perfiles(id),
  add column if not exists motivo_anulacion text,
  add column if not exists editada_at timestamptz,
  add column if not exists editada_por uuid references public.perfiles(id);

alter table public.entradas_almacen_items
  add column if not exists cantidad_original numeric;

alter table public.salidas_insumos
  add column if not exists editada_at timestamptz,
  add column if not exists editada_por uuid references public.perfiles(id),
  add column if not exists cantidad_original numeric;

-- ------------------------------------------------------------- utilidades
-- Recibido vigente (sin entradas anuladas) de una línea de OC.
create or replace function public._recibido_linea_oc(p_oci uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(ei.cantidad), 0)
  from entradas_almacen_items ei
  join entradas_almacen e on e.id = ei.entrada_id
  where ei.orden_compra_item_id = p_oci and e.anulada_at is null;
$$;

-- Recalcula ordenes_compra.estado_entrega desde las entradas vigentes.
create or replace function public._recalcular_estado_entrega(p_orden_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_incompletas int;
  v_estado text;
begin
  select coalesce(sum(public._recibido_linea_oc(i.id)), 0),
         count(*) filter (where public._recibido_linea_oc(i.id) < i.cantidad)
    into v_total, v_incompletas
    from ordenes_compra_items i
   where i.orden_compra_id = p_orden_id;

  v_estado := case
    when v_total = 0 then 'sin_entregar'
    when v_incompletas = 0 then 'entregada'
    else 'entrega_parcial'
  end;

  update ordenes_compra set estado_entrega = v_estado where id = p_orden_id;
  return v_estado;
end;
$$;

-- Disponible de un insumo en un proyecto: ahora ignora entradas anuladas.
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
        and e.anulada_at is null
    ), 0)
    - coalesce((
      select sum(s.cantidad)
      from salidas_insumos s
      where s.proyecto_id = p_proyecto_id and s.insumo_id = p_insumo_id and s.anulada_at is null
    ), 0);
$$;

-- ------------------------------------------------------- inventario (v2)
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
    where oc.proyecto_id = p_proyecto_id and e.anulada_at is null
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

-- --------------------------------------- lista de OC para entradas (v2)
-- p_incluir_entregadas = true permite abrir OC ya entregadas para corregirlas.
drop function if exists public.listar_ordenes_para_entrada();

create or replace function public.listar_ordenes_para_entrada(p_incluir_entregadas boolean default false)
returns table (
  id uuid,
  numero integer,
  estado_entrega text,
  proyecto_codigo text,
  proyecto_nombre text,
  proveedor_nombre text,
  fecha_entrega date,
  total_lineas bigint,
  cantidad_ordenada numeric,
  cantidad_recibida numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;

  return query
  select
    o.id,
    o.numero::integer,
    o.estado_entrega,
    pr.codigo::text,
    pr.nombre::text,
    pv.nombre::text,
    o.fecha_entrega::date,
    count(i.id),
    coalesce(sum(i.cantidad), 0),
    coalesce(sum(public._recibido_linea_oc(i.id)), 0)
  from ordenes_compra o
  join proyectos pr on pr.id = o.proyecto_id
  left join proveedores pv on pv.unique_id = o.proveedor_id
  left join ordenes_compra_items i on i.orden_compra_id = o.id
  where o.estado = 'aprobada'
    and (p_incluir_entregadas or o.estado_entrega in ('sin_entregar', 'entrega_parcial'))
  group by o.id, pr.codigo, pr.nombre, pv.nombre
  order by o.numero desc;
end;
$$;

-- ------------------------------------------------- detalle de OC (v2)
create or replace function public.detalle_orden_para_entrada(p_orden_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_orden record;
  v_lineas jsonb;
  v_entradas jsonb;
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;

  select o.id, o.numero, o.estado, o.estado_entrega,
         pr.codigo as proyecto_codigo, pr.nombre as proyecto_nombre,
         pv.nombre as proveedor_nombre
    into v_orden
    from ordenes_compra o
    join proyectos pr on pr.id = o.proyecto_id
    left join proveedores pv on pv.unique_id = o.proveedor_id
   where o.id = p_orden_id;

  if not found then
    raise exception 'La orden de compra no existe.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'insumo_codigo', mi.codigo,
           'insumo_descripcion', mi.descripcion,
           'um', mi.u_m,
           'cantidad_ordenada', i.cantidad,
           'cantidad_recibida', public._recibido_linea_oc(i.id),
           'cantidad_pendiente', greatest(i.cantidad - public._recibido_linea_oc(i.id), 0)
         ) order by mi.codigo), '[]'::jsonb)
    into v_lineas
    from ordenes_compra_items i
    join pedidos_insumos pi on pi.id = i.pedido_insumo_id
    join maestro_insumos mi on mi.id = pi.insumo_id
   where i.orden_compra_id = p_orden_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'numero', e.numero,
           'remision', e.remision,
           'observaciones', e.observaciones,
           'recibido_por', pf.nombre,
           'created_at', e.created_at,
           'anulada_at', e.anulada_at,
           'motivo_anulacion', e.motivo_anulacion,
           'editada_at', e.editada_at,
           'lineas', (
             select jsonb_agg(jsonb_build_object(
                      'id', ei.id,
                      'orden_compra_item_id', ei.orden_compra_item_id,
                      'insumo_descripcion', mi.descripcion,
                      'um', mi.u_m,
                      'cantidad', ei.cantidad,
                      'cantidad_original', ei.cantidad_original)
                      order by mi.descripcion)
             from entradas_almacen_items ei
             join ordenes_compra_items i on i.id = ei.orden_compra_item_id
             join pedidos_insumos pi on pi.id = i.pedido_insumo_id
             join maestro_insumos mi on mi.id = pi.insumo_id
             where ei.entrada_id = e.id
           )
         ) order by e.created_at desc), '[]'::jsonb)
    into v_entradas
    from entradas_almacen e
    left join perfiles pf on pf.id = e.recibido_por
   where e.orden_compra_id = p_orden_id;

  return jsonb_build_object(
    'id', v_orden.id,
    'numero', v_orden.numero,
    'estado', v_orden.estado,
    'estado_entrega', v_orden.estado_entrega,
    'proyecto_codigo', v_orden.proyecto_codigo,
    'proyecto_nombre', v_orden.proyecto_nombre,
    'proveedor_nombre', v_orden.proveedor_nombre,
    'lineas', v_lineas,
    'entradas', v_entradas
  );
end;
$$;

-- --------------------------------------------- registrar entrada (v2)
create or replace function public.registrar_entrada_almacen(
  p_orden_id uuid,
  p_remision text,
  p_observaciones text,
  p_lineas jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden record;
  v_entrada_id uuid;
  v_linea jsonb;
  v_item record;
  v_cantidad numeric;
  v_recibida numeric;
  v_insertadas int := 0;
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;

  select id, estado, estado_entrega into v_orden
    from ordenes_compra where id = p_orden_id for update;

  if not found then
    raise exception 'La orden de compra no existe.';
  end if;
  if v_orden.estado <> 'aprobada' then
    raise exception 'Solo se pueden registrar entradas de órdenes aprobadas.';
  end if;
  if v_orden.estado_entrega = 'entregada' then
    raise exception 'La orden ya fue entregada por completo.';
  end if;

  insert into entradas_almacen (orden_compra_id, remision, observaciones, recibido_por)
  values (p_orden_id, nullif(trim(p_remision), ''), nullif(trim(p_observaciones), ''), auth.uid())
  returning id into v_entrada_id;

  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
  loop
    v_cantidad := coalesce((v_linea->>'cantidad')::numeric, 0);
    if v_cantidad < 0 then
      raise exception 'Las cantidades no pueden ser negativas.';
    end if;
    continue when v_cantidad = 0;

    select i.id, i.cantidad into v_item
      from ordenes_compra_items i
     where i.id = (v_linea->>'orden_compra_item_id')::uuid
       and i.orden_compra_id = p_orden_id;

    if not found then
      raise exception 'Una de las líneas no pertenece a esta orden de compra.';
    end if;

    v_recibida := public._recibido_linea_oc(v_item.id);

    if v_recibida + v_cantidad > v_item.cantidad then
      raise exception 'La cantidad recibida supera lo pendiente de la orden (pendiente: %).',
        v_item.cantidad - v_recibida;
    end if;

    insert into entradas_almacen_items (entrada_id, orden_compra_item_id, cantidad)
    values (v_entrada_id, v_item.id, v_cantidad);
    v_insertadas := v_insertadas + 1;
  end loop;

  if v_insertadas = 0 then
    raise exception 'Ingresa la cantidad recibida de al menos un insumo.';
  end if;

  perform public._recalcular_estado_entrega(p_orden_id);
  return v_entrada_id;
end;
$$;

-- ------------------------------------------------------ editar entrada
-- p_lineas: [{ "id": <entradas_almacen_items.id>, "cantidad": number }, ...]
-- Solo se pueden cambiar cantidades (> 0). Para quitar una línea o mover la
-- entrada a otra OC: anular la entrada y registrarla de nuevo.
-- Devuelve el estado_entrega resultante de la OC.
create or replace function public.editar_entrada_almacen(
  p_entrada_id uuid,
  p_remision text,
  p_observaciones text,
  p_lineas jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent record;
  v_proyecto uuid;
  v_linea jsonb;
  v_item record;
  v_nueva numeric;
  v_otras numeric;
  v_insumo uuid;
  v_reducidos uuid[] := '{}';
  v_cambios int := 0;
  v_remision text := nullif(trim(p_remision), '');
  v_obs text := nullif(trim(p_observaciones), '');
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;

  select e.id, e.orden_compra_id, e.anulada_at, e.remision, e.observaciones
    into v_ent from entradas_almacen e where e.id = p_entrada_id for update;
  if not found then
    raise exception 'La entrada no existe.';
  end if;
  if v_ent.anulada_at is not null then
    raise exception 'La entrada está anulada y no se puede editar.';
  end if;

  select proyecto_id into v_proyecto from ordenes_compra where id = v_ent.orden_compra_id for update;
  perform pg_advisory_xact_lock(hashtext(v_proyecto::text));

  for v_linea in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb))
  loop
    v_nueva := (v_linea->>'cantidad')::numeric;
    if v_nueva is null or v_nueva <= 0 then
      raise exception 'La cantidad de cada línea debe ser mayor que cero. Para quitar una línea, anula la entrada y regístrala de nuevo.';
    end if;

    select ei.id, ei.cantidad, ei.orden_compra_item_id, oci.cantidad as ordenada, pe.insumo_id
      into v_item
      from entradas_almacen_items ei
      join ordenes_compra_items oci on oci.id = ei.orden_compra_item_id
      join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
     where ei.id = (v_linea->>'id')::uuid and ei.entrada_id = p_entrada_id;
    if not found then
      raise exception 'Una de las líneas no pertenece a esta entrada.';
    end if;

    continue when v_nueva = v_item.cantidad;

    v_otras := public._recibido_linea_oc(v_item.orden_compra_item_id) - v_item.cantidad;
    if v_otras + v_nueva > v_item.ordenada then
      raise exception 'La cantidad supera lo ordenado en la OC (máximo permitido para esta línea: %).',
        v_item.ordenada - v_otras;
    end if;

    update entradas_almacen_items
       set cantidad_original = coalesce(cantidad_original, cantidad), cantidad = v_nueva
     where id = v_item.id;
    v_cambios := v_cambios + 1;

    if v_nueva < v_item.cantidad then
      v_reducidos := v_reducidos || v_item.insumo_id;
    end if;
  end loop;

  if v_cambios = 0
     and v_remision is not distinct from v_ent.remision
     and v_obs is not distinct from v_ent.observaciones then
    raise exception 'No hay cambios que guardar.';
  end if;

  update entradas_almacen
     set remision = v_remision, observaciones = v_obs,
         editada_at = now(), editada_por = auth.uid()
   where id = p_entrada_id;

  foreach v_insumo in array v_reducidos
  loop
    if public._disponible_insumo_proyecto(v_proyecto, v_insumo) < 0 then
      raise exception 'No se puede reducir esta entrada: ya salió material de ese insumo y el inventario quedaría negativo. Anula primero las salidas correspondientes.';
    end if;
  end loop;

  return public._recalcular_estado_entrega(v_ent.orden_compra_id);
end;
$$;

-- ------------------------------------------------------ anular entrada
create or replace function public.anular_entrada_almacen(p_entrada_id uuid, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ent record;
  v_proyecto uuid;
  v_insumo uuid;
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de anulación es obligatorio.';
  end if;

  select e.id, e.orden_compra_id, e.anulada_at
    into v_ent from entradas_almacen e where e.id = p_entrada_id for update;
  if not found then
    raise exception 'La entrada no existe.';
  end if;
  if v_ent.anulada_at is not null then
    raise exception 'La entrada ya estaba anulada.';
  end if;

  select proyecto_id into v_proyecto from ordenes_compra where id = v_ent.orden_compra_id for update;
  perform pg_advisory_xact_lock(hashtext(v_proyecto::text));

  update entradas_almacen
     set anulada_at = now(), anulada_por = auth.uid(), motivo_anulacion = trim(p_motivo)
   where id = p_entrada_id;

  for v_insumo in
    select distinct pe.insumo_id
      from entradas_almacen_items ei
      join ordenes_compra_items oci on oci.id = ei.orden_compra_item_id
      join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
     where ei.entrada_id = p_entrada_id
  loop
    if public._disponible_insumo_proyecto(v_proyecto, v_insumo) < 0 then
      raise exception 'No se puede anular esta entrada: ya salió material de ese insumo y el inventario quedaría negativo. Anula primero las salidas correspondientes.';
    end if;
  end loop;

  return public._recalcular_estado_entrega(v_ent.orden_compra_id);
end;
$$;

-- ------------------------------------------------------- editar salida
create or replace function public.editar_salida_almacen(
  p_salida_id uuid,
  p_cantidad numeric,
  p_retira text,
  p_observaciones text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s record;
  v_disponible_sin_esta numeric;
  v_retira text := nullif(trim(p_retira), '');
  v_obs text := nullif(trim(p_observaciones), '');
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para editar salidas de almacén.';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero. Para deshacer la salida, anúlala.';
  end if;

  select s.id, s.proyecto_id, s.insumo_id, s.cantidad, s.retira, s.observaciones, s.anulada_at
    into v_s from salidas_insumos s where s.id = p_salida_id for update;
  if not found then
    raise exception 'La salida no existe.';
  end if;
  if v_s.anulada_at is not null then
    raise exception 'La salida está anulada y no se puede editar.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_s.proyecto_id::text));

  -- Disponible contando como libre lo que esta misma salida ya tenía sacado.
  v_disponible_sin_esta :=
    public._disponible_insumo_proyecto(v_s.proyecto_id, v_s.insumo_id) + v_s.cantidad;
  if p_cantidad > v_disponible_sin_esta then
    raise exception 'No hay suficiente inventario: máximo para esta salida %, intentas %.',
      v_disponible_sin_esta, p_cantidad;
  end if;

  if p_cantidad = v_s.cantidad
     and v_retira is not distinct from v_s.retira
     and v_obs is not distinct from v_s.observaciones then
    raise exception 'No hay cambios que guardar.';
  end if;

  update salidas_insumos
     set cantidad_original = case when p_cantidad <> cantidad then coalesce(cantidad_original, cantidad)
                                  else cantidad_original end,
         cantidad = p_cantidad,
         retira = v_retira,
         observaciones = v_obs,
         editada_at = now(),
         editada_por = auth.uid()
   where id = p_salida_id;
end;
$$;

-- listar_salidas_proyecto (v2): agrega datos de edición.
drop function if exists public.listar_salidas_proyecto(uuid);

create or replace function public.listar_salidas_proyecto(p_proyecto_id uuid)
returns table (
  id uuid,
  fecha date,
  created_at timestamptz,
  insumo_codigo integer,
  insumo_descripcion text,
  insumo_um text,
  cantidad numeric,
  cantidad_original numeric,
  retira text,
  observaciones text,
  registrado_por_nombre text,
  editada_at timestamptz,
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
         s.cantidad_original, s.retira, s.observaciones, pf.nombre,
         s.editada_at, s.anulada_at, s.motivo_anulacion
  from salidas_insumos s
  join maestro_insumos mi on mi.id = s.insumo_id
  left join perfiles pf on pf.id = s.registrado_por
  where s.proyecto_id = p_proyecto_id
  order by s.created_at desc
  limit 200;
end;
$$;

-- ------------------------------------------------------------- permisos
revoke all on function public._recibido_linea_oc(uuid) from public;
revoke all on function public._recalcular_estado_entrega(uuid) from public;
revoke all on function public.listar_ordenes_para_entrada(boolean) from public;
revoke all on function public.editar_entrada_almacen(uuid, text, text, jsonb) from public;
revoke all on function public.anular_entrada_almacen(uuid, text) from public;
revoke all on function public.editar_salida_almacen(uuid, numeric, text, text) from public;
revoke all on function public.listar_salidas_proyecto(uuid) from public;
grant execute on function public.listar_ordenes_para_entrada(boolean) to authenticated;
grant execute on function public.editar_entrada_almacen(uuid, text, text, jsonb) to authenticated;
grant execute on function public.anular_entrada_almacen(uuid, text) to authenticated;
grant execute on function public.editar_salida_almacen(uuid, numeric, text, text) to authenticated;
grant execute on function public.listar_salidas_proyecto(uuid) to authenticated;
