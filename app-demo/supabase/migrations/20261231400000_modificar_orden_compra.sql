-- =============================================================================
-- Modificar una orden de compra (decisión del usuario, 2026-11-05).
--
-- Compras puede cambiar una OC pendiente o aprobada mientras A&F no haya
-- enviado ninguno de sus pagos a liquidar: agregar insumos de las MISMAS
-- requisiciones que ya tiene, quitar insumos, cambiar cantidades, precios y el
-- proveedor (si se consiguió un precio mejor), y los datos de entrega y pago.
--
-- - Solo ANTES de que A&F pulse "Enviar a liquidar" en algún pago de la orden.
--   Cuenta como enviado si el pago está en liquidación (liquidacion_estado), si
--   alguna vez se envió (tiene REF: "Devolver a preparación" limpia la etapa y
--   la fecha de envío pero conserva la REF) o si se dispersó. Tampoco con
--   entradas de almacén (vigentes o anuladas: sus líneas las referencian).
-- - El soporte nuevo es OBLIGATORIO (la cotización o factura con lo que cambió);
--   los de antes se conservan.
-- - Al modificar, la orden queda POR APROBAR otra vez y sus pagos sin liquidar
--   se BORRAN (no se anulan: no deben salir dos veces en Aprobación de pagos ni
--   en el Consolidado); se crea el pago nuevo por aprobar con el total nuevo.
--   No se pierde ningún número: la REF del pago se da al enviarlo a liquidar.
-- - El historial de la orden registra "modificada" con lo de antes y después.
--
-- orden_compra_modificable(id) dice por qué no se puede (null = se puede); la
-- usa el detalle de la OC para mostrar el botón y modificar_orden_compra para
-- revisarlo con la orden y sus pagos bloqueados (A&F no puede enviar a
-- liquidar en medio).
--
-- Las líneas se validan con las mismas reglas de crear: se sacan a
-- _insertar_lineas_orden, que ahora usa también _crear_orden_compra_sin_proyecto.
-- =============================================================================

-- 1. Líneas de una orden (antes dentro de _crear_orden_compra_sin_proyecto) --

create or replace function public._insertar_lineas_orden(p_orden_id uuid, p_proyecto_id uuid, p_lineas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linea jsonb;
  v_pedido record;
  v_ya_comprado numeric;
  v_maximo numeric;
  v_factor numeric;
  v_cantidad_solicitada numeric;
  v_precio numeric;
  v_um_compra text;
  v_conversion numeric;
  v_cant_compra numeric;
  v_precio_compra numeric;
  v_por_um numeric;
begin
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La orden de compra necesita al menos un insumo.';
  end if;
  if (select count(distinct x->>'pedido_id') from jsonb_array_elements(p_lineas) x) <> jsonb_array_length(p_lineas) then
    raise exception 'Un insumo de la requisición está dos veces en la orden.';
  end if;

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
    -- rechazadas no cuentan; tampoco esta misma orden (al modificarla sus
    -- líneas se borran antes de llamar acá).
    select coalesce(sum(oci.cantidad * oci.factor_unidad), 0) into v_ya_comprado
      from ordenes_compra_items oci
      join ordenes_compra oc on oc.id = oci.orden_compra_id
      where oci.pedido_insumo_id = v_pedido.id
        and oc.id <> p_orden_id
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
      p_orden_id, v_pedido.id, v_cantidad_solicitada, v_factor, v_precio,
      coalesce((v_linea->>'porcentaje_descuento')::numeric, 0),
      coalesce((v_linea->>'porcentaje_iva')::numeric, 0),
      v_um_compra, v_conversion, v_cant_compra, v_precio_compra, v_por_um
    );
  end loop;
end;
$$;

revoke all on function public._insertar_lineas_orden(uuid, uuid, jsonb) from public, anon, authenticated;

-- Anticipo: porcentaje entre 0 y 100 (sin incluirlos) y cuándo se paga el saldo.
create or replace function public._validar_anticipo_orden(
  p_anticipo_porcentaje numeric, p_saldo_modo text, p_saldo_fecha date,
  out o_anticipo numeric, out o_modo text, out o_fecha date
)
language plpgsql
set search_path = public
as $$
begin
  o_anticipo := nullif(p_anticipo_porcentaje, 0);
  o_modo := null;
  o_fecha := null;
  if o_anticipo is null then
    return;
  end if;
  if o_anticipo <= 0 or o_anticipo >= 100 then
    raise exception 'El porcentaje del anticipo debe ser mayor que 0 y menor que 100.';
  end if;
  if p_saldo_modo is null or p_saldo_modo not in ('entrega','fecha') then
    raise exception 'Indica cuándo se paga el saldo: al ser entregado o en una fecha.';
  end if;
  o_modo := p_saldo_modo;
  if o_modo = 'fecha' then
    if p_saldo_fecha is null then
      raise exception 'Indica la fecha en que se paga el saldo.';
    end if;
    if p_saldo_fecha < (now() at time zone 'America/Bogota')::date then
      raise exception 'La fecha de pago del saldo no puede ser anterior a hoy.';
    end if;
    o_fecha := p_saldo_fecha;
  end if;
end;
$$;

revoke all on function public._validar_anticipo_orden(numeric, text, date) from public, anon, authenticated;

-- 2. Crear: igual que antes, con las líneas y el anticipo en las funciones de arriba.

create or replace function public._crear_orden_compra_sin_proyecto(
  p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date,
  p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text,
  p_condiciones_pago text, p_observaciones text, p_lineas jsonb,
  p_anticipo_porcentaje numeric default null, p_saldo_modo text default null, p_saldo_fecha date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_orden_id uuid;
  v_ant record;
begin
  if not rol_compras(auth.uid()) then
    raise exception 'No autorizado.';
  end if;

  if jsonb_array_length(p_lineas) = 0 then
    raise exception 'La orden de compra necesita al menos un insumo.';
  end if;

  select * into v_ant from public._validar_anticipo_orden(p_anticipo_porcentaje, p_saldo_modo, p_saldo_fecha);

  insert into ordenes_compra (
    proyecto_id, proveedor_id, sitio_entrega, fecha_entrega,
    contacto_nombre, telefono, ciudad, email, condiciones_pago, observaciones, created_by,
    anticipo_porcentaje, saldo_modo, saldo_fecha
  ) values (
    p_proyecto_id, p_proveedor_id, p_sitio_entrega, p_fecha_entrega,
    p_contacto_nombre, p_telefono, p_ciudad, p_email, p_condiciones_pago, p_observaciones, auth.uid(),
    v_ant.o_anticipo, v_ant.o_modo, v_ant.o_fecha
  )
  returning id into v_orden_id;

  perform public._insertar_lineas_orden(v_orden_id, p_proyecto_id, p_lineas);

  return v_orden_id;
end;
$$;

-- 3. ¿Se puede modificar? -------------------------------------------------------

create or replace function public._motivo_orden_no_modificable(p_orden_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_o record;
begin
  select estado, estado_entrega into v_o from ordenes_compra where id = p_orden_id;
  if not found then
    return 'La orden no existe.';
  end if;
  if v_o.estado not in ('pendiente_aprobacion', 'aprobada') then
    return 'Solo se puede modificar una orden pendiente o aprobada.';
  end if;
  if exists (
    select 1 from pagos
     where orden_compra_id = p_orden_id
       and estado not in ('anulado', 'rechazado')
       and (liquidacion_estado is not null
            or enviado_liquidar_en is not null
            or referencia is not null
            or estado = 'dispersado')
  ) then
    return 'A&F ya envió el pago de esta orden a liquidar: ya no se puede modificar.';
  end if;
  if v_o.estado_entrega <> 'sin_entregar'
     or exists (select 1 from entradas_almacen e where e.orden_compra_id = p_orden_id) then
    return 'La orden ya tiene entradas de almacén: ya no se puede modificar.';
  end if;
  return null;
end;
$$;

revoke all on function public._motivo_orden_no_modificable(uuid) from public, anon, authenticated;

create or replace function public.orden_compra_modificable(p_orden_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not rol_compras(auth.uid())
     or not public.usuario_puede_ver_proyecto(auth.uid(), public._proyecto_de_orden(p_orden_id)) then
    return 'No tienes permiso para modificar órdenes de compra de este proyecto.';
  end if;
  return public._motivo_orden_no_modificable(p_orden_id);
end;
$$;

revoke all on function public.orden_compra_modificable(uuid) from public, anon;
grant execute on function public.orden_compra_modificable(uuid) to authenticated;

-- 4. Modificar --------------------------------------------------------------------

create or replace function public.modificar_orden_compra(
  p_orden_id uuid,
  p_proveedor_id uuid,
  p_sitio_entrega text,
  p_fecha_entrega date,
  p_contacto_nombre text,
  p_telefono text,
  p_ciudad text,
  p_email text,
  p_condiciones_pago text,
  p_observaciones text,
  p_lineas jsonb,
  p_pago jsonb,
  p_tipo_pago text,
  p_fecha_pago_credito date default null,
  p_anticipo_porcentaje numeric default null,
  p_saldo_modo text default null,
  p_saldo_fecha date default null,
  p_titular jsonb default null,
  p_soporte jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o record;
  v_motivo text;
  v_ant record;
  v_ruta text := nullif(trim(coalesce(p_soporte->>'ruta', '')), '');
  v_tipo_soporte text := p_soporte->>'tipo';
  v_total_antes numeric;
  v_total_despues numeric;
  v_lineas_antes int;
  v_proveedor_antes text;
  v_proveedor_despues text;
  v_pagos_borrados int;
  v_uso_antes jsonb;
  v_saldo_cerrado text;
begin
  if not rol_compras(auth.uid()) then
    raise exception 'No autorizado -- no tienes permiso para comprar.';
  end if;

  select * into v_o from ordenes_compra where id = p_orden_id for update;
  if not found then
    raise exception 'La orden no existe.';
  end if;
  perform public._exigir_proyecto(v_o.proyecto_id);

  -- Con la orden bloqueada y sus pagos bloqueados: A&F no los puede enviar a
  -- liquidar mientras se modifica (enviar_pagos_a_liquidar espera y después
  -- ya no los encuentra).
  perform 1 from pagos where orden_compra_id = p_orden_id for update;
  v_motivo := public._motivo_orden_no_modificable(p_orden_id);
  if v_motivo is not null then
    raise exception '%', v_motivo;
  end if;

  if p_proveedor_id is null or not exists (select 1 from proveedores where unique_id = p_proveedor_id) then
    raise exception 'Elige el proveedor de la orden.';
  end if;
  if p_pago is null or coalesce(p_pago->>'metodo', '') not in ('transferencia', 'pse') then
    raise exception 'Elige cómo se paga la orden: Transferencia o PSE.';
  end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La orden de compra necesita al menos un insumo.';
  end if;

  -- Solo insumos de las requisiciones que ya están en la orden.
  if exists (
    select 1
      from jsonb_array_elements(p_lineas) x
      left join pedidos_insumos p on p.id = nullif(x->>'pedido_id', '')::uuid
     where p.id is null
        or p.grupo_pedido_id not in (
             select pi.grupo_pedido_id
               from ordenes_compra_items oci
               join pedidos_insumos pi on pi.id = oci.pedido_insumo_id
              where oci.orden_compra_id = p_orden_id)
  ) then
    raise exception 'Solo se pueden agregar insumos de las mismas requisiciones de la orden.';
  end if;

  -- Soporte nuevo, obligatorio (la cotización o factura con lo que cambió).
  if v_ruta is null then
    raise exception 'Adjunta el soporte de la modificación (cotización, cuenta de cobro o factura).';
  end if;
  begin
    if v_tipo_soporte is null or v_tipo_soporte not in ('cotizacion', 'cuenta_cobro', 'factura') then
      raise exception 'El soporte debe ser una cotización, una cuenta de cobro o una factura.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'ordenes_compra' and o.name = v_ruta) then
      raise exception 'No se encontró el archivo del soporte. Vuelve a adjuntarlo.';
    end if;
    if exists (select 1 from orden_compra_soportes s where s.ruta = v_ruta) then
      raise exception 'Ese archivo ya es soporte de otra orden. Vuelve a adjuntarlo.';
    end if;
  end;

  select * into v_ant from public._validar_anticipo_orden(p_anticipo_porcentaje, p_saldo_modo, p_saldo_fecha);

  v_total_antes := round(public.total_orden_compra(p_orden_id), 0);
  select count(*) into v_lineas_antes from ordenes_compra_items where orden_compra_id = p_orden_id;
  select nombre into v_proveedor_antes from proveedores where unique_id = v_o.proveedor_id;
  select nombre into v_proveedor_despues from proveedores where unique_id = p_proveedor_id;

  -- Los pagos sin liquidar se BORRAN (no se anulan): la orden vuelve a
  -- Aprobación de pagos con un solo pago nuevo. Los anulados o rechazados de
  -- antes se quedan como registro.
  delete from pagos
   where orden_compra_id = p_orden_id
     and estado in ('programado', 'solicitado', 'en_espera', 'aprobado');
  get diagnostics v_pagos_borrados = row_count;
  update pagos_fallos set resuelto_en = now()
   where orden_compra_id = p_orden_id and resuelto_en is null;

  -- Líneas nuevas con las mismas reglas de crear (cupo de cada requisición sin
  -- contar esta orden).
  -- Lo que compraba cada línea (en la unidad de la requisición): una línea con
  -- el saldo cerrado por Compras (rechazado_compras_at) no puede subir.
  select coalesce(jsonb_object_agg(pedido_insumo_id::text, cantidad * factor_unidad), '{}'::jsonb)
    into v_uso_antes
    from ordenes_compra_items where orden_compra_id = p_orden_id;

  delete from ordenes_compra_items where orden_compra_id = p_orden_id;
  perform public._insertar_lineas_orden(p_orden_id, v_o.proyecto_id, p_lineas);

  select mi.descripcion into v_saldo_cerrado
    from ordenes_compra_items oci
    join pedidos_insumos p on p.id = oci.pedido_insumo_id
    left join maestro_insumos mi on mi.id = p.insumo_id
   where oci.orden_compra_id = p_orden_id
     and p.rechazado_compras_at is not null
     and oci.cantidad * oci.factor_unidad > coalesce((v_uso_antes ->> p.id::text)::numeric, 0) + 0.000001
   limit 1;
  if found then
    raise exception '% tiene el saldo cerrado en Compras: no se puede comprar más de lo que ya traía la orden.',
      coalesce(v_saldo_cerrado, 'Un insumo');
  end if;

  if round(public.total_orden_compra(p_orden_id), 0) <= 0 then
    raise exception 'La orden de compra no puede quedar en $ 0: revisa los precios.';
  end if;
  v_total_despues := round(public.total_orden_compra(p_orden_id), 0);

  update ordenes_compra
     set proveedor_id = p_proveedor_id,
         sitio_entrega = p_sitio_entrega,
         fecha_entrega = p_fecha_entrega,
         contacto_nombre = p_contacto_nombre,
         telefono = p_telefono,
         ciudad = p_ciudad,
         email = p_email,
         condiciones_pago = p_condiciones_pago,
         observaciones = p_observaciones,
         anticipo_porcentaje = v_ant.o_anticipo,
         saldo_modo = v_ant.o_modo,
         saldo_fecha = v_ant.o_fecha,
         -- el tipo de pago se vuelve a fijar abajo (crédito no lleva anticipo)
         tipo_pago = null,
         fecha_pago_credito = null
   where id = p_orden_id;

  begin
    insert into orden_compra_soportes (orden_compra_id, tipo, ruta, nombre_archivo, tamano, mime, subido_por)
    values (p_orden_id, v_tipo_soporte, v_ruta, coalesce(nullif(trim(p_soporte->>'nombre_archivo'), ''), 'soporte'),
            nullif(p_soporte->>'tamano', '')::bigint, p_soporte->>'mime', auth.uid());
  end;

  perform public._fijar_titular_orden(p_orden_id, p_titular);
  perform public._fijar_pago_orden(p_orden_id, p_pago);
  perform public._fijar_tipo_pago_orden(p_orden_id, p_tipo_pago, p_fecha_pago_credito);

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('orden_compra', p_orden_id, 'modificada', auth.uid(),
          jsonb_build_object(
            'total_antes', v_total_antes, 'total_despues', v_total_despues,
            'lineas_antes', v_lineas_antes, 'lineas_despues', jsonb_array_length(p_lineas),
            'proveedor_antes', v_proveedor_antes, 'proveedor_despues', v_proveedor_despues,
            'pagos_borrados', v_pagos_borrados));

  -- Aprobada -> por aprobar otra vez. El disparador de estado (_oc_estado_pagos)
  -- crea el pago nuevo; si ya estaba por aprobar, se crea aquí.
  if v_o.estado = 'aprobada' then
    update ordenes_compra
       set estado = 'pendiente_aprobacion',
           aprobada_por = null,
           aprobada_at = null,
           desaprobada_por = auth.uid(),
           desaprobada_at = now(),
           motivo_desaprobacion = 'Orden modificada por Compras: vuelve a aprobación.'
     where id = p_orden_id;
  end if;
  perform public._crear_pagos_orden(p_orden_id);
end;
$$;

revoke all on function public.modificar_orden_compra(
  uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, text, date, numeric, text, date, jsonb, jsonb
) from public, anon;
grant execute on function public.modificar_orden_compra(
  uuid, uuid, text, date, text, text, text, text, text, text, jsonb, jsonb, text, date, numeric, text, date, jsonb, jsonb
) to authenticated;

-- 5. Titular aparte de la orden (para llenar el formulario al modificarla; Compras
-- no lee Terceros). Mismo formato que titular_de_acta; null = sin titular aparte.
create or replace function public.titular_de_orden(p_orden_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not exists (select 1 from public.ordenes_compra o
                  where o.id = p_orden_id and public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id)) then
    raise exception 'La orden no existe o no tienes acceso.';
  end if;
  select jsonb_build_object(
           'tercero_id', t.id, 'razon_social', t.razon_social, 'tipo_documento', t.tipo_documento,
           'numero_documento', t.numero_documento, 'dv', t.dv,
           'cuenta_id', c.id, 'banco', b.nombre, 'tipo_cuenta', c.tipo_cuenta,
           'numero_cuenta', repeat('•', greatest(length(c.numero_cuenta) - 4, 0)) || right(c.numero_cuenta, 4),
           'verificada', c.estado = 'ACTIVO')
    into v
    from public.ordenes_compra o
    join public.terceros t on t.id = o.titular_tercero_id
    join public.terceros_cuentas c on c.id = o.cuenta_tercero_id
    join public.bancos b on b.id = c.banco_id
   where o.id = p_orden_id;
  return v;
end;
$$;

revoke all on function public.titular_de_orden(uuid) from public, anon;
grant execute on function public.titular_de_orden(uuid) to authenticated;
