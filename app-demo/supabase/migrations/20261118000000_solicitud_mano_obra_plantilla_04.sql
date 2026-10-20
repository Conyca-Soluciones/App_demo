-- Solicitud de contrato de mano de obra: pide lo que necesita la plantilla
-- nueva de Jurídica (CONTRATO DE MANO DE OBRA, GJ-F-003 versión 04, 9/05/2025).
--
-- La plantilla nueva tiene la misma estructura que la de obra a todo costo:
--   * QUINTA. "Se pagará cada XXXX"           -> pago_cada_dias
--   * QUINTA, parágrafo tercero: retención    -> retencion_garantia / retencion_porcentaje
--   * DÉCIMA OCTAVA: "no se exigirá la constitución de garantías" o la tabla
--     de amparos                              -> exige_garantia
-- Antes la solicitud de mano de obra no pedía nada de esto (datos_tipo vacío).
-- Lo demás de la plantilla ya lo pedía la solicitud (plazo, valor, anticipo,
-- domicilio, correo) o sale del contratista y del proyecto.
--
-- Es la misma _guardar_solicitud_contrato de 20261109000000 (verificada igual
-- a la de producción) con el bloque de obra extendido a mano de obra. Las
-- solicitudes de mano de obra ya enviadas no cambian. _retencion_porcentaje_contrato
-- lee datos_tipo sin mirar el tipo, así que las actas de mano de obra ya
-- descuentan la retención que se pida aquí. Se puede correr más de una vez.

create or replace function public._guardar_solicitud_contrato(p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb, p_existente boolean)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_tipo text := p_datos->>'tipo';
  v_proyecto uuid := (p_datos->>'proyecto_id')::uuid;
  v_valor numeric := (p_datos->>'valor')::numeric;
  v_anexo text := p_datos->>'anexo_tipo';
  v_valor_mensual numeric := nullif(p_datos->>'valor_mensual', '')::numeric;
  v_departamento text := nullif(trim(p_datos->>'domicilio_departamento'), '');
  v_dt jsonb := coalesce(p_datos->'datos_tipo', '{}'::jsonb);
  v_datos_tipo jsonb := '{}'::jsonb;
  v_numero_dt numeric;
  v_texto_dt text;
  v_obligatorios text[];
  v_permitidos text[];
  v_faltan text[];
  v_suma numeric;
  v_numero bigint;
  v_presupuesto uuid;
  v_version uuid;
  v_actual record;
  v_pi record;
  v_cantidad numeric;
  v_valor_unitario numeric;
  v_disponible numeric;
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if p_id is null or v_proyecto is null then
    raise exception 'Faltan datos de la solicitud.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), v_proyecto) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  if p_existente then
    select id, numero, estado, proyecto_id into v_actual from contratos where id = p_id for update;
    if not found then
      raise exception 'La solicitud no existe.';
    end if;
    if v_actual.estado <> 'devuelta' then
      raise exception 'Solo se puede corregir una solicitud devuelta (esta está en otro estado; actualiza la página).';
    end if;
    if v_actual.proyecto_id <> v_proyecto then
      raise exception 'La solicitud es de otro proyecto.';
    end if;
    delete from contrato_anexo_items where contrato_id = p_id;
    delete from contrato_obligaciones where contrato_id = p_id;
    delete from contrato_entregables where contrato_id = p_id;
    delete from contrato_documentos where contrato_id = p_id;
  end if;

  if not exists (select 1 from contratistas where id = (p_datos->>'contratista_id')::uuid) then
    raise exception 'El contratista no existe.';
  end if;

  select obligatorios, permitidos into v_obligatorios, v_permitidos from public.documentos_tipo_contrato(v_tipo);
  if v_obligatorios is null then
    raise exception 'Tipo de contrato no válido.';
  end if;

  if v_anexo = 'valores_unitarios' then
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
      raise exception 'El anexo de valores unitarios necesita al menos una actividad del presupuesto.';
    end if;

    select p.id, p.version_actual_id into v_presupuesto, v_version
    from presupuestos p where p.proyecto_id = v_proyecto;
    if v_version is null then
      raise exception 'El proyecto no tiene presupuesto vigente: no se puede contratar a valores unitarios.';
    end if;

    if (select count(distinct e->>'presupuesto_item_id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items) then
      raise exception 'Hay un ítem del presupuesto repetido en el anexo.';
    end if;

    perform 1 from presupuesto_items
    where id in (select (e->>'presupuesto_item_id')::uuid from jsonb_array_elements(p_items) e)
    for update;

    for d in select * from jsonb_array_elements(p_items) loop
      select id, codigo, descripcion, cantidad, valor_unitario, version_id into v_pi
      from presupuesto_items where id = (d->>'presupuesto_item_id')::uuid;
      if not found or v_pi.version_id is distinct from v_version then
        raise exception 'Una actividad del anexo no pertenece al presupuesto vigente del proyecto.';
      end if;
      if coalesce(v_pi.cantidad, 0) <= 0 or coalesce(v_pi.valor_unitario, 0) <= 0 then
        raise exception 'El ítem % no tiene cantidad o valor en el presupuesto.', v_pi.codigo;
      end if;

      v_cantidad := (d->>'cantidad')::numeric;
      v_valor_unitario := (d->>'valor_unitario')::numeric;
      if v_cantidad is null or v_cantidad <= 0 or v_valor_unitario is null or v_valor_unitario <= 0 then
        raise exception 'El ítem % necesita cantidad y valor unitario mayores que cero.', v_pi.codigo;
      end if;
      if v_valor_unitario > v_pi.valor_unitario then
        raise exception 'El valor unitario del ítem % (%) supera el del presupuesto (%).', v_pi.codigo, v_valor_unitario, v_pi.valor_unitario;
      end if;
      v_disponible := v_pi.cantidad - public._contratado_item(v_presupuesto, v_pi.codigo);
      if v_cantidad > v_disponible then
        raise exception 'La cantidad del ítem % (%) supera lo disponible en el presupuesto (%).', v_pi.codigo, v_cantidad, greatest(v_disponible, 0);
      end if;
    end loop;

    select round(sum(round((e->>'cantidad')::numeric * (e->>'valor_unitario')::numeric, 2)), 2)
      into v_suma from jsonb_array_elements(p_items) e;
    v_valor := v_suma;
  elsif jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    raise exception 'Un contrato a valor global no lleva tabla de valores unitarios.';
  end if;

  -- Pago mensual: obligatorio en prestación de servicios, alquiler de
  -- vehículo y arrendamiento; los demás tipos no lo llevan.
  if v_tipo in ('prestacion_servicios', 'alquiler_vehiculo', 'arrendamiento') then
    if v_valor_mensual is null or v_valor_mensual <= 0 then
      raise exception 'Escribe el valor del pago mensual.';
    end if;
    if v_valor_mensual > v_valor then
      raise exception 'El pago mensual no puede ser mayor que el valor del contrato.';
    end if;
    v_valor_mensual := round(v_valor_mensual, 2);
  else
    v_valor_mensual := null;
  end if;

  -- Nuevo: departamento de domicilio (todos los tipos) y datos de la minuta
  -- según el tipo. Solo se guardan las claves que corresponden al tipo.
  if v_departamento is null then
    raise exception 'Escribe el departamento de domicilio del contrato.';
  end if;
  if jsonb_typeof(v_dt) is distinct from 'object' then
    raise exception 'Los datos del tipo de contrato no son válidos.';
  end if;
  if v_tipo in ('obra', 'mano_obra') then
    v_numero_dt := nullif(v_dt->>'pago_cada_dias', '')::numeric;
    if v_numero_dt is null or v_numero_dt <= 0 or v_numero_dt <> trunc(v_numero_dt) then
      raise exception 'Escribe cada cuántos días se paga (número entero).';
    end if;
    if (v_dt->>'retencion_garantia') is null then
      raise exception 'Indica si hay retención en garantía.';
    end if;
    v_datos_tipo := jsonb_build_object('pago_cada_dias', v_numero_dt::integer,
                                       'retencion_garantia', (v_dt->>'retencion_garantia')::boolean);
    if (v_dt->>'retencion_garantia')::boolean then
      v_numero_dt := nullif(v_dt->>'retencion_porcentaje', '')::numeric;
      if v_numero_dt is null or v_numero_dt <= 0 or v_numero_dt > 100 then
        raise exception 'Escribe el porcentaje de retención en garantía (entre 1 y 100).';
      end if;
      v_datos_tipo := v_datos_tipo || jsonb_build_object('retencion_porcentaje', round(v_numero_dt, 2));
    end if;
    -- Mano de obra (plantilla GJ-F-003 versión 04): la décima octava dice si se
    -- exigen garantías o no. En obra a todo costo siempre se exigen.
    if v_tipo = 'mano_obra' then
      if (v_dt->>'exige_garantia') is null then
        raise exception 'Indica si el contrato exige garantías.';
      end if;
      v_datos_tipo := v_datos_tipo || jsonb_build_object('exige_garantia', (v_dt->>'exige_garantia')::boolean);
    end if;
  elsif v_tipo = 'arrendamiento' then
    if nullif(trim(v_dt->>'inmueble_direccion'), '') is null then
      raise exception 'Escribe la dirección del inmueble.';
    end if;
    if nullif(trim(v_dt->>'inmueble_uso'), '') is null then
      raise exception 'Escribe el uso del inmueble.';
    end if;
    if (v_dt->>'canon_iva') is null or (v_dt->>'canon_iva') not in ('mas_iva', 'incluido') then
      raise exception 'Indica si el canon es más IVA o incluye el IVA.';
    end if;
    if (v_dt->>'servicios_incluidos') is null then
      raise exception 'Indica si el canon incluye los servicios públicos.';
    end if;
    v_texto_dt := lower(trim(v_dt->>'correo_factura'));
    if v_texto_dt is null or v_texto_dt !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Escribe un correo válido para la factura.';
    end if;
    v_datos_tipo := jsonb_build_object(
      'inmueble_direccion', trim(v_dt->>'inmueble_direccion'),
      'inmueble_uso', trim(v_dt->>'inmueble_uso'),
      'canon_iva', v_dt->>'canon_iva',
      'servicios_incluidos', (v_dt->>'servicios_incluidos')::boolean,
      'correo_factura', v_texto_dt);
  elsif v_tipo = 'alquiler_vehiculo' then
    if nullif(trim(v_dt->>'bien_nombre'), '') is null then
      raise exception 'Escribe el nombre corto del vehículo o la maquinaria.';
    end if;
    if (v_dt->>'actas') is null or (v_dt->>'actas') not in ('semanales', 'quincenales', 'mensuales', 'bimestrales') then
      raise exception 'Elige cada cuánto son las actas parciales.';
    end if;
    if (v_dt->>'exige_garantia') is null then
      raise exception 'Indica si el contrato tiene garantías.';
    end if;
    v_datos_tipo := jsonb_build_object(
      'bien_nombre', trim(v_dt->>'bien_nombre'),
      'actas', v_dt->>'actas',
      'exige_garantia', (v_dt->>'exige_garantia')::boolean);
  end if;

  -- Obligaciones específicas y entregables: al menos uno con texto (si no
  -- hay, se escribe "N/A" o "No aplica").
  if not exists (select 1 from jsonb_array_elements(coalesce(p_obligaciones, '[]')) e where trim(e #>> '{}') <> '') then
    raise exception 'Escribe al menos una obligación específica (si no hay, "N/A" o "No aplica").';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(p_entregables, '[]')) e where trim(e #>> '{}') <> '') then
    raise exception 'Escribe al menos un entregable (si no hay, "N/A" o "No aplica").';
  end if;

  if jsonb_typeof(p_documentos) is distinct from 'array' then
    raise exception 'Faltan los documentos.';
  end if;
  select array_agg(r) into v_faltan
  from unnest(v_obligatorios) r
  where not exists (select 1 from jsonb_array_elements(p_documentos) e where e->>'tipo' = r);
  if v_faltan is not null then
    raise exception 'Faltan documentos obligatorios: %.', array_to_string(v_faltan, ', ');
  end if;
  if (select count(distinct e->>'tipo') from jsonb_array_elements(p_documentos) e) <> jsonb_array_length(p_documentos) then
    raise exception 'Hay un documento repetido.';
  end if;
  for d in select * from jsonb_array_elements(p_documentos) loop
    if not (d->>'tipo' = any (v_permitidos)) then
      raise exception 'El documento "%" no aplica para este tipo de contrato.', d->>'tipo';
    end if;
    if left(d->>'ruta', 37) is distinct from p_id::text || '/' then
      raise exception 'La ruta del documento no corresponde a esta solicitud.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'contratos' and o.name = d->>'ruta') then
      raise exception 'No se encontró el archivo de "%". Vuelve a adjuntarlo.', d->>'tipo';
    end if;
  end loop;

  if p_existente then
    update contratos set
      contratista_id = (p_datos->>'contratista_id')::uuid,
      tipo = v_tipo,
      estado = 'pre_aprobacion',
      objeto = trim(p_datos->>'objeto'),
      valor = v_valor,
      anexo_tipo = v_anexo,
      valor_mensual = v_valor_mensual,
      tiene_anticipo = coalesce((p_datos->>'tiene_anticipo')::boolean, false),
      anticipo_porcentaje = nullif(p_datos->>'anticipo_porcentaje', '')::numeric,
      forma_pago = trim(p_datos->>'forma_pago'),
      plazo_tipo = p_datos->>'plazo_tipo',
      fecha_inicio = nullif(p_datos->>'fecha_inicio', '')::date,
      fecha_fin = nullif(p_datos->>'fecha_fin', '')::date,
      duracion_cantidad = nullif(p_datos->>'duracion_cantidad', '')::integer,
      duracion_unidad = nullif(p_datos->>'duracion_unidad', ''),
      correo_notificacion = lower(trim(p_datos->>'correo_notificacion')),
      observaciones = nullif(trim(p_datos->>'observaciones'), ''),
      domicilio_departamento = v_departamento,
      datos_tipo = v_datos_tipo,
      enviado_at = now()
    where id = p_id;
    v_numero := v_actual.numero;
  else
    insert into contratos (
      id, proyecto_id, contratista_id, tipo, objeto, valor, anexo_tipo, valor_mensual, tiene_anticipo, anticipo_porcentaje,
      forma_pago, plazo_tipo, fecha_inicio, fecha_fin, duracion_cantidad, duracion_unidad,
      correo_notificacion, observaciones, domicilio_departamento, datos_tipo
    ) values (
      p_id, v_proyecto, (p_datos->>'contratista_id')::uuid, v_tipo, trim(p_datos->>'objeto'), v_valor, v_anexo, v_valor_mensual,
      coalesce((p_datos->>'tiene_anticipo')::boolean, false), nullif(p_datos->>'anticipo_porcentaje', '')::numeric,
      trim(p_datos->>'forma_pago'), p_datos->>'plazo_tipo',
      nullif(p_datos->>'fecha_inicio', '')::date, nullif(p_datos->>'fecha_fin', '')::date,
      nullif(p_datos->>'duracion_cantidad', '')::integer, nullif(p_datos->>'duracion_unidad', ''),
      lower(trim(p_datos->>'correo_notificacion')), nullif(trim(p_datos->>'observaciones'), ''),
      v_departamento, v_datos_tipo
    )
    returning numero into v_numero;
  end if;

  insert into contrato_obligaciones (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_obligaciones, '[]')) with ordinality as t(v, ord)
  where trim(t.v #>> '{}') <> '';

  insert into contrato_entregables (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_entregables, '[]')) with ordinality as t(v, ord)
  where trim(t.v #>> '{}') <> '';

  insert into contrato_anexo_items (contrato_id, orden, presupuesto_item_id, actividad, unidad, cantidad, valor_unitario)
  select p_id, t.ord, pi.id, pi.descripcion, coalesce(nullif(trim(pi.unidad), ''), 'und'),
         (t.v->>'cantidad')::numeric, (t.v->>'valor_unitario')::numeric
  from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality as t(v, ord)
  join presupuesto_items pi on pi.id = (t.v->>'presupuesto_item_id')::uuid;

  insert into contrato_documentos (contrato_id, tipo, ruta, nombre_archivo, tamano, mime)
  select p_id, e->>'tipo', e->>'ruta', e->>'nombre_archivo', (e->>'tamano')::bigint, e->>'mime'
  from jsonb_array_elements(p_documentos) e;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('contrato', p_id, case when p_existente then 'reenviada' else 'creada' end, auth.uid(),
          jsonb_build_object('valor', v_valor));

  perform public._notificar_aprobadores_contrato(
    p_id,
    case when p_existente then 'Solicitud de contrato corregida' else 'Nueva solicitud de contrato' end,
    'Solicitud N° ' || v_numero || ' por revisar en pre-aprobación.'
  );

  return v_numero;
end;
$function$;
