-- Órdenes de compra: PRESENTACIÓN de compra elegida en la línea ("UM disponible").
--
-- Caso: el presupuesto pide 13,08 m² de enchape (el insumo está en m² en el
-- maestro) y la tienda lo vende por cajas de 2,08 m². En Generar OC, Compras
-- elige la UM disponible (CAJA) y escribe la conversión (2,08 m² por caja); el
-- sistema calcula 7 cajas (siempre hacia arriba).
--
-- DISEÑO. La línea sigue guardando `cantidad` y `precio_unitario` en la unidad
-- de compra DEL INSUMO (la u_m del maestro: m²), porque de ahí cuelgan Entradas,
-- Inventario, ejecución del presupuesto, pagos y el precio promedio con el que
-- se valoran los APU (y sus alertas de sobrecosto). Lo que Compras compró de
-- verdad se guarda aparte:
--     um_compra           'CAJA'
--     conversion_compra    2.08   unidades de la REQUISICIÓN por unidad de compra
--     cantidad_compra      7      (entero)
--     precio_compra        $100.000 por unidad de compra
--     cantidad_por_um      2.08   unidades del INSUMO por unidad de compra
--                                 = round(conversion_compra / factor_unidad, 6)
--   y entonces:  cantidad = cantidad_compra × cantidad_por_um   (14,56 m²)
--                precio_unitario = precio_compra / cantidad_por_um
-- El total de la línea (cantidad × precio_unitario) es exactamente
-- cantidad_compra × precio_compra. `factor_unidad` no cambia (sigue siendo la
-- relación insumo/requisición), así que lo comprado contra la requisición
-- (cantidad × factor_unidad) sigue cuadrando.
--
-- Cambios sobre lo existente (compatibles; sin presentación todo funciona igual):
--   * 5 columnas nuevas y opcionales en ordenes_compra_items.
--   * crear_orden_compra: las líneas pueden traer la presentación.
--   * _detalle_orden_para_entrada, _registrar_entrada_almacen y
--     _editar_entrada_almacen (las versiones INTERNAS: los envoltorios públicos
--     con el permiso por proyecto no se tocan): una línea puede recibirse en
--     unidades de compra (cantidad_compra) y la base la convierte con decimales
--     exactos.
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- columnas
alter table public.ordenes_compra_items
  add column if not exists um_compra         text,
  add column if not exists conversion_compra numeric,
  add column if not exists cantidad_compra   numeric,
  add column if not exists precio_compra     numeric,
  add column if not exists cantidad_por_um   numeric;

alter table public.ordenes_compra_items drop constraint if exists ordenes_compra_items_presentacion_check;
alter table public.ordenes_compra_items add constraint ordenes_compra_items_presentacion_check check (
  (um_compra is null and conversion_compra is null and cantidad_compra is null
     and precio_compra is null and cantidad_por_um is null)
  or (
    btrim(um_compra) <> ''
    and conversion_compra > 0 and conversion_compra = round(conversion_compra, 4)
    and cantidad_compra > 0 and cantidad_compra = trunc(cantidad_compra)
    and precio_compra >= 0
    and cantidad_por_um > 0
    and cantidad = cantidad_compra * cantidad_por_um
  )
);

-- ------------------------------------------------------- crear_orden_compra
-- Igual que la versión vigente (conversión por línea + anticipo), más la
-- presentación opcional por línea.
create or replace function public.crear_orden_compra(
  p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date,
  p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text,
  p_condiciones_pago text, p_observaciones text, p_lineas jsonb,
  p_anticipo_porcentaje numeric default null,
  p_saldo_modo text default null,
  p_saldo_fecha date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_orden_id uuid;
  v_linea jsonb;
  v_pedido record;
  v_ya_comprado numeric;
  v_maximo numeric;
  v_factor numeric;
  v_cantidad_solicitada numeric;
  v_precio numeric;
  v_anticipo numeric(5,2) := nullif(p_anticipo_porcentaje, 0);
  v_modo text := null;
  v_fecha date := null;
  v_um_compra text;
  v_conversion numeric;
  v_cant_compra numeric;
  v_precio_compra numeric;
  v_por_um numeric;
begin
  if not rol_compras(auth.uid()) then
    raise exception 'No autorizado.';
  end if;

  if jsonb_array_length(p_lineas) = 0 then
    raise exception 'La orden de compra necesita al menos un insumo.';
  end if;

  -- Anticipo: porcentaje entre 0 y 100 (sin incluirlos) y cuándo se paga el saldo.
  if v_anticipo is not null then
    if v_anticipo <= 0 or v_anticipo >= 100 then
      raise exception 'El porcentaje del anticipo debe ser mayor que 0 y menor que 100.';
    end if;
    if p_saldo_modo is null or p_saldo_modo not in ('entrega','fecha') then
      raise exception 'Indica cuándo se paga el saldo: al ser entregado o en una fecha.';
    end if;
    v_modo := p_saldo_modo;
    if v_modo = 'fecha' then
      if p_saldo_fecha is null then
        raise exception 'Indica la fecha en que se paga el saldo.';
      end if;
      if p_saldo_fecha < (now() at time zone 'America/Bogota')::date then
        raise exception 'La fecha de pago del saldo no puede ser anterior a hoy.';
      end if;
      v_fecha := p_saldo_fecha;
    end if;
  end if;

  insert into ordenes_compra (
    proyecto_id, proveedor_id, sitio_entrega, fecha_entrega,
    contacto_nombre, telefono, ciudad, email, condiciones_pago, observaciones, created_by,
    anticipo_porcentaje, saldo_modo, saldo_fecha
  ) values (
    p_proyecto_id, p_proveedor_id, p_sitio_entrega, p_fecha_entrega,
    p_contacto_nombre, p_telefono, p_ciudad, p_email, p_condiciones_pago, p_observaciones, auth.uid(),
    v_anticipo, v_modo, v_fecha
  )
  returning id into v_orden_id;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    select id, cantidad, factor_unidad, proyecto_id, estado
      into v_pedido
      from pedidos_insumos
      where id = (v_linea->>'pedido_id')::uuid
      for update;

    if v_pedido.id is null then
      raise exception 'Pedido % no existe.', v_linea->>'pedido_id';
    end if;

    if v_pedido.estado <> 'aprobado' then
      raise exception 'Pedido % ya no está aprobado.', v_linea->>'pedido_id';
    end if;

    if v_pedido.proyecto_id <> p_proyecto_id then
      raise exception 'Pedido % no pertenece al proyecto de esta orden.', v_linea->>'pedido_id';
    end if;

    v_um_compra := nullif(btrim(v_linea->>'um_compra'), '');
    v_conversion := null;
    v_cant_compra := null;
    v_precio_compra := null;
    v_por_um := null;

    -- Conversión de esta compra: la que mandó Compras, o la del APU.
    v_factor := coalesce(nullif(v_linea->>'factor', '')::numeric, v_pedido.factor_unidad);
    if v_factor is null or v_factor <= 0 then
      raise exception 'La conversión del pedido % tiene que ser mayor que cero.', v_linea->>'pedido_id';
    end if;

    -- Ya comprado, en la unidad de la requisición. Las órdenes canceladas o
    -- rechazadas no cuentan.
    select coalesce(sum(oci.cantidad * oci.factor_unidad), 0) into v_ya_comprado
      from ordenes_compra_items oci
      join ordenes_compra oc on oc.id = oci.orden_compra_id
      where oci.pedido_insumo_id = v_pedido.id
        and oc.estado not in ('cancelada', 'rechazada');

    if v_ya_comprado >= v_pedido.cantidad then
      raise exception 'El pedido % ya está comprado completo.', v_linea->>'pedido_id';
    end if;

    if v_um_compra is not null then
      -- Presentación elegida por Compras (caja, rollo...). La cantidad y el
      -- precio por unidad del INSUMO se derivan acá, con decimales exactos.
      -- La relación insumo/requisición no se toca: es la del pedido.
      v_factor := v_pedido.factor_unidad;
      v_conversion := (v_linea->>'conversion_compra')::numeric;
      v_cant_compra := (v_linea->>'cantidad_compra')::numeric;
      v_precio_compra := coalesce((v_linea->>'precio_compra')::numeric, 0);

      if v_conversion is null or v_conversion <= 0 or v_conversion <> round(v_conversion, 4) then
        raise exception 'La conversión debe ser un número mayor que cero con máximo 4 decimales (pedido %).', v_linea->>'pedido_id';
      end if;
      if v_cant_compra is null or v_cant_compra <= 0 or v_cant_compra <> trunc(v_cant_compra) then
        raise exception 'La cantidad a comprar debe ser un número entero mayor que cero (pedido %).', v_linea->>'pedido_id';
      end if;
      if v_precio_compra < 0 then
        raise exception 'El precio no puede ser negativo (pedido %).', v_linea->>'pedido_id';
      end if;

      -- Unidades del insumo por unidad de compra: con 6 decimales, así lo
      -- recibido en Entradas (cajas enteras) suma exactamente lo ordenado.
      v_por_um := round(v_conversion / v_pedido.factor_unidad, 6);
      if v_por_um <= 0 then
        raise exception 'La conversión es demasiado pequeña para esta unidad (pedido %).', v_linea->>'pedido_id';
      end if;

      -- Se puede pasar hasta la siguiente unidad completa (13,08 m² con cajas
      -- de 2,08 -> 7 cajas), nunca una unidad más de las necesarias.
      v_maximo := ceil((v_pedido.cantidad - v_ya_comprado) / (v_por_um * v_pedido.factor_unidad) - 0.000001);
      if v_cant_compra > v_maximo then
        raise exception 'Cantidad inválida para el pedido % (se pueden comprar hasta % unidades de compra, intentas: %).',
          v_linea->>'pedido_id', v_maximo, v_cant_compra;
      end if;

      v_cantidad_solicitada := v_cant_compra * v_por_um;
      v_precio := v_precio_compra / v_por_um;
    else
      -- Unidades de compra completas que cubren lo que falta (20 kg con bultos
      -- de 50 kg -> 1). El margen evita que el ruido de los decimales sume una.
      v_maximo := ceil((v_pedido.cantidad - v_ya_comprado) / v_factor - 0.000001);

      v_cantidad_solicitada := (v_linea->>'cantidad_comprar')::numeric;
      v_precio := coalesce((v_linea->>'precio_unitario')::numeric, 0);

      if v_cantidad_solicitada <= 0 or v_cantidad_solicitada > v_maximo then
        raise exception 'Cantidad inválida para el pedido % (se pueden comprar hasta %, intentas: %).',
          v_linea->>'pedido_id', v_maximo, v_cantidad_solicitada;
      end if;
    end if;

    insert into ordenes_compra_items (
      orden_compra_id, pedido_insumo_id, cantidad, factor_unidad, precio_unitario, porcentaje_descuento, porcentaje_iva,
      um_compra, conversion_compra, cantidad_compra, precio_compra, cantidad_por_um
    )
    values (
      v_orden_id, v_pedido.id, v_cantidad_solicitada, v_factor, v_precio,
      coalesce((v_linea->>'porcentaje_descuento')::numeric, 0),
      coalesce((v_linea->>'porcentaje_iva')::numeric, 0),
      v_um_compra, v_conversion, v_cant_compra, v_precio_compra, v_por_um
    );
  end loop;

  return v_orden_id;
end;
$function$;

-- ------------------------------------------------ detalle para Entradas
-- Igual que la versión vigente, más um_compra / conversion_compra /
-- cantidad_por_um en cada línea de la orden y en cada línea de las entradas ya
-- registradas (la pantalla muestra y recibe en la unidad de compra cuando existe).
create or replace function public._detalle_orden_para_entrada(p_orden_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
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
           'um_compra', i.um_compra,
           'conversion_compra', i.conversion_compra,
           'cantidad_por_um', i.cantidad_por_um,
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
                      'um_compra', i.um_compra,
                      'conversion_compra', i.conversion_compra,
                      'cantidad_por_um', i.cantidad_por_um,
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

-- ------------------------------------------------- registrar entrada (interna)
-- p_lineas: [{ "orden_compra_item_id": uuid, "cantidad": n }]  (unidad del insumo)
--        o  [{ "orden_compra_item_id": uuid, "cantidad_compra": n }] (unidad de
--           compra de la línea: la base multiplica por cantidad_por_um).
create or replace function public._registrar_entrada_almacen(
  p_orden_id uuid,
  p_remision text,
  p_observaciones text,
  p_lineas jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden record;
  v_entrada_id uuid;
  v_linea jsonb;
  v_item record;
  v_cantidad numeric;
  v_cant_compra numeric;
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
    v_cant_compra := (v_linea->>'cantidad_compra')::numeric;
    if v_cantidad < 0 or coalesce(v_cant_compra, 0) < 0 then
      raise exception 'Las cantidades no pueden ser negativas.';
    end if;
    continue when v_cantidad = 0 and coalesce(v_cant_compra, 0) = 0;

    select i.id, i.cantidad, i.cantidad_por_um into v_item
      from ordenes_compra_items i
     where i.id = (v_linea->>'orden_compra_item_id')::uuid
       and i.orden_compra_id = p_orden_id;

    if not found then
      raise exception 'Una de las líneas no pertenece a esta orden de compra.';
    end if;

    if coalesce(v_cant_compra, 0) > 0 then
      if v_item.cantidad_por_um is null then
        raise exception 'Esta línea no se compró en otra presentación: la cantidad se recibe en la unidad del insumo.';
      end if;
      if v_cant_compra <> trunc(v_cant_compra) then
        raise exception 'Las cantidades deben ser números enteros.';
      end if;
      v_cantidad := v_cant_compra * v_item.cantidad_por_um;
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

-- --------------------------------------------------- editar entrada (interna)
-- p_lineas: [{ "id": entradas_almacen_items.id, "cantidad": n }]
--        o  [{ "id": ..., "cantidad_compra": n }] (unidad de compra).
create or replace function public._editar_entrada_almacen(
  p_entrada_id uuid,
  p_remision text,
  p_observaciones text,
  p_lineas jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ent record;
  v_proyecto uuid;
  v_linea jsonb;
  v_item record;
  v_nueva numeric;
  v_cant_compra numeric;
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
    v_cant_compra := (v_linea->>'cantidad_compra')::numeric;

    select ei.id, ei.cantidad, ei.orden_compra_item_id, oci.cantidad as ordenada, oci.cantidad_por_um,
           pe.insumo_id
      into v_item
      from entradas_almacen_items ei
      join ordenes_compra_items oci on oci.id = ei.orden_compra_item_id
      join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
     where ei.id = (v_linea->>'id')::uuid and ei.entrada_id = p_entrada_id;
    if not found then
      raise exception 'Una de las líneas no pertenece a esta entrada.';
    end if;

    if v_cant_compra is not null then
      if v_item.cantidad_por_um is null then
        raise exception 'Esta línea no se compró en otra presentación: la cantidad se recibe en la unidad del insumo.';
      end if;
      if v_cant_compra <> trunc(v_cant_compra) then
        raise exception 'Las cantidades deben ser números enteros.';
      end if;
      v_nueva := v_cant_compra * v_item.cantidad_por_um;
    end if;

    if v_nueva is null or v_nueva <= 0 then
      raise exception 'La cantidad de cada línea debe ser mayor que cero. Para quitar una línea, anula la entrada y regístrala de nuevo.';
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
