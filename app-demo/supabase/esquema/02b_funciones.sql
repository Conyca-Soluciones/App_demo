-- Funciones de public (2/4): crear_contratista .. inventario_proyecto.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.crear_contratista(p_id uuid, p_datos jsonb, p_documentos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo_persona text := p_datos->>'tipo_persona';
  v_requeridos text[];
  v_permitidos text[];
  v_faltan text[];
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_contratistas') then
    raise exception 'No tienes permiso para crear contratistas.';
  end if;
  if p_id is null then
    raise exception 'Falta el identificador del contratista.';
  end if;

  if v_tipo_persona = 'natural' then
    v_requeridos := array['cedula', 'rut', 'certificacion_bancaria', 'autorizacion_datos'];
    v_permitidos := v_requeridos || array['hoja_vida'];
  elsif v_tipo_persona = 'juridica' then
    v_requeridos := array['camara_comercio', 'rut', 'cedula_representante', 'certificacion_bancaria',
                          'autorizacion_datos', 'consulta_oficial_cumplimiento'];
    v_permitidos := v_requeridos;
  else
    raise exception 'Tipo de persona no válido.';
  end if;

  if jsonb_typeof(p_documentos) is distinct from 'array' then
    raise exception 'Faltan los documentos.';
  end if;

  select array_agg(r) into v_faltan
  from unnest(v_requeridos) r
  where not exists (select 1 from jsonb_array_elements(p_documentos) e where e->>'tipo' = r);
  if v_faltan is not null then
    raise exception 'Faltan documentos obligatorios: %.', array_to_string(v_faltan, ', ');
  end if;

  for d in select * from jsonb_array_elements(p_documentos) loop
    if not (d->>'tipo' = any (v_permitidos)) then
      raise exception 'El documento "%" no aplica para este tipo de persona.', d->>'tipo';
    end if;
    if left(d->>'ruta', 37) is distinct from p_id::text || '/' then
      raise exception 'La ruta del documento no corresponde a este contratista.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'contratistas' and o.name = d->>'ruta') then
      raise exception 'No se encontró el archivo de "%". Vuelve a adjuntarlo.', d->>'tipo';
    end if;
  end loop;

  insert into contratistas (
    id, tipo_persona, tipo_documento, numero_documento, digito_verificacion, nombre,
    representante_nombre, representante_tipo_documento, representante_numero_documento,
    correo, telefono, direccion, ciudad, banco, tipo_cuenta, numero_cuenta
  ) values (
    p_id, v_tipo_persona, p_datos->>'tipo_documento', p_datos->>'numero_documento',
    nullif(p_datos->>'digito_verificacion', '')::smallint, trim(p_datos->>'nombre'),
    case when v_tipo_persona = 'juridica' then nullif(trim(p_datos->>'representante_nombre'), '') end,
    case when v_tipo_persona = 'juridica' then nullif(p_datos->>'representante_tipo_documento', '') end,
    case when v_tipo_persona = 'juridica' then nullif(p_datos->>'representante_numero_documento', '') end,
    lower(trim(p_datos->>'correo')), p_datos->>'telefono', trim(p_datos->>'direccion'),
    trim(p_datos->>'ciudad'), trim(p_datos->>'banco'), p_datos->>'tipo_cuenta', p_datos->>'numero_cuenta'
  );

  insert into contratista_documentos (contratista_id, tipo, ruta, nombre_archivo, tamano, mime)
  select p_id, e->>'tipo', e->>'ruta', e->>'nombre_archivo', (e->>'tamano')::bigint, e->>'mime'
  from jsonb_array_elements(p_documentos) e;

  return p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crear_orden_compra(p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date, p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text, p_condiciones_pago text, p_observaciones text, p_lineas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orden_id uuid;
  v_linea jsonb;
  v_pedido record;
  v_ya_comprado numeric;
  v_cantidad_solicitada numeric;
begin
  if not rol_compras(auth.uid()) then
    raise exception 'No autorizado.';
  end if;

  if jsonb_array_length(p_lineas) = 0 then
    raise exception 'La orden de compra necesita al menos un insumo.';
  end if;

  insert into ordenes_compra (
    proyecto_id, proveedor_id, sitio_entrega, fecha_entrega,
    contacto_nombre, telefono, ciudad, email, condiciones_pago, observaciones, created_by
  ) values (
    p_proyecto_id, p_proveedor_id, p_sitio_entrega, p_fecha_entrega,
    p_contacto_nombre, p_telefono, p_ciudad, p_email, p_condiciones_pago, p_observaciones, auth.uid()
  )
  returning id into v_orden_id;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    select id, cantidad, proyecto_id, estado
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

    select coalesce(sum(oci.cantidad), 0) into v_ya_comprado
      from ordenes_compra_items oci
      join ordenes_compra oc on oc.id = oci.orden_compra_id
      where oci.pedido_insumo_id = v_pedido.id
        and oc.estado not in ('cancelada', 'rechazada');

    v_cantidad_solicitada := (v_linea->>'cantidad_comprar')::numeric;

    if v_cantidad_solicitada <= 0
       or v_ya_comprado + v_cantidad_solicitada > v_pedido.cantidad then
      raise exception 'Cantidad inválida para el pedido % (pedida: %, ya comprada: %, intentas: %).',
        v_linea->>'pedido_id', v_pedido.cantidad, v_ya_comprado, v_cantidad_solicitada;
    end if;

    insert into ordenes_compra_items (
      orden_compra_id, pedido_insumo_id, cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva
    )
    values (
      v_orden_id, v_pedido.id, v_cantidad_solicitada,
      coalesce((v_linea->>'precio_unitario')::numeric, 0),
      coalesce((v_linea->>'porcentaje_descuento')::numeric, 0),
      coalesce((v_linea->>'porcentaje_iva')::numeric, 0)
    );
  end loop;

  return v_orden_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crear_requisicion(p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text, p_soporte_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_numero bigint;
  v_total int;
  v_proyectos int;
  v_proyecto uuid;
  v_obs text := nullif(trim(p_observaciones), '');
  l record;
begin
  if v_uid is null then raise exception 'No autenticado.'; end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un insumo a la requisición.';
  end if;
  if p_fecha_requerida is null then raise exception 'La fecha requerida es obligatoria.'; end if;
  if p_fecha_requerida < (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha requerida no puede ser anterior a hoy.';
  end if;

  select count(*)::int, count(distinct pr.proyecto_id)::int, (array_agg(pr.proyecto_id))[1]
    into v_total, v_proyectos, v_proyecto
  from jsonb_to_recordset(p_lineas)
         as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)
  join presupuesto_items pi on pi.id = x.presupuesto_item_id
  join presupuestos pr on pr.id = pi.presupuesto_id;

  if v_total <> jsonb_array_length(p_lineas) then
    raise exception 'Hay un ítem del presupuesto que no existe.';
  end if;
  if v_proyectos <> 1 then
    raise exception 'Una requisición solo puede tener ítems de un mismo proyecto.';
  end if;

  perform pg_advisory_xact_lock(hashtext('requisicion:' || v_proyecto::text));
  if (select count(distinct (x.insumo_id, x.presupuesto_item_id))
        from jsonb_to_recordset(p_lineas)
               as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)) <> v_total then
    raise exception 'Hay un insumo repetido para el mismo ítem del presupuesto.';
  end if;

  for l in
    select * from jsonb_to_recordset(p_lineas)
      as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)
  loop
    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;
    if not public.usuario_tiene_acceso_a_item(l.presupuesto_item_id) then
      raise exception 'No tienes acceso al proyecto de este ítem.';
    end if;
    if l.item_apu_id is not null and not exists (
      select 1
      from item_apu ia
      join presupuesto_items pi2 on pi2.apu_id = ia.apu_id
      where ia.id = l.item_apu_id and pi2.id = l.presupuesto_item_id and ia.insumo_id = l.insumo_id
    ) then
      raise exception 'La línea no corresponde al APU del ítem.';
    end if;
    if l.cantidad > coalesce(public.disponible_insumo_item(l.presupuesto_item_id, l.insumo_id), 0) then
      raise exception 'La cantidad pedida supera lo disponible del presupuesto (máximo %).',
        coalesce(public.disponible_insumo_item(l.presupuesto_item_id, l.insumo_id), 0);
    end if;
  end loop;

  insert into requisiciones (id, proyecto_id, solicitado_por, fecha_requerida, urgente, observaciones, soporte_url)
  values (v_id, v_proyecto, v_uid, p_fecha_requerida, coalesce(p_urgente, false), v_obs, p_soporte_url)
  returning numero into v_numero;

  insert into pedidos_insumos
    (grupo_pedido_id, presupuesto_item_id, item_apu_id, insumo_id, cantidad,
     fecha_requerida, urgente, observaciones, soporte_url, solicitado_por)
  select v_id, x.presupuesto_item_id, x.item_apu_id, x.insumo_id, x.cantidad,
         p_fecha_requerida, coalesce(p_urgente, false), v_obs, p_soporte_url, v_uid
  from jsonb_to_recordset(p_lineas)
         as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric);

  perform public._evento_requisicion(v_id, 'creada', null,
    jsonb_build_object('numero', v_numero, 'insumos', v_total));

  return jsonb_build_object('id', v_id, 'numero', v_numero);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crear_rol(p_nombre text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_base text;
  v_clave text;
  v_n int := 1;
  v_id uuid;
begin
  perform public._exigir_administrador();
  if v_nombre = '' then
    raise exception 'El nombre del rol es obligatorio.';
  end if;

  v_base := trim(both '_' from regexp_replace(
    translate(lower(v_nombre), 'áéíóúñü', 'aeiounu'), '[^a-z0-9]+', '_', 'g'));
  if v_base = '' then v_base := 'rol'; end if;
  v_clave := v_base;
  while exists (select 1 from public.roles where clave = v_clave) loop
    v_n := v_n + 1;
    v_clave := v_base || '_' || v_n;
  end loop;

  insert into public.roles (clave, nombre, es_sistema, orden)
  values (v_clave, v_nombre, false, coalesce((select max(orden) from public.roles), 0) + 10)
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crear_solicitud_contrato(p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public._guardar_solicitud_contrato(p_id, p_datos, p_obligaciones, p_entregables, p_items, p_documentos, false)
$function$
;

CREATE OR REPLACE FUNCTION public.desaprobar_orden_compra(p_orden_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_o record;
begin
  if not public.tiene_accion(auth.uid(), 'desaprobar_oc') then
    raise exception 'No autorizado -- no tienes permiso para desaprobar órdenes de compra.';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio.';
  end if;

  select estado, estado_entrega into v_o
    from ordenes_compra where id = p_orden_id for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_o.estado <> 'aprobada' then
    raise exception 'Solo se puede desaprobar una orden aprobada.';
  end if;
  if v_o.estado_entrega <> 'sin_entregar' then
    raise exception 'La orden ya tiene material recibido: no se puede desaprobar.';
  end if;
  -- Refuerzo: aunque estado_entrega diga sin_entregar, ninguna entrada vigente.
  if exists (
    select 1
    from entradas_almacen e
    where e.orden_compra_id = p_orden_id and e.anulada_at is null
  ) then
    raise exception 'La orden tiene entradas de almacén registradas: no se puede desaprobar. Anúlalas primero.';
  end if;

  update ordenes_compra
     set estado = 'pendiente_aprobacion',
         aprobada_por = null,
         aprobada_at = null,
         desaprobada_por = auth.uid(),
         desaprobada_at = now(),
         motivo_desaprobacion = trim(p_motivo)
   where id = p_orden_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.desaprobar_pedido(p_pedido_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v record;
begin
  if not public.tiene_accion(auth.uid(), 'desaprobar_pedidos') then
    raise exception 'No autorizado -- no tienes permiso para desaprobar pedidos.';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio.';
  end if;

  select id, estado into v from pedidos_insumos where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido no existe.';
  end if;
  if v.estado <> 'aprobado' then
    raise exception 'Solo se puede desaprobar un pedido aprobado.';
  end if;
  if exists (
    select 1
    from ordenes_compra_items oci
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    where oci.pedido_insumo_id = p_pedido_id and oc.estado not in ('cancelada', 'rechazada')
  ) then
    raise exception 'El pedido ya está en una orden de compra: no se puede desaprobar. Cancela primero la orden.';
  end if;

  update pedidos_insumos
     set estado = 'pendiente',
         resuelto_por = null, resuelto_at = null, comentario_resolucion = null,
         desaprobado_por = auth.uid(), desaprobado_at = now(), motivo_desaprobacion = trim(p_motivo)
   where id = p_pedido_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.desaprobar_requisicion(p_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_motivo text := nullif(trim(p_motivo), '');
  v_n int;
begin
  if not public.tiene_accion(v_uid, 'desaprobar_pedidos') then
    raise exception 'No autorizado -- no tienes permiso para desaprobar requisiciones.';
  end if;
  if v_motivo is null then raise exception 'El motivo es obligatorio.'; end if;

  perform 1 from requisiciones where id = p_id for update;
  if not found then raise exception 'La requisición no existe.'; end if;

  if not exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado = 'aprobado') then
    raise exception 'Solo se puede desaprobar una requisición aprobada.';
  end if;
  if exists (
    select 1 from pedidos_insumos p
    where p.grupo_pedido_id = p_id and p.estado = 'aprobado' and public._comprado_pedido(p.id) > 0
  ) then
    raise exception 'La requisición ya tiene insumos en una orden de compra: no se puede desaprobar. Cancela primero la orden.';
  end if;

  update pedidos_insumos
     set estado = 'pendiente',
         resuelto_por = null, resuelto_at = null, comentario_resolucion = null,
         desaprobado_por = v_uid, desaprobado_at = now(), motivo_desaprobacion = v_motivo
   where grupo_pedido_id = p_id and estado = 'aprobado';
  get diagnostics v_n = row_count;

  perform public._evento_requisicion(p_id, 'desaprobada', v_motivo, jsonb_build_object('insumos', v_n));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.detalle_orden_para_entrada(p_orden_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.disponible_insumo_item(p_presupuesto_item_id uuid, p_insumo_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select greatest(
    (ia.cantidad * coalesce(pi.cantidad, 0)) - public._comprometido_insumo_item(pi.id, p_insumo_id),
    0
  )
  from public.presupuesto_items pi
  join public.item_apu ia on ia.apu_id = pi.apu_id and ia.insumo_id = p_insumo_id
  where pi.id = p_presupuesto_item_id;
$function$
;

CREATE OR REPLACE FUNCTION public.disponible_insumos_items(p_items uuid[], p_insumos uuid[])
 RETURNS TABLE(idx integer, disponible numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select t.idx::integer, public.disponible_insumo_item(t.item, t.insumo)
  from unnest(p_items, p_insumos) with ordinality as t(item, insumo, idx)
$function$
;

CREATE OR REPLACE FUNCTION public.documentos_tipo_contrato(p_tipo text, OUT obligatorios text[], OUT permitidos text[])
 RETURNS record
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select o, o || s
  from (values
    ('mano_obra', array['planilla_seguridad_social'], array['certificado_alturas', 'certificado_competencia_laboral']),
    ('obra', array['cronograma_actividades', 'cotizacion_aprobada'], array['polizas', 'relacion_personal']),
    ('arrendamiento', array['certificado_tradicion_libertad'], array['autorizacion_propietario']),
    ('alquiler_vehiculo', array['tarjeta_propiedad', 'revision_tecnicomecanica', 'soat', 'licencia_conduccion'], array[]::text[]),
    ('prestacion_servicios', array['certificado_eps', 'cotizacion'], array['tarjeta_profesional']),
    ('suministro_instalacion', array['planilla_seguridad_social', 'tarjeta_profesional'], array['certificado_alturas'])
  ) as t(tipo, o, s)
  where t.tipo = p_tipo
$function$
;

CREATE OR REPLACE FUNCTION public.dv_nit(p_nit text)
 RETURNS smallint
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  with d as (
    select substr(reverse(p_nit), i, 1)::int as digito,
           (array[3,7,13,17,19,23,29,37,41,43,47,53,59,67,71])[i] as peso
    from generate_series(1, length(p_nit)) i
  )
  select (case when s % 11 > 1 then 11 - s % 11 else s % 11 end)::smallint
  from (select sum(digito * peso) as s from d) t
$function$
;

CREATE OR REPLACE FUNCTION public.editar_entrada_almacen(p_entrada_id uuid, p_remision text, p_observaciones text, p_lineas jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.editar_salida_almacen(p_salida_id uuid, p_cantidad numeric, p_retira text, p_observaciones text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.eliminar_apu_huerfano()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.apu_id is not null then
    if not exists (
      select 1 from public.presupuesto_items
      where apu_id = old.apu_id and id <> old.id
    ) then
      delete from public.apu where id = old.apu_id;
    end if;
  end if;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.eliminar_rol(p_rol_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sistema boolean;
begin
  perform public._exigir_administrador();
  select es_sistema into v_sistema from public.roles where id = p_rol_id;
  if v_sistema is null then
    raise exception 'El rol no existe.';
  end if;
  if v_sistema then
    raise exception 'Los roles base no se pueden eliminar.';
  end if;
  if exists (select 1 from public.perfiles where rol_id = p_rol_id) then
    raise exception 'Hay usuarios con este rol. Cámbiales el rol antes de eliminarlo.';
  end if;
  delete from public.roles where id = p_rol_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.email_por_username(p_username text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select email
  from public.perfiles
  where username = lower(trim(p_username))
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.entradas_por_orden(p_orden_ids uuid[])
 RETURNS TABLE(orden_id uuid, entrada_id uuid, numero bigint, created_at timestamp with time zone, recibido_por uuid, recibido_por_nombre text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;

  return query
  select e.orden_compra_id, e.id, e.numero, e.created_at, e.recibido_por, pf.nombre::text
  from entradas_almacen e
  left join perfiles pf on pf.id = e.recibido_por
  where e.orden_compra_id = any(p_orden_ids)
    and e.anulada_at is null
  order by e.created_at, e.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.es_admin(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case when p.rol_id is null then p.es_admin else r.clave = 'administrador' end
    from public.perfiles p
    left join public.roles r on r.id = p.rol_id
    where p.id = p_usuario_id
  ), false)
$function$
;

CREATE OR REPLACE FUNCTION public.establecer_permiso_rol(p_rol_id uuid, p_permiso text, p_activo boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_clave text;
begin
  perform public._exigir_administrador();
  select clave into v_clave from public.roles where id = p_rol_id;
  if v_clave is null then
    raise exception 'El rol no existe.';
  end if;
  if v_clave = 'administrador' then
    raise exception 'El rol Administrador siempre tiene todos los permisos.';
  end if;

  if p_activo then
    insert into public.rol_permisos (rol_id, permiso) values (p_rol_id, p_permiso)
    on conflict do nothing;
  else
    delete from public.rol_permisos where rol_id = p_rol_id and permiso = p_permiso;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.establecer_proyectos_usuario(p_usuario_id uuid, p_todos boolean, p_proyectos uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._exigir_administrador();

  if not exists (select 1 from public.perfiles where id = p_usuario_id) then
    raise exception 'El usuario no existe.';
  end if;

  update public.perfiles set todos_los_proyectos = coalesce(p_todos, false) where id = p_usuario_id;

  delete from public.usuario_proyectos
   where usuario_id = p_usuario_id
     and not (proyecto_id = any(coalesce(p_proyectos, '{}'::uuid[])));

  insert into public.usuario_proyectos (usuario_id, proyecto_id, puede_editar)
  select p_usuario_id, x.proyecto_id, true
    from unnest(coalesce(p_proyectos, '{}'::uuid[])) as x(proyecto_id)
   where not exists (
     select 1 from public.usuario_proyectos up
     where up.usuario_id = p_usuario_id and up.proyecto_id = x.proyecto_id
   );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guardar_minuta_contrato(p_id uuid, p_datos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_contrato record;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_contratos') then
    raise exception 'No tienes permiso para editar la minuta.';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'La minuta no es válida.';
  end if;
  if octet_length(p_datos::text) > 200000 then
    raise exception 'La minuta es demasiado grande.';
  end if;

  select id, proyecto_id, estado into v_contrato from contratos where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v_contrato.proyecto_id) then
    raise exception 'La solicitud no existe o no tienes acceso.';
  end if;
  if v_contrato.estado = 'rechazada' then
    raise exception 'La solicitud fue rechazada: su minuta ya no se edita.';
  end if;

  update contratos
     set minuta_datos = p_datos,
         minuta_actualizada_at = now(),
         minuta_actualizada_por = auth.uid()
   where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.historial_entidad(p_tipo text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
begin
  if p_tipo = 'orden_compra' then
    select (public.rol_compras(auth.uid()) or public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
      into v_ok from public.ordenes_compra o where o.id = p_id;
  elsif p_tipo = 'pedido' then
    select (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id) or public.rol_compras(auth.uid()))
      into v_ok from public.pedidos_insumos p where p.id = p_id;
  elsif p_tipo = 'requisicion' then
    select exists (
      select 1 from public.pedidos_insumos p
      where p.grupo_pedido_id = p_id
        and (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
             or public.rol_compras(auth.uid())
             or public.tiene_accion(auth.uid(), 'aprobar_pedidos'))
    ) into v_ok;
  elsif p_tipo = 'contrato' then
    select (
      public.tiene_pestana(auth.uid(), 'contratos.solicitar')
      or public.tiene_pestana(auth.uid(), 'contratos.preaprobacion')
      or public.tiene_pestana(auth.uid(), 'contratos.contratos')
    ) and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
      into v_ok from public.contratos c where c.id = p_id;
  else
    raise exception 'Tipo de historial desconocido.';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;

  if p_tipo = 'requisicion' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
               'motivo', h.motivo,
               'datos', case when h.entidad_tipo = 'pedido'
                             then coalesce(h.datos, '{}'::jsonb) || jsonb_build_object('insumo', mi.descripcion)
                             else h.datos end,
               'created_at', h.created_at
             ) order by h.created_at, h.id)
        from public.historial_eventos h
        left join public.perfiles pf on pf.id = h.usuario_id
        left join public.pedidos_insumos pe on h.entidad_tipo = 'pedido' and pe.id = h.entidad_id
        left join public.maestro_insumos mi on mi.id = pe.insumo_id
       where (h.entidad_tipo = 'requisicion' and h.entidad_id = p_id)
          or (h.entidad_tipo = 'pedido' and h.evento = 'rechazado_por_compras'
              and pe.grupo_pedido_id = p_id)
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre,
             'motivo', h.motivo, 'datos', h.datos, 'created_at', h.created_at
           ) order by h.created_at, h.id)
      from public.historial_eventos h
      left join public.perfiles pf on pf.id = h.usuario_id
     where h.entidad_tipo = p_tipo and h.entidad_id = p_id
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.insumos_presupuesto_por_ids(p_version_id uuid, p_insumo_ids uuid[])
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
    and ia.insumo_id = any (p_insumo_ids)
  order by mi.descripcion, pi.codigo;
$function$
;

CREATE OR REPLACE FUNCTION public.inventario_proyecto(p_proyecto_id uuid)
 RETURNS TABLE(insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_entrada numeric, cantidad_salida numeric, cantidad_disponible numeric, costo_promedio numeric, valor_inventario numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if not (
    public._puede_gestionar_entradas()
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
$function$
;
