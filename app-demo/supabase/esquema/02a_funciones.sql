-- Funciones de public (1/4): _comprado_pedido .. comprado_pedidos.
-- Tal cual pg_get_functiondef en producción (2026-10-02).
-- Sin revisar cuerpos al crear: unas funciones usan otras de archivos siguientes.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public._comprado_pedido(p_pedido_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(oci.cantidad), 0)
  from ordenes_compra_items oci
  join ordenes_compra oc on oc.id = oci.orden_compra_id
  where oci.pedido_insumo_id = p_pedido_id
    and oc.estado not in ('cancelada', 'rechazada')
$function$
;

CREATE OR REPLACE FUNCTION public._comprometido_insumo_item(p_presupuesto_item_id uuid, p_insumo_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(
    case
      when p.rechazado_compras_at is null then p.cantidad
      else coalesce((
        select sum(oci.cantidad)
        from ordenes_compra_items oci
        join ordenes_compra oc on oc.id = oci.orden_compra_id
        where oci.pedido_insumo_id = p.id
          and oc.estado not in ('cancelada', 'rechazada')
      ), 0)
    end
  ), 0)
  from presupuesto_items este
  join presupuesto_items mismo_item
    on mismo_item.presupuesto_id = este.presupuesto_id
   and mismo_item.codigo = este.codigo
  join pedidos_insumos p
    on p.presupuesto_item_id = mismo_item.id
   and p.insumo_id = p_insumo_id
   and p.estado in ('pendiente', 'aprobado')
  where este.id = p_presupuesto_item_id
$function$
;

CREATE OR REPLACE FUNCTION public._contratado_item(p_presupuesto_id uuid, p_codigo text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(ai.cantidad), 0)
  from public.contrato_anexo_items ai
  join public.contratos c on c.id = ai.contrato_id
  join public.presupuesto_items p2 on p2.id = ai.presupuesto_item_id
  where p2.presupuesto_id = p_presupuesto_id and p2.codigo = p_codigo
    and c.estado <> 'rechazada'
$function$
;

CREATE OR REPLACE FUNCTION public._disponible_insumo_proyecto(p_proyecto_id uuid, p_insumo_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public._evento_requisicion(p_id uuid, p_evento text, p_motivo text DEFAULT NULL::text, p_datos jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('requisicion', p_id, p_evento, auth.uid(), p_motivo, p_datos)
$function$
;

CREATE OR REPLACE FUNCTION public._exigir_administrador()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'Solo un Administrador puede hacer esto.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._guardar_solicitud_contrato(p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb, p_existente boolean)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public._notificar_aprobadores_contrato(p_contrato_id uuid, p_titulo text, p_mensaje text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'contrato_por_revisar', 'contrato', c.id, p_titulo, p_mensaje
  from contratos c
  cross join perfiles pf
  join roles r on r.id = pf.rol_id
  where c.id = p_contrato_id
    and r.clave in ('legal', 'lider_legal')
    and pf.id is distinct from auth.uid()
    and public.tiene_accion(pf.id, 'aprobar_contratos')
    and public.usuario_puede_ver_proyecto(pf.id, c.proyecto_id)
$function$
;

CREATE OR REPLACE FUNCTION public._puede_gestionar_entradas()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.tiene_accion(auth.uid(), 'gestionar_almacen') $function$
;

CREATE OR REPLACE FUNCTION public._recalcular_estado_entrega(p_orden_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public._recibido_linea_oc(p_oci uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(ei.cantidad), 0)
  from entradas_almacen_items ei
  join entradas_almacen e on e.id = ei.entrada_id
  where ei.orden_compra_item_id = p_oci and e.anulada_at is null;
$function$
;

CREATE OR REPLACE FUNCTION public._registrar_salida_almacen(p_proyecto_id uuid, p_lineas jsonb, p_retira text, p_observaciones text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public._resumen_capitulos_proyecto_base(p_proyecto_id uuid)
 RETURNS TABLE(capitulo_id uuid, capitulo_nombre text, valor_presupuestado numeric, valor_comprado numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Agrupa presupuesto_items por su capítulo raíz (nivel = 1, padre_id null)
  -- subiendo por la cadena padre_id, y cruza contra el valor realmente
  -- comprado (OC aprobadas) para ese capítulo, vía
  -- pedidos_insumos.presupuesto_item_id -> ordenes_compra_items.
  -- Security definer por el mismo motivo que resumen_ejecucion_proyecto:
  -- cruza tablas con RLS pensada para flujos distintos (presupuestos,
  -- compras). El gate de autorización (solo admin) vive en la server
  -- action que llama a esta función, no acá.
  with presupuesto_del_proyecto as (
    select p.version_actual_id
    from presupuestos p
    where p.proyecto_id = p_proyecto_id
    order by p.created_at desc
    limit 1
  ),
  ascenso as (
    with recursive asc_rec as (
      select id, id as item_original_id, padre_id, nivel
      from presupuesto_items
      where version_id = (select version_actual_id from presupuesto_del_proyecto)
      union all
      select pi.id, a.item_original_id, pi.padre_id, pi.nivel
      from presupuesto_items pi
      join asc_rec a on pi.id = a.padre_id
    )
    select item_original_id, id as capitulo_id
    from asc_rec
    where nivel = 1
  ),
  presupuestado as (
    select asc_.capitulo_id, sum(pi.valor_total) as valor_presupuestado
    from presupuesto_items pi
    join ascenso asc_ on asc_.item_original_id = pi.id
    where pi.version_id = (select version_actual_id from presupuesto_del_proyecto)
      and pi.apu_id is not null
    group by asc_.capitulo_id
  ),
  comprado as (
    select asc_.capitulo_id,
      sum(oci.cantidad * oci.precio_unitario * (1 - oci.porcentaje_descuento / 100.0) * (1 + oci.porcentaje_iva / 100.0)) as valor_comprado
    from ordenes_compra_items oci
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
    join ascenso asc_ on asc_.item_original_id = pe.presupuesto_item_id
    where oc.proyecto_id = p_proyecto_id and oc.estado = 'aprobada'
    group by asc_.capitulo_id
  ),
  todos_los_capitulos as (
    select capitulo_id from presupuestado
    union
    select capitulo_id from comprado
  )
  select
    t.capitulo_id,
    pc.descripcion as capitulo_nombre,
    coalesce(presupuestado.valor_presupuestado, 0) as valor_presupuestado,
    coalesce(comprado.valor_comprado, 0) as valor_comprado
  from todos_los_capitulos t
  join presupuesto_items pc on pc.id = t.capitulo_id
  left join presupuestado on presupuestado.capitulo_id = t.capitulo_id
  left join comprado on comprado.capitulo_id = t.capitulo_id
  order by coalesce(presupuestado.valor_presupuestado, 0) desc;
$function$
;

CREATE OR REPLACE FUNCTION public._resumen_ejecucion_proyecto_base(p_proyecto_id uuid)
 RETURNS TABLE(insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_presupuestada numeric, valor_presupuestado numeric, cantidad_pedida numeric, cantidad_comprada numeric, valor_comprado numeric, cantidad_salida numeric, valor_salida numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select pe.insumo_id, sum(case when pe.rechazado_compras_at is null then pe.cantidad else coalesce((select sum(oci2.cantidad) from ordenes_compra_items oci2 join ordenes_compra oc2 on oc2.id = oci2.orden_compra_id where oci2.pedido_insumo_id = pe.id and oc2.estado not in ('cancelada', 'rechazada')), 0) end) as cantidad_pedida
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
$function$
;

-- Depende de _resumen_ejecucion_proyecto_base (arriba).
CREATE OR REPLACE FUNCTION public._resumen_ejecucion_proyecto(p_proyecto_id uuid)
 RETURNS TABLE(insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_presupuestada numeric, valor_presupuestado numeric, cantidad_pedida numeric, cantidad_comprada numeric, valor_comprado numeric, cantidad_salida numeric, valor_salida numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.tiene_pestana(auth.uid(), 'admin.visualizacion')
          and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)) then
    raise exception 'No tienes permiso para ver la ejecución de este proyecto.';
  end if;
  return query select * from public._resumen_ejecucion_proyecto_base(p_proyecto_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_insumos(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.tiene_accion(p_usuario_id, 'aprobar_insumos') $function$
;

CREATE OR REPLACE FUNCTION public.admin_proyectos(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.tiene_accion(p_usuario_id, 'aprobar_pedidos') $function$
;

CREATE OR REPLACE FUNCTION public.admin_usuarios(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case when p.rol_id is null then p.es_admin or p.admin_usuarios else r.clave = 'administrador' end
    from public.perfiles p
    left join public.roles r on r.id = p.rol_id
    where p.id = p_usuario_id
  ), false)
$function$
;

CREATE OR REPLACE FUNCTION public.anular_entrada_almacen(p_entrada_id uuid, p_motivo text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.anular_salida_almacen(p_salida_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.aprobar_orden_compra(p_orden_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_oc') then
    raise exception 'No autorizado -- no tienes permiso para aprobar órdenes de compra.';
  end if;

  update ordenes_compra
    set estado = 'aprobada', aprobada_por = auth.uid(), aprobada_at = now(), motivo_rechazo = null
    where id = p_orden_id and estado = 'pendiente_aprobacion';

  if not found then
    raise exception 'La orden no existe o ya no está pendiente de aprobación.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.asignar_rol_usuario(p_usuario_id uuid, p_rol_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_clave text;
  v_es_admin_ahora boolean;
begin
  perform public._exigir_administrador();

  if not exists (select 1 from public.perfiles where id = p_usuario_id) then
    raise exception 'El usuario no existe.';
  end if;
  if p_rol_id is not null then
    select clave into v_clave from public.roles where id = p_rol_id;
    if v_clave is null then
      raise exception 'El rol no existe.';
    end if;
  end if;

  v_es_admin_ahora := public.es_admin(p_usuario_id);

  if v_es_admin_ahora and coalesce(v_clave, '') <> 'administrador' then
    if p_usuario_id = auth.uid() then
      raise exception 'No puedes quitarte tu propio acceso de Administrador.';
    end if;
    if not exists (
      select 1 from public.perfiles p
      where p.id <> p_usuario_id and public.es_admin(p.id)
    ) then
      raise exception 'Debe quedar al menos un Administrador.';
    end if;
  end if;

  update public.perfiles set rol_id = p_rol_id where id = p_usuario_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.autocompletar_proyecto_id_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF new.proyecto_id IS NULL AND new.presupuesto_item_id IS NOT NULL THEN
    SELECT pres.proyecto_id INTO new.proyecto_id
    FROM public.presupuesto_items item
    JOIN public.presupuestos pres ON pres.id = item.presupuesto_id
    WHERE item.id = new.presupuesto_item_id;
  END IF;
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.buscar_equipo_candidatos(p_termino text, p_limite integer DEFAULT 50)
 RETURNS SETOF equipo_categorias
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select *
  from public.equipo_categorias
  order by categoria <-> p_termino
  limit p_limite
$function$
;

CREATE OR REPLACE FUNCTION public.buscar_insumos_candidatos(p_termino text, p_tipos text[] DEFAULT NULL::text[], p_limite integer DEFAULT 300)
 RETURNS SETOF maestro_insumos
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select *
  from public.maestro_insumos
  where p_tipos is null or tipo = any(p_tipos)
  order by descripcion <-> p_termino
  limit p_limite
$function$
;

CREATE OR REPLACE FUNCTION public.buscar_insumos_candidatos_lote(p_terminos text[], p_limite integer DEFAULT 50)
 RETURNS TABLE(idx integer, candidatos jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select t.idx::integer,
         coalesce(
           (select jsonb_agg(to_jsonb(m) order by m.distancia)
            from (
              select mi.*, mi.descripcion <-> t.termino as distancia
              from public.maestro_insumos mi
              order by mi.descripcion <-> t.termino
              limit p_limite
            ) m),
           '[]'::jsonb
         )
  from unnest(p_terminos) with ordinality as t(termino, idx)
$function$
;

CREATE OR REPLACE FUNCTION public.buscar_insumos_presupuesto(p_version_id uuid, p_query text DEFAULT NULL::text, p_limite integer DEFAULT 50)
 RETURNS TABLE(presupuesto_item_id uuid, item_codigo text, item_descripcion text, item_apu_id uuid, insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_apu numeric, rendimiento numeric, cantidad_maxima numeric, cantidad_comprometida numeric, cantidad_disponible numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    pi.id,
    pi.codigo,
    pi.descripcion,
    ia.id,
    mi.id,
    mi.codigo,
    mi.descripcion,
    mi.u_m,
    ia.cantidad,
    ia.rendimiento,
    (ia.cantidad * coalesce(pi.cantidad, 0)),
    c.total,
    greatest((ia.cantidad * coalesce(pi.cantidad, 0)) - c.total, 0)
  from public.presupuesto_items pi
  join public.item_apu ia        on ia.apu_id = pi.apu_id
  join public.maestro_insumos mi on mi.id = ia.insumo_id
  cross join lateral (select public._comprometido_insumo_item(pi.id, mi.id) as total) c
  where pi.version_id = p_version_id
    and pi.apu_id is not null
    and (
      p_query is null
      or p_query = ''
      or mi.descripcion ilike '%' || p_query || '%'
      or mi.codigo::text ilike '%' || p_query || '%'
      or pi.codigo ilike '%' || p_query || '%'
    )
  order by mi.descripcion, pi.codigo
  limit p_limite;
$function$
;

CREATE OR REPLACE FUNCTION public.buscar_items_apu_candidatos(p_termino text, p_limite integer DEFAULT 300)
 RETURNS TABLE(id uuid, apu_id uuid, descripcion text, codigo text, unidad text, valor_unitario numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select id, apu_id, descripcion, codigo, unidad, valor_unitario
  from public.presupuesto_items
  where apu_id is not null
  order by descripcion <-> p_termino
  limit p_limite
$function$
;

CREATE OR REPLACE FUNCTION public.buscar_mano_obra_candidatos(p_termino text, p_limite integer DEFAULT 50)
 RETURNS SETOF mano_obra_categorias
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select *
  from public.mano_obra_categorias
  order by categoria <-> p_termino
  limit p_limite
$function$
;

CREATE OR REPLACE FUNCTION public.cancelar_orden_compra(p_orden_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_o record;
  v_puede boolean := public.tiene_accion(auth.uid(), 'cancelar_oc');
begin
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;

  select estado, estado_entrega, created_by into v_o
    from ordenes_compra where id = p_orden_id for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;

  if v_o.estado = 'pendiente_aprobacion' then
    if not (v_puede or v_o.created_by = auth.uid()) then
      raise exception 'Solo quien creó la orden, o quien tenga permiso de cancelar órdenes, puede retirarla.';
    end if;
  elsif v_o.estado = 'aprobada' then
    if not v_puede then
      raise exception 'No autorizado -- no tienes permiso para cancelar órdenes de compra.';
    end if;
    if v_o.estado_entrega <> 'sin_entregar' then
      raise exception 'No se puede cancelar: la orden ya tiene material recibido (entrega parcial o entregada).';
    end if;
    if exists (
      select 1 from entradas_almacen e
      where e.orden_compra_id = p_orden_id and e.anulada_at is null
    ) then
      raise exception 'No se puede cancelar: la orden tiene entradas de almacén registradas. Anúlalas primero.';
    end if;
  else
    raise exception 'Solo se puede cancelar una orden pendiente de aprobación o aprobada.';
  end if;

  update ordenes_compra
     set estado = 'cancelada',
         cancelada_por = auth.uid(),
         cancelada_at = now(),
         motivo_cancelacion = trim(p_motivo)
   where id = p_orden_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancelar_pedido(p_pedido_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v record;
begin
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;

  select id, estado, solicitado_por into v from pedidos_insumos where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido no existe.';
  end if;
  if v.solicitado_por is distinct from auth.uid() then
    raise exception 'Solo quien hizo la requisición puede cancelarla.';
  end if;
  if v.estado <> 'pendiente' then
    raise exception 'Solo se puede cancelar una requisición pendiente de aprobación.';
  end if;

  update pedidos_insumos
     set estado = 'cancelado', cancelado_por = auth.uid(), cancelado_at = now(),
         motivo_cancelacion = trim(p_motivo)
   where id = p_pedido_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cancelar_requisicion(p_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_h record;
  v_motivo text := nullif(trim(p_motivo), '');
  v_n int;
begin
  if v_motivo is null then raise exception 'El motivo de cancelación es obligatorio.'; end if;

  select * into v_h from requisiciones where id = p_id for update;
  if not found then raise exception 'La requisición no existe.'; end if;
  if v_h.solicitado_por is distinct from v_uid then
    raise exception 'Solo quien hizo la requisición puede cancelarla.';
  end if;

  perform 1 from pedidos_insumos where grupo_pedido_id = p_id for update;
  if exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado not in ('pendiente', 'cancelado'))
     or not exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado = 'pendiente') then
    raise exception 'Solo se puede cancelar una requisición pendiente de aprobación.';
  end if;

  update pedidos_insumos
     set estado = 'cancelado', cancelado_por = v_uid, cancelado_at = now(), motivo_cancelacion = v_motivo
   where grupo_pedido_id = p_id and estado = 'pendiente';
  get diagnostics v_n = row_count;

  perform public._evento_requisicion(p_id, 'cancelada', v_motivo, jsonb_build_object('insumos', v_n));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.completar_email_perfil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.email is null then
    select email into new.email from auth.users where id = new.id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.comprado_pedidos(p_ids uuid[])
 RETURNS TABLE(pedido_id uuid, comprado numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, public._comprado_pedido(p.id)
  from pedidos_insumos p
  where p.id = any(p_ids)
$function$
;
