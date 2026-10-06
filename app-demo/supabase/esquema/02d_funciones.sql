-- ---------------------------------------------------------------------------
-- Esquema REAL de la base de producción (proyecto Supabase "App-demo"),
-- sacado con solo lectura el 2026-10-02. Ver supabase/esquema/README.md.
-- No es una migración: no aplicar sobre la base real.
-- ---------------------------------------------------------------------------
-- Funciones de public (4/4): registrar_entrada_almacen .. vincular_apus_masivo.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.registrar_entrada_almacen(p_orden_id uuid, p_remision text, p_observaciones text, p_lineas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_salida_almacen(p_proyecto_id uuid, p_lineas jsonb, p_retira text, p_observaciones text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    begin
      if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
        raise exception 'No tienes acceso a este proyecto.';
      end if;
      return public._registrar_salida_almacen(p_proyecto_id, p_lineas, p_retira, p_observaciones);
    end;
    $function$
;

CREATE OR REPLACE FUNCTION public.resolver_requisicion(p_id uuid, p_estado text, p_comentario text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_h record;
  v_motivo text := nullif(trim(p_comentario), '');
  v_n int;
begin
  if not public.tiene_accion(v_uid, 'aprobar_pedidos') then
    raise exception 'No autorizado -- no tienes permiso para aprobar requisiciones.';
  end if;
  if p_estado not in ('aprobado', 'rechazado') then
    raise exception 'Estado inválido.';
  end if;
  if p_estado = 'rechazado' and v_motivo is null then
    raise exception 'Escribe el motivo del rechazo.';
  end if;

  select * into v_h from requisiciones where id = p_id for update;
  if not found then raise exception 'La requisición no existe.'; end if;

  update pedidos_insumos
     set estado = p_estado, resuelto_por = v_uid, resuelto_at = now(),
         comentario_resolucion = v_motivo
   where grupo_pedido_id = p_id and estado = 'pendiente';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Esta requisición ya no está pendiente (la cancelaron o ya fue resuelta). Actualiza la página.';
  end if;

  perform public._evento_requisicion(p_id,
    case p_estado when 'aprobado' then 'aprobada' else 'rechazada' end, v_motivo,
    jsonb_build_object('insumos', v_n));

  perform public.notificar_una(
    v_h.solicitado_por,
    case p_estado when 'aprobado' then 'pedido_aprobado' else 'pedido_rechazado' end,
    'requisicion', p_id,
    case p_estado when 'aprobado' then 'Requisición aprobada' else 'Requisición rechazada' end,
    'Tu requisición #' || v_h.numero || ' fue ' ||
      case p_estado when 'aprobado' then 'aprobada' else 'rechazada' end || '.' ||
      case when p_estado = 'rechazado' then ' Motivo: ' || v_motivo else '' end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolver_solicitud_contrato(p_id uuid, p_accion text, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_estado text;
  v_evento text;
  v_tipo_notif text;
  v_titulo text;
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_contratos') then
    raise exception 'No tienes permiso para aprobar contratos.';
  end if;
  select id, numero, estado, proyecto_id, solicitado_por into v from contratos where id = p_id for update;
  if not found or not public.usuario_puede_ver_proyecto(auth.uid(), v.proyecto_id) then
    raise exception 'La solicitud no existe o no tienes acceso.';
  end if;
  if v.estado <> 'pre_aprobacion' then
    raise exception 'Esta solicitud ya no está en pre-aprobación (actualiza la página).';
  end if;

  if p_accion = 'aprobar' then
    v_estado := 'aprobada'; v_evento := 'aprobada'; v_tipo_notif := 'contrato_aprobado'; v_titulo := 'Contrato pre-aprobado';
  elsif p_accion = 'devolver' then
    v_estado := 'devuelta'; v_evento := 'devuelta'; v_tipo_notif := 'contrato_devuelto'; v_titulo := 'Solicitud de contrato devuelta';
  elsif p_accion = 'rechazar' then
    v_estado := 'rechazada'; v_evento := 'rechazada'; v_tipo_notif := 'contrato_rechazado'; v_titulo := 'Solicitud de contrato rechazada';
  else
    raise exception 'Acción no válida.';
  end if;
  if p_accion in ('devolver', 'rechazar') and v_motivo is null then
    raise exception 'Escribe el motivo.';
  end if;

  update contratos
     set estado = v_estado, resuelto_por = auth.uid(), resuelto_at = now(),
         motivo_resolucion = case when p_accion = 'aprobar' then motivo_resolucion else v_motivo end
   where id = p_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
  values ('contrato', p_id, v_evento, auth.uid(), v_motivo);

  if v.solicitado_por is not null and v.solicitado_por is distinct from auth.uid() then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (v.solicitado_por, v_tipo_notif, 'contrato', p_id, v_titulo,
            'Solicitud N° ' || v.numero || case
              when p_accion = 'aprobar' then ' pre-aprobada por Jurídica.'
              when p_accion = 'devolver' then ' devuelta para corregir. Motivo: ' || v_motivo
              else ' rechazada. Motivo: ' || v_motivo end);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resumen_capitulos_proyecto(p_proyecto_id uuid)
 RETURNS TABLE(capitulo_id uuid, capitulo_nombre text, valor_presupuestado numeric, valor_comprado numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.tiene_pestana(auth.uid(), 'admin.visualizacion')
          and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)) then
    raise exception 'No tienes permiso para ver la ejecución de este proyecto.';
  end if;
  return query select * from public._resumen_capitulos_proyecto_base(p_proyecto_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resumen_ejecucion_proyecto(p_proyecto_id uuid)
 RETURNS TABLE(insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_presupuestada numeric, valor_presupuestado numeric, cantidad_pedida numeric, cantidad_comprada numeric, valor_comprado numeric, cantidad_salida numeric, valor_salida numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    begin
      if pg_trigger_depth() = 0 and not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
        raise exception 'No tienes acceso a este proyecto.';
      end if;
      return query select * from public._resumen_ejecucion_proyecto(p_proyecto_id);
    end;
    $function$
;

CREATE OR REPLACE FUNCTION public.rol_compras(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.tiene_accion(p_usuario_id, 'comprar') $function$
;

CREATE OR REPLACE FUNCTION public.sincronizar_apu_import_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_insumo_id uuid;
  v_apu_id uuid;
begin
  -- Solo actuar si el estado de verdad cambió, y solo para transiciones
  -- desde 'pendiente' -- evita re-disparar si algo más toca la fila.
  if new.estado = old.estado or old.estado <> 'pendiente' then
    return new;
  end if;

  if new.estado = 'aprobado' then
    select id into v_insumo_id
    from public.maestro_insumos
    where codigo = new.codigo_maestro_asignado;

    if v_insumo_id is null then
      return new; -- no debería pasar, pero por seguridad no truena el trigger
    end if;

    -- una fila de item_apu por cada línea de revisión pendiente de esta
    -- solicitud (normalmente es una sola, pero no se asume)
    for v_apu_id in
      select distinct r.apu_id
      from public.apu_import_revision r
      where r.solicitud_id = new.id and r.item_apu_id is null
    loop
      insert into public.item_apu (apu_id, insumo_id, cantidad, tipo, rendimiento)
      select r.apu_id, v_insumo_id, r.cantidad, r.tipo, 1
      from public.apu_import_revision r
      where r.solicitud_id = new.id and r.apu_id = v_apu_id and r.item_apu_id is null;

      perform public.recalcular_valor_apu(v_apu_id);
    end loop;

    update public.apu_import_revision r
    set estado = 'resuelto',
        insumo_id_asignado = v_insumo_id,
        item_apu_id = ia.id
    from public.item_apu ia
    where r.solicitud_id = new.id
      and r.item_apu_id is null
      and ia.apu_id = r.apu_id
      and ia.insumo_id = v_insumo_id;

  elsif new.estado = 'rechazado' then
    update public.apu_import_revision
    set estado = 'rechazado'
    where solicitud_id = new.id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sincronizar_apu_import_revision_equipo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_apu_id uuid;
begin
  if new.estado = old.estado or old.estado <> 'pendiente' then
    return new;
  end if;

  if new.estado = 'aprobado' then
    if new.categoria_asignada_id is null then
      return new;
    end if;

    -- Mismo fix que mano de obra, más rendimiento (coalesce a 1 si la
    -- línea no trajo uno -- ver nota arriba sobre el parser del Excel).
    for v_apu_id in
      select distinct r.apu_id
      from public.apu_import_revision r
      where r.solicitud_equipo_id = new.id and r.item_apu_id is null
    loop
      insert into public.item_apu (apu_id, equipo_categoria_id, cantidad, rendimiento)
      select r.apu_id, new.categoria_asignada_id, r.cantidad, coalesce(r.rendimiento, 1)
      from public.apu_import_revision r
      where r.solicitud_equipo_id = new.id
        and r.apu_id = v_apu_id
        and r.item_apu_id is null;

      perform public.recalcular_valor_apu(v_apu_id);
    end loop;

    update public.apu_import_revision r
    set estado = 'resuelto',
        equipo_categoria_id_asignado = new.categoria_asignada_id,
        item_apu_id = ia.id
    from public.item_apu ia
    where r.solicitud_equipo_id = new.id
      and r.item_apu_id is null
      and ia.apu_id = r.apu_id
      and ia.equipo_categoria_id = new.categoria_asignada_id;

  elsif new.estado = 'rechazado' then
    update public.apu_import_revision
    set estado = 'rechazado'
    where solicitud_equipo_id = new.id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sincronizar_apu_import_revision_mano_obra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_apu_id uuid;
begin
  if new.estado = old.estado or old.estado <> 'pendiente' then
    return new;
  end if;

  if new.estado = 'aprobado' then
    if new.categoria_asignada_id is null then
      return new;
    end if;

    -- Antes: un solo INSERT ... VALUES (v_apu_id, categoria_id, 1, 1) por
    -- apu_id, sin importar cuántas líneas de apu_import_revision había.
    -- Ahora: una fila de item_apu POR CADA línea real, con su propia
    -- cantidad -- mismo patrón que sincronizar_apu_import_revision (insumos).
    for v_apu_id in
      select distinct r.apu_id
      from public.apu_import_revision r
      where r.solicitud_mano_obra_id = new.id and r.item_apu_id is null
    loop
      insert into public.item_apu (apu_id, mano_obra_categoria_id, cantidad, rendimiento)
      select r.apu_id, new.categoria_asignada_id, r.cantidad, 1
      from public.apu_import_revision r
      where r.solicitud_mano_obra_id = new.id
        and r.apu_id = v_apu_id
        and r.item_apu_id is null;

      perform public.recalcular_valor_apu(v_apu_id);
    end loop;

    update public.apu_import_revision r
    set estado = 'resuelto',
        mano_obra_categoria_id_asignado = new.categoria_asignada_id,
        item_apu_id = ia.id
    from public.item_apu ia
    where r.solicitud_mano_obra_id = new.id
      and r.item_apu_id is null
      and ia.apu_id = r.apu_id
      and ia.mano_obra_categoria_id = new.categoria_asignada_id;

  elsif new.estado = 'rechazado' then
    update public.apu_import_revision
    set estado = 'rechazado'
    where solicitud_mano_obra_id = new.id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sincronizar_email_perfil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update perfiles set email = new.email where id = new.id;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.test_fase1_compras()
 RETURNS TABLE(prueba text, resultado text, detalle text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_proyecto_a uuid;
  v_proyecto_b uuid;
  v_presupuesto_item uuid;
  v_insumo uuid;
  v_perfil uuid;
  v_pedido1 uuid;
  v_pedido2 uuid;
  v_proveedor uuid;
  v_oc_a uuid;
  v_oc_b uuid;
  v_codigo1 int;
  v_codigo2 int;
begin
  select id into v_proyecto_a from public.proyectos limit 1;
  select pi.id into v_presupuesto_item
    from public.presupuesto_items pi
    join public.presupuestos p on p.id = pi.presupuesto_id
    where p.proyecto_id = v_proyecto_a
    limit 1;
  select id into v_insumo from public.maestro_insumos limit 1;
  select id into v_perfil from public.perfiles limit 1;

  insert into public.pedidos_insumos
    (grupo_pedido_id, presupuesto_item_id, insumo_id, cantidad, fecha_requerida, estado, solicitado_por, proyecto_id)
  values
    (gen_random_uuid(), v_presupuesto_item, v_insumo, 100, current_date + 7, 'aprobado', v_perfil, v_proyecto_a)
  returning id, codigo_consecutivo into v_pedido1, v_codigo1;

  insert into public.pedidos_insumos
    (grupo_pedido_id, presupuesto_item_id, insumo_id, cantidad, fecha_requerida, estado, solicitado_por, proyecto_id)
  values
    (gen_random_uuid(), v_presupuesto_item, v_insumo, 20, current_date + 10, 'aprobado', v_perfil, v_proyecto_a)
  returning id, codigo_consecutivo into v_pedido2, v_codigo2;

  prueba := 'Código consecutivo se asigna solo al crear'; resultado := 'PASS';
  detalle := format('códigos asignados: %s y %s', v_codigo1, v_codigo2);
  return next;

  insert into public.proveedores (nombre, nit, contacto_nombre, telefono, email, ciudad)
  values ('Ferretería de Prueba', '900123456-1', 'Juan Pérez', '3001234567', 'juan@ferreteria.test', 'Yopal')
  returning id into v_proveedor;

  insert into public.ordenes_compra (proyecto_id, proveedor_id, sitio_entrega, fecha_entrega, contacto_nombre, telefono, ciudad, email, created_by)
  values (v_proyecto_a, v_proveedor, 'Obra de prueba', current_date + 5, 'Sofía Pérez', '3009876543', 'Yopal', 'sofia@conyca.test', v_perfil)
  returning id into v_oc_a;

  update public.pedidos_insumos
  set orden_compra_id = v_oc_a, cantidad_comprar = 50
  where id = v_pedido1;

  prueba := 'Asignar pedido a OC del mismo proyecto'; resultado := 'PASS';
  detalle := 'se asignó sin error';
  return next;

  begin
    update public.pedidos_insumos set cantidad_comprar = 150 where id = v_pedido1;
    prueba := 'Tope: no comprar más de lo pedido'; resultado := 'FAIL';
    detalle := 'dejó comprar 150 sobre un pedido de 100';
  exception when check_violation then
    prueba := 'Tope: no comprar más de lo pedido'; resultado := 'PASS';
    detalle := 'bloqueó cantidad_comprar=150 (pedido era 100)';
  end;
  return next;

  insert into public.proyectos (nombre, codigo) values ('PROYECTO TEST TEMPORAL', 'TEST-000')
  returning id into v_proyecto_b;

  insert into public.ordenes_compra (proyecto_id, proveedor_id, created_by)
  values (v_proyecto_b, v_proveedor, v_perfil)
  returning id into v_oc_b;

  begin
    update public.pedidos_insumos
    set orden_compra_id = v_oc_b, cantidad_comprar = 20
    where id = v_pedido2;
    prueba := 'No mezclar proyectos en una OC'; resultado := 'FAIL';
    detalle := 'dejó mezclar proyecto A en OC del proyecto B';
  exception when others then
    prueba := 'No mezclar proyectos en una OC'; resultado := 'PASS';
    detalle := sqlerrm;
  end;
  return next;

  update public.ordenes_compra set enviada = true where id = v_oc_a;

  begin
    update public.pedidos_insumos set cantidad_comprar = 60 where id = v_pedido1;
    prueba := 'OC enviada queda congelada'; resultado := 'FAIL';
    detalle := 'dejó editar una línea de una OC ya enviada';
  exception when others then
    prueba := 'OC enviada queda congelada'; resultado := 'PASS';
    detalle := sqlerrm;
  end;
  return next;

  update public.ordenes_compra set enviada = false where id = v_oc_a;
  delete from public.pedidos_insumos where id in (v_pedido1, v_pedido2);
  delete from public.ordenes_compra where id in (v_oc_a, v_oc_b);
  delete from public.proveedores where id = v_proveedor;
  delete from public.proyectos where id = v_proyecto_b;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tiene_accion(p_usuario_id uuid, p_accion text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when p.rol_id is null then
        case p_accion
          when 'comprar'             then p.es_admin or p.rol_compras
          when 'aprobar_insumos'     then p.es_admin or p.admin_insumos
          when 'gestionar_almacen'   then p.es_admin or p.admin_insumos
          when 'aprobar_pedidos'     then p.es_admin or p.admin_proyectos or p.admin_insumos
          when 'desaprobar_pedidos'  then p.es_admin or p.admin_proyectos or p.admin_insumos
          when 'cancelar_pedidos'    then p.es_admin or p.admin_proyectos or p.admin_insumos
          when 'aprobar_mano_obra'   then p.es_admin or p.admin_mano_obra
          else p.es_admin  -- aprobar/desaprobar/cancelar OC, editar_presupuestos (por proyecto)
        end
      else
        r.clave = 'administrador'
        or exists (
          select 1 from public.rol_permisos rp
          where rp.rol_id = p.rol_id and rp.permiso = 'accion.' || p_accion
        )
    end
    from public.perfiles p
    left join public.roles r on r.id = p.rol_id
    where p.id = p_usuario_id
  ), false)
$function$
;

CREATE OR REPLACE FUNCTION public.tiene_pestana(p_usuario_id uuid, p_clave text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when p.rol_id is null then p.es_admin
      else r.clave = 'administrador'
        or exists (
          select 1 from public.rol_permisos rp
          where rp.rol_id = p.rol_id and rp.permiso = 'tab.' || p_clave
        )
    end
    from public.perfiles p
    left join public.roles r on r.id = p.rol_id
    where p.id = p_usuario_id
  ), false)
$function$
;

CREATE OR REPLACE FUNCTION public.tiene_scope_admin(p_usuario_id uuid, p_columna text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case p_columna
    when 'admin_insumos'   then public.admin_insumos(p_usuario_id)
    when 'admin_proyectos' then public.admin_proyectos(p_usuario_id)
    when 'admin_usuarios'  then public.admin_usuarios(p_usuario_id)
    else public.es_admin(p_usuario_id)
  end
$function$
;

CREATE OR REPLACE FUNCTION public.trg_historial_orden_compra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_evento text;
  v_usuario uuid;
  v_motivo text;
begin
  if tg_op = 'INSERT' then
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('orden_compra', new.id, 'creada', coalesce(new.created_by, auth.uid()),
            jsonb_build_object('numero', new.numero));
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'pendiente_aprobacion' and new.estado = 'aprobada' then
      v_evento := 'aprobada';  v_usuario := coalesce(new.aprobada_por, auth.uid());
    elsif old.estado = 'pendiente_aprobacion' and new.estado = 'rechazada' then
      v_evento := 'rechazada'; v_usuario := coalesce(new.aprobada_por, auth.uid()); v_motivo := new.motivo_rechazo;
    elsif old.estado = 'aprobada' and new.estado = 'pendiente_aprobacion' then
      v_evento := 'desaprobada'; v_usuario := coalesce(new.desaprobada_por, auth.uid()); v_motivo := new.motivo_desaprobacion;
    elsif new.estado = 'cancelada' then
      v_evento := 'cancelada'; v_usuario := coalesce(new.cancelada_por, auth.uid()); v_motivo := new.motivo_cancelacion;
    else
      v_evento := 'estado_cambiado'; v_usuario := auth.uid();
    end if;

    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
    values ('orden_compra', new.id, v_evento, v_usuario, v_motivo,
            jsonb_build_object('estado_anterior', old.estado, 'estado_nuevo', new.estado));
  end if;

  if new.estado_entrega is distinct from old.estado_entrega then
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('orden_compra', new.id, 'entrega_actualizada', auth.uid(),
            jsonb_build_object('de', old.estado_entrega, 'a', new.estado_entrega));
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_historial_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_evento text;
  v_usuario uuid;
  v_motivo text;
begin
  if tg_op = 'INSERT' then
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('pedido', new.id, 'creado', coalesce(new.solicitado_por, auth.uid()),
            jsonb_build_object('cantidad', new.cantidad, 'fecha_requerida', new.fecha_requerida,
                               'urgente', new.urgente));
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if old.estado = 'pendiente' and new.estado = 'aprobado' then
      v_evento := 'aprobado';  v_usuario := coalesce(new.resuelto_por, auth.uid()); v_motivo := new.comentario_resolucion;
    elsif old.estado = 'pendiente' and new.estado = 'rechazado' then
      v_evento := 'rechazado'; v_usuario := coalesce(new.resuelto_por, auth.uid()); v_motivo := new.comentario_resolucion;
    elsif old.estado = 'aprobado' and new.estado = 'pendiente' then
      v_evento := 'desaprobado'; v_usuario := coalesce(new.desaprobado_por, auth.uid()); v_motivo := new.motivo_desaprobacion;
    elsif new.estado = 'cancelado' then
      v_evento := 'cancelado'; v_usuario := coalesce(new.cancelado_por, auth.uid()); v_motivo := new.motivo_cancelacion;
    else
      v_evento := 'estado_cambiado'; v_usuario := auth.uid();
    end if;

    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
    values ('pedido', new.id, v_evento, v_usuario, v_motivo,
            jsonb_build_object('estado_anterior', old.estado, 'estado_nuevo', new.estado));

  elsif new.cantidad is distinct from old.cantidad
     or new.fecha_requerida is distinct from old.fecha_requerida
     or new.urgente is distinct from old.urgente
     or new.observaciones is distinct from old.observaciones then
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('pedido', new.id, 'modificado', auth.uid(),
            jsonb_build_object(
              'antes', jsonb_build_object('cantidad', old.cantidad, 'fecha_requerida', old.fecha_requerida,
                                          'urgente', old.urgente, 'observaciones', old.observaciones),
              'despues', jsonb_build_object('cantidad', new.cantidad, 'fecha_requerida', new.fecha_requerida,
                                            'urgente', new.urgente, 'observaciones', new.observaciones)));
  end if;

  if old.rechazado_compras_at is null and new.rechazado_compras_at is not null then
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo)
    values ('pedido', new.id, 'rechazado_por_compras',
            coalesce(new.rechazado_compras_por, auth.uid()), new.observaciones_compras);
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.usuario_puede_editar_proyecto(p_usuario_id uuid, p_proyecto_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when coalesce((select p.rol_id is null from public.perfiles p where p.id = p_usuario_id), true) then (
      public.es_admin(p_usuario_id)
      or exists (
        select 1
        from public.usuario_grupos ug
        join public.grupos g on g.id = ug.grupo_id
        where ug.usuario_id = p_usuario_id
          and g.ve_todos_proyectos = true
          and g.puede_editar_todos = true
      )
      or exists (
        select 1 from public.usuario_proyectos up
        where up.usuario_id = p_usuario_id and up.proyecto_id = p_proyecto_id and up.puede_editar = true
      )
      or exists (
        select 1
        from public.usuario_grupos ug
        join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id
        where ug.usuario_id = p_usuario_id and gp.proyecto_id = p_proyecto_id and gp.puede_editar = true
      )
    )
    else
      public.tiene_accion(p_usuario_id, 'editar_presupuestos')
      and public.usuario_puede_ver_proyecto(p_usuario_id, p_proyecto_id)
  end
$function$
;

CREATE OR REPLACE FUNCTION public.usuario_puede_ver_proyecto(p_usuario_id uuid, p_proyecto_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.es_admin(p_usuario_id)
    or public.usuario_ve_todos_proyectos(p_usuario_id)
    or exists (
      select 1 from public.usuario_proyectos up
      where up.usuario_id = p_usuario_id and up.proyecto_id = p_proyecto_id
    )
    -- Los grupos solo cuentan para usuarios que todavía no tienen rol.
    or exists (
      select 1
      from public.perfiles pf
      join public.usuario_grupos ug on ug.usuario_id = pf.id
      join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id
      where pf.id = p_usuario_id and pf.rol_id is null and gp.proyecto_id = p_proyecto_id
    )
$function$
;

CREATE OR REPLACE FUNCTION public.usuario_tiene_acceso_a_item(p_presupuesto_item_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.presupuesto_items pi
    join public.presupuestos p on p.id = pi.presupuesto_id
    where pi.id = p_presupuesto_item_id
      and (
        public.usuario_puede_ver_proyecto(auth.uid(), p.proyecto_id)
        -- quienes aprueban insumos o pedidos ven los pedidos de todos los proyectos
        or public.admin_insumos(auth.uid())
        or public.admin_proyectos(auth.uid())
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.usuario_ve_todos_proyectos(p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select case
      when p.rol_id is null then exists (
        select 1
        from public.usuario_grupos ug
        join public.grupos g on g.id = ug.grupo_id
        where ug.usuario_id = p_usuario_id and g.ve_todos_proyectos = true
      )
      else p.todos_los_proyectos
    end
    from public.perfiles p
    where p.id = p_usuario_id
  ), false)
$function$
;

CREATE OR REPLACE FUNCTION public.verificar_orden_compra_editable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_enviada boolean;
begin
  if old.orden_compra_id is not null then
    select enviada into v_enviada from public.ordenes_compra where id = old.orden_compra_id;
    if v_enviada and (
      new.cantidad_comprar is distinct from old.cantidad_comprar
      or new.orden_compra_id is distinct from old.orden_compra_id
    ) then
      raise exception 'La orden de compra % ya fue marcada como enviada, no se puede modificar', old.orden_compra_id;
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verificar_proyecto_orden_compra()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_proyecto_orden uuid;
begin
  if new.orden_compra_id is not null then
    select proyecto_id into v_proyecto_orden
    from public.ordenes_compra
    where id = new.orden_compra_id;

    if v_proyecto_orden is distinct from new.proyecto_id then
      raise exception 'La orden de compra % es del proyecto %, no se puede asignar un pedido del proyecto %',
        new.orden_compra_id, v_proyecto_orden, new.proyecto_id;
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verificar_salida_no_supera_disponible()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_comprado numeric;
  v_ya_salido numeric;
begin
  select coalesce(sum(oci.cantidad), 0) into v_comprado
  from ordenes_compra_items oci
  join ordenes_compra oc on oc.id = oci.orden_compra_id
  join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
  where oc.proyecto_id = new.proyecto_id and oc.estado = 'aprobada' and pe.insumo_id = new.insumo_id;

  select coalesce(sum(s.cantidad), 0) into v_ya_salido
  from salidas_insumos s
  where s.proyecto_id = new.proyecto_id and s.insumo_id = new.insumo_id and s.id <> new.id and s.anulada_at is null;

  if v_ya_salido + new.cantidad > v_comprado then
    raise exception 'La salida (%) supera lo disponible en bodega para este insumo (comprado: %, ya registrado como salida: %).',
      new.cantidad, v_comprado, v_ya_salido;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.vincular_apus_masivo(vinculos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if jsonb_typeof(vinculos) is distinct from 'array' then
    raise exception 'Datos inválidos.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(vinculos) v
    left join presupuesto_items pi on pi.id = (v->>'item_id')::uuid
    left join presupuestos pr on pr.id = pi.presupuesto_id
    where pi.id is null or not public.usuario_puede_editar_proyecto(auth.uid(), pr.proyecto_id)
  ) then
    raise exception 'No tienes permiso para editar uno de los ítems del presupuesto.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(vinculos) v
    where v->>'apu_id' is not null and not exists (select 1 from apu a where a.id = (v->>'apu_id')::uuid)
  ) then
    raise exception 'Uno de los APU no existe.';
  end if;

  update public.presupuesto_items pi
     set apu_id = (v->>'apu_id')::uuid
    from jsonb_array_elements(vinculos) as v
   where pi.id = (v->>'item_id')::uuid;
end;
$function$
;
