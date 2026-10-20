-- Ningún permiso se salta los proyectos asignados (hallazgo E3 de la revisión
-- por roles; regla del usuario 2026-10-20: el acceso sale de la matriz de
-- Roles y permisos y de Usuarios y accesos, sin reglas escondidas).
--
-- VA DESPUÉS de las migraciones de la auditoría de RLS
-- (20261118400000 ... 20261118430000): redefine políticas que esas crean.
--
-- Antes, algunas acciones daban TODOS los proyectos aunque la persona solo
-- tuviera uno asignado:
--   * Comprar: la lista de proyectos (por eso Compras veía COMFIAR), todas las
--     órdenes de compra con sus precios y todas las requisiciones; y crear OC,
--     rechazar líneas en Compras y cerrar saldos no revisaban el proyecto.
--   * Aprobar / rechazar / desaprobar / cancelar OC: las funciones no revisaban
--     el proyecto de la orden.
--   * Aprobar requisiciones y Aprobar insumos: todas las requisiciones; y
--     resolver o desaprobar una requisición no revisaba el proyecto.
--   * El historial de órdenes y requisiciones con Comprar o Aprobar requisiciones.
-- Ahora cada permiso vale en los proyectos de la persona: los que tiene
-- asignados en Usuarios y accesos, o todos si ahí tiene "Todos los proyectos"
-- (el Administrador siempre todos). Los usuarios reales con estos permisos
-- (Líder Compras, Líder Técnico, Gerencia) ya tienen "Todos los proyectos".
--
-- Lo que sigue siendo global a propósito: los catálogos sin proyecto
-- (proveedores e informacion_bancaria para Compras, maestra de insumos,
-- histórico de precios) y A&F (pagos, consolidado, terceros: es de toda la
-- empresa; generar_pagos_orden y resolicitar_pago no cambian).
--
-- Las funciones de escritura se envuelven: la original queda con el sufijo
-- "_sin_proyecto" (sin EXECUTE para usuarios) y la de siempre revisa el
-- proyecto y la llama. Mismo patrón que 20261024000000 (almacén por proyecto).

-- ============================================================== POLÍTICAS
-- La lista de proyectos: solo proyectos_visibles ("ver proyectos permitidos").
drop policy if exists proyectos_select_compras on public.proyectos;

drop policy if exists ordenes_compra_select on public.ordenes_compra;
create policy ordenes_compra_select on public.ordenes_compra
  for select to authenticated
  using (
    (select public.rol_compras((select auth.uid())))
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );

drop policy if exists ordenes_compra_items_select on public.ordenes_compra_items;
create policy ordenes_compra_items_select on public.ordenes_compra_items
  for select to authenticated
  using (
    (select public.rol_compras((select auth.uid())))
    and exists (
      select 1 from public.ordenes_compra oc
      where oc.id = ordenes_compra_items.orden_compra_id
        and oc.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
    )
  );

drop policy if exists pedidos_insumos_select_compras on public.pedidos_insumos;
create policy pedidos_insumos_select_compras on public.pedidos_insumos
  for select to authenticated
  using (
    (select public.rol_compras((select auth.uid())))
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );

-- Aprobar insumos / aprobar requisiciones: también solo sus proyectos. El
-- resto es la versión de 20261118400000 sin cambios.
drop policy if exists pedidos_insumos_select on public.pedidos_insumos;
create policy pedidos_insumos_select on public.pedidos_insumos
  for select to authenticated
  using (
    (
      ((select public.admin_insumos((select auth.uid())))
        or (select public.admin_proyectos((select auth.uid()))))
      and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
    )
    or (
      (select public.tiene_pestana((select auth.uid()), 'tecnico.pedidos')
           or public.tiene_pestana((select auth.uid()), 'tecnico.registro_pedidos')
           or public.tiene_pestana((select auth.uid()), 'tecnico.aprobar_pedidos'))
      and exists (
        select 1
        from public.presupuesto_items pi
        join public.presupuestos p on p.id = pi.presupuesto_id
        where pi.id = pedidos_insumos.presupuesto_item_id
          and (
            p.proyecto_id in (select public.proyectos_visibles((select auth.uid())))
            or (p.proyecto_id is null
                and (select public.usuario_puede_ver_proyecto((select auth.uid()), null::uuid)))
          )
      )
    )
  );

-- ============================================================== AYUDAS
-- Falla si el proyecto no existe o la persona no lo ve.
create or replace function public._exigir_proyecto(p_proyecto_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if p_proyecto_id is null or not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No existe o no tienes acceso a este proyecto.';
  end if;
end;
$function$;
revoke all on function public._exigir_proyecto(uuid) from public, anon, authenticated;

create or replace function public._proyecto_de_pedido(p_pedido_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $function$
  select proyecto_id from public.pedidos_insumos where id = p_pedido_id
$function$;
revoke all on function public._proyecto_de_pedido(uuid) from public, anon, authenticated;

create or replace function public._proyecto_de_requisicion(p_requisicion_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $function$
  select proyecto_id from public.requisiciones where id = p_requisicion_id
$function$;
revoke all on function public._proyecto_de_requisicion(uuid) from public, anon, authenticated;

-- ============================================================== ENVOLTURAS
-- Renombrar solo la primera vez (se puede correr más de una vez).
do $do$
declare
  v record;
begin
  for v in
    select * from (values
      ('crear_orden_compra',      'uuid, uuid, text, date, text, text, text, text, text, text, jsonb, numeric, text, date'),
      ('aprobar_orden_compra',    'uuid'),
      ('rechazar_orden_compra',   'uuid, text'),
      ('desaprobar_orden_compra', 'uuid, text'),
      ('cancelar_orden_compra',   'uuid, text'),
      ('rechazar_pedido_compras', 'uuid, text'),
      ('cerrar_saldo_pedido',     'uuid, text'),
      ('desaprobar_pedido',       'uuid, text'),
      ('resolver_requisicion',    'uuid, text, text'),
      ('desaprobar_requisicion',  'uuid, text')
    ) as f(nombre, args)
  loop
    if to_regprocedure(format('public._%s_sin_proyecto(%s)', v.nombre, v.args)) is null then
      execute format('alter function public.%I(%s) rename to %I', v.nombre, v.args, '_' || v.nombre || '_sin_proyecto');
    end if;
    execute format('revoke all on function public.%I(%s) from public, anon, authenticated', '_' || v.nombre || '_sin_proyecto', v.args);
  end loop;
end
$do$;

create or replace function public.crear_orden_compra(
  p_proyecto_id uuid, p_proveedor_id uuid, p_sitio_entrega text, p_fecha_entrega date,
  p_contacto_nombre text, p_telefono text, p_ciudad text, p_email text,
  p_condiciones_pago text, p_observaciones text, p_lineas jsonb,
  p_anticipo_porcentaje numeric default null, p_saldo_modo text default null, p_saldo_fecha date default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._exigir_proyecto(p_proyecto_id);
  return public._crear_orden_compra_sin_proyecto(
    p_proyecto_id, p_proveedor_id, p_sitio_entrega, p_fecha_entrega,
    p_contacto_nombre, p_telefono, p_ciudad, p_email,
    p_condiciones_pago, p_observaciones, p_lineas,
    p_anticipo_porcentaje, p_saldo_modo, p_saldo_fecha);
end;
$function$;

create or replace function public.aprobar_orden_compra(p_orden_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._exigir_proyecto(public._proyecto_de_orden(p_orden_id));
  perform public._aprobar_orden_compra_sin_proyecto(p_orden_id);
end;
$function$;

create or replace function public.rechazar_orden_compra(p_orden_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._exigir_proyecto(public._proyecto_de_orden(p_orden_id));
  perform public._rechazar_orden_compra_sin_proyecto(p_orden_id, p_motivo);
end;
$function$;

create or replace function public.desaprobar_orden_compra(p_orden_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._exigir_proyecto(public._proyecto_de_orden(p_orden_id));
  perform public._desaprobar_orden_compra_sin_proyecto(p_orden_id, p_motivo);
end;
$function$;

create or replace function public.cancelar_orden_compra(p_orden_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._exigir_proyecto(public._proyecto_de_orden(p_orden_id));
  perform public._cancelar_orden_compra_sin_proyecto(p_orden_id, p_motivo);
end;
$function$;

create or replace function public.rechazar_pedido_compras(p_pedido_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._exigir_proyecto(public._proyecto_de_pedido(p_pedido_id));
  perform public._rechazar_pedido_compras_sin_proyecto(p_pedido_id, p_motivo);
end;
$function$;

create or replace function public.cerrar_saldo_pedido(p_pedido_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._exigir_proyecto(public._proyecto_de_pedido(p_pedido_id));
  perform public._cerrar_saldo_pedido_sin_proyecto(p_pedido_id, p_motivo);
end;
$function$;

create or replace function public.desaprobar_pedido(p_pedido_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._exigir_proyecto(public._proyecto_de_pedido(p_pedido_id));
  perform public._desaprobar_pedido_sin_proyecto(p_pedido_id, p_motivo);
end;
$function$;

create or replace function public.resolver_requisicion(p_id uuid, p_estado text, p_comentario text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._exigir_proyecto(public._proyecto_de_requisicion(p_id));
  perform public._resolver_requisicion_sin_proyecto(p_id, p_estado, p_comentario);
end;
$function$;

create or replace function public.desaprobar_requisicion(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform public._exigir_proyecto(public._proyecto_de_requisicion(p_id));
  perform public._desaprobar_requisicion_sin_proyecto(p_id, p_motivo);
end;
$function$;

grant execute on function public.crear_orden_compra(uuid, uuid, text, date, text, text, text, text, text, text, jsonb, numeric, text, date) to authenticated;
grant execute on function public.aprobar_orden_compra(uuid) to authenticated;
grant execute on function public.rechazar_orden_compra(uuid, text) to authenticated;
grant execute on function public.desaprobar_orden_compra(uuid, text) to authenticated;
grant execute on function public.cancelar_orden_compra(uuid, text) to authenticated;
grant execute on function public.rechazar_pedido_compras(uuid, text) to authenticated;
grant execute on function public.cerrar_saldo_pedido(uuid, text) to authenticated;
grant execute on function public.desaprobar_pedido(uuid, text) to authenticated;
grant execute on function public.resolver_requisicion(uuid, text, text) to authenticated;
grant execute on function public.desaprobar_requisicion(uuid, text) to authenticated;

-- ============================================================== HISTORIAL
-- Copia de la versión de 20261118200000 con tres cambios: órdenes de compra,
-- líneas de requisición y requisiciones ya no se abren por Comprar ni por
-- Aprobar requisiciones; hace falta ver el proyecto.
create or replace function public.historial_entidad(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_ok boolean;
  v_uid uuid := auth.uid();
begin
  if p_tipo = 'orden_compra' then
    select public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id)
      into v_ok from public.ordenes_compra o where o.id = p_id;
  elsif p_tipo = 'pedido' then
    select public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
      into v_ok from public.pedidos_insumos p where p.id = p_id;
  elsif p_tipo = 'requisicion' then
    select exists (
      select 1 from public.pedidos_insumos p
      where p.grupo_pedido_id = p_id
        and public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
    ) into v_ok;
  elsif p_tipo = 'contrato' then
    select (
      public.tiene_pestana(v_uid, 'contratos.solicitar')
      or public.tiene_pestana(v_uid, 'contratos.preaprobacion')
      or public.tiene_pestana(v_uid, 'contratos.contratos')
      or public.tiene_pestana(v_uid, 'contratos.aprobar_minutas')
      or public.tiene_pestana(v_uid, 'admin.visualizacion')
    ) and public.usuario_puede_ver_proyecto(v_uid, c.proyecto_id)
      into v_ok from public.contratos c where c.id = p_id;
  elsif p_tipo = 'acta' then
    select public.puede_ver_actas(c.proyecto_id)
      into v_ok from public.actas a join public.contratos c on c.id = a.contrato_id where a.id = p_id;
  elsif p_tipo = 'pago' then
    select (public.tiene_pestana(v_uid, 'ayf.aprobacion_pagos') or public.tiene_pestana(v_uid, 'ayf.consolidado'))
      into v_ok from public.pagos where id = p_id;
  elsif p_tipo = 'tercero' then
    select (public.tiene_pestana(v_uid, 'ayf.terceros')
            or public.tiene_pestana(v_uid, 'ayf.aprobacion_pagos')
            or public.tiene_pestana(v_uid, 'ayf.consolidado'))
      into v_ok from public.terceros where id = p_id;
  elsif p_tipo = 'proveedor' then
    select (public.rol_compras(v_uid) or public.es_admin(v_uid) or public.tiene_pestana(v_uid, 'almacen.proveedores'))
      into v_ok from public.proveedores where unique_id = p_id;
  elsif p_tipo = 'contratista' then
    select (public.tiene_pestana(v_uid, 'contratos.contratistas')
            or public.tiene_pestana(v_uid, 'contratos.preaprobacion')
            or public.tiene_pestana(v_uid, 'contratos.aprobar_minutas')
            or public.tiene_pestana(v_uid, 'admin.visualizacion')
            or public.tiene_accion(v_uid, 'gestionar_contratistas')
            or public.tiene_accion(v_uid, 'solicitar_contratos'))
      into v_ok from public.contratistas where id = p_id;
  elsif p_tipo = 'entrada' then
    select ((public.tiene_pestana(v_uid, 'almacen.entradas') or public.rol_compras(v_uid))
            and public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id))
      into v_ok
      from public.entradas_almacen e join public.ordenes_compra o on o.id = e.orden_compra_id
     where e.id = p_id;
  elsif p_tipo = 'salida' then
    select (public.tiene_pestana(v_uid, 'almacen.salidas') and public.usuario_puede_ver_proyecto(v_uid, s.proyecto_id))
      into v_ok from public.salidas_insumos s where s.id = p_id;
  elsif p_tipo = 'presupuesto' then
    select public.usuario_puede_ver_proyecto(v_uid, p.proyecto_id)
      into v_ok from public.presupuestos p where p.id = p_id;
  elsif p_tipo in ('rol', 'usuario', 'solicitud_insumo', 'solicitud_mano_obra', 'solicitud_equipo') then
    v_ok := false;  -- solo el Administrador (abajo)
  else
    raise exception 'Tipo de historial desconocido.';
  end if;

  -- El Administrador ve todo, también lo que ya se borró (presupuesto descartado...).
  if not coalesce(v_ok, false) and not public.es_admin(v_uid) then
    raise exception 'No tienes permiso para ver este historial.';
  end if;

  if p_tipo = 'requisicion' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
               'motivo', h.motivo,
               'datos', case when h.entidad_tipo = 'pedido'
                             then coalesce(h.datos, '{}'::jsonb) || jsonb_build_object('insumo', mi.descripcion)
                             else h.datos end,
               'created_at', h.created_at
             ) order by h.created_at, h.id)
        from public.historial_eventos h
        left join public.perfiles pf on pf.id = h.usuario_id
        left join public.roles r on r.id = pf.rol_id
        left join public.pedidos_insumos pe on h.entidad_tipo = 'pedido' and pe.id = h.entidad_id
        left join public.maestro_insumos mi on mi.id = pe.insumo_id
       where (h.entidad_tipo = 'requisicion' and h.entidad_id = p_id)
          or (h.entidad_tipo = 'pedido' and h.evento = 'rechazado_por_compras'
              and pe.grupo_pedido_id = p_id)
    ), '[]'::jsonb);
  end if;

  if p_tipo = 'tercero' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ev.id::text, 'evento', ev.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
               'motivo', null, 'datos', ev.datos, 'created_at', ev.creado_en
             ) order by ev.creado_en, ev.id)
        from public._eventos_terceros_auditoria(
               array(select a.id from public.terceros_auditoria a
                      where (a.tabla = 'terceros' and a.registro_id = p_id)
                         or (a.tabla = 'terceros_cuentas'
                             and a.registro_id in (select c.id from public.terceros_cuentas c where c.tercero_id = p_id)))
             ) ev
        left join public.perfiles pf on pf.id = ev.usuario_id
        left join public.roles r on r.id = pf.rol_id
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', h.id, 'evento', h.evento, 'usuario_nombre', pf.nombre, 'usuario_rol', r.nombre,
             'motivo', h.motivo, 'datos', h.datos, 'created_at', h.created_at
           ) order by h.created_at, h.id)
      from public.historial_eventos h
      left join public.perfiles pf on pf.id = h.usuario_id
      left join public.roles r on r.id = pf.rol_id
     where h.entidad_tipo = p_tipo and h.entidad_id = p_id
  ), '[]'::jsonb);
end;
$function$;
