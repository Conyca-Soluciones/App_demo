-- Solicitud de contratos: pago mensual y obligaciones/entregables obligatorios.
--
-- * contratos.valor_mensual: obligatorio (y <= valor) en prestación de
--   servicios, alquiler de vehículo y arrendamiento, además del valor del
--   contrato; null en los demás tipos.
-- * Obligaciones específicas y entregables: al menos uno con texto; si de
--   verdad no hay, el director escribe "N/A" o "No aplica".
-- Las reglas se exigen al crear y al reenviar (_guardar_solicitud_contrato,
-- copia de 20261014000000_preaprobacion_contratos.sql con estos cambios); las
-- solicitudes anteriores no se tocan (sin CHECK en la tabla: un CHECK, aun
-- "not valid", se revisaría al aprobar o devolver las viejas).
-- Igual en lib/contratos.ts (validarSolicitud).

alter table public.contratos
  add column if not exists valor_mensual numeric(18, 2) check (valor_mensual > 0);

create or replace function public._guardar_solicitud_contrato(
  p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb,
  p_existente boolean
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := p_datos->>'tipo';
  v_proyecto uuid := (p_datos->>'proyecto_id')::uuid;
  v_valor numeric := (p_datos->>'valor')::numeric;
  v_anexo text := p_datos->>'anexo_tipo';
  v_valor_mensual numeric := nullif(p_datos->>'valor_mensual', '')::numeric;
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
      enviado_at = now()
    where id = p_id;
    v_numero := v_actual.numero;
  else
    insert into contratos (
      id, proyecto_id, contratista_id, tipo, objeto, valor, anexo_tipo, valor_mensual, tiene_anticipo, anticipo_porcentaje,
      forma_pago, plazo_tipo, fecha_inicio, fecha_fin, duracion_cantidad, duracion_unidad,
      correo_notificacion, observaciones
    ) values (
      p_id, v_proyecto, (p_datos->>'contratista_id')::uuid, v_tipo, trim(p_datos->>'objeto'), v_valor, v_anexo, v_valor_mensual,
      coalesce((p_datos->>'tiene_anticipo')::boolean, false), nullif(p_datos->>'anticipo_porcentaje', '')::numeric,
      trim(p_datos->>'forma_pago'), p_datos->>'plazo_tipo',
      nullif(p_datos->>'fecha_inicio', '')::date, nullif(p_datos->>'fecha_fin', '')::date,
      nullif(p_datos->>'duracion_cantidad', '')::integer, nullif(p_datos->>'duracion_unidad', ''),
      lower(trim(p_datos->>'correo_notificacion')), nullif(trim(p_datos->>'observaciones'), '')
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
$$;
revoke all on function public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
