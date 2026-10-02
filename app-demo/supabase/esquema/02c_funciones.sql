-- Funciones de public (3/4): items_presupuesto_para_contrato .. reenviar_solicitud_contrato.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.items_presupuesto_para_contrato(p_proyecto_id uuid)
 RETURNS TABLE(presupuesto_item_id uuid, codigo text, descripcion text, unidad text, cantidad numeric, valor_unitario numeric, contratado numeric, disponible numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_presupuesto uuid;
  v_version uuid;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  select p.id, p.version_actual_id into v_presupuesto, v_version
  from presupuestos p where p.proyecto_id = p_proyecto_id;
  if v_version is null then
    return;
  end if;

  return query
  with contratado as (
    select p2.codigo, sum(ai.cantidad) as total
    from contrato_anexo_items ai
    join contratos c on c.id = ai.contrato_id
    join presupuesto_items p2 on p2.id = ai.presupuesto_item_id
    where p2.presupuesto_id = v_presupuesto and c.estado <> 'rechazada'
    group by p2.codigo
  )
  select pi.id, pi.codigo, pi.descripcion, pi.unidad, pi.cantidad, pi.valor_unitario,
         coalesce(c.total, 0),
         greatest(pi.cantidad - coalesce(c.total, 0), 0)
  from presupuesto_items pi
  left join contratado c on c.codigo = pi.codigo
  where pi.version_id = v_version
    and pi.cantidad > 0
    and pi.valor_unitario > 0
  order by pi.codigo, pi.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.listar_ordenes_entradas(p_proyecto_id uuid DEFAULT NULL::uuid, p_numero integer DEFAULT NULL::integer, p_proveedor text DEFAULT NULL::text, p_usuario uuid DEFAULT NULL::uuid, p_estado text DEFAULT NULL::text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limite integer DEFAULT 51, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, numero integer, estado_entrega text, proyecto_codigo text, proyecto_nombre text, proveedor_nombre text, entrada_at timestamp with time zone, entrada_por text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_filtra_entrada boolean := p_usuario is not null or p_desde is not null or p_hasta is not null;
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;
  if p_proyecto_id is not null and not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  return query
  select
    o.id,
    o.numero::integer,
    o.estado_entrega::text,
    pr.codigo::text,
    pr.nombre::text,
    pv.nombre::text,
    ult.created_at,
    ult.nombre
  from ordenes_compra o
  join proyectos pr on pr.id = o.proyecto_id
  left join proveedores pv on pv.unique_id = o.proveedor_id
  left join lateral (
    select e.created_at, pf.nombre::text as nombre
    from entradas_almacen e
    left join perfiles pf on pf.id = e.recibido_por
    where e.orden_compra_id = o.id
      and e.anulada_at is null
      and (p_usuario is null or e.recibido_por = p_usuario)
      and (p_desde is null or e.created_at >= p_desde)
      and (p_hasta is null or e.created_at <= p_hasta)
    order by e.created_at desc, e.id desc
    limit 1
  ) ult on true
  where o.estado = 'aprobada'
    and (p_proyecto_id is null or o.proyecto_id = p_proyecto_id)
    and (p_numero is null or o.numero = p_numero)
    and (p_proveedor is null or p_proveedor = '' or pv.nombre ilike '%' || p_proveedor || '%')
    and (
      p_estado is null
      or (p_estado = 'por_recibir' and o.estado_entrega in ('sin_entregar', 'entrega_parcial'))
      or (p_estado <> 'por_recibir' and o.estado_entrega = p_estado)
    )
    and (not v_filtra_entrada or ult.created_at is not null)
  order by o.numero desc
  limit greatest(p_limite, 1) offset greatest(p_offset, 0);
end;
$function$
;

-- Versión vieja (sin p_proyecto_id), todavía en la base. La app usa la de arriba.
CREATE OR REPLACE FUNCTION public.listar_ordenes_entradas(p_numero integer DEFAULT NULL::integer, p_proveedor text DEFAULT NULL::text, p_usuario uuid DEFAULT NULL::uuid, p_estado text DEFAULT NULL::text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limite integer DEFAULT 51, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, numero integer, estado_entrega text, proyecto_codigo text, proyecto_nombre text, proveedor_nombre text, entrada_at timestamp with time zone, entrada_por text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_filtra_entrada boolean := p_usuario is not null or p_desde is not null or p_hasta is not null;
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;

  return query
  select
    o.id,
    o.numero::integer,
    o.estado_entrega::text,
    pr.codigo::text,
    pr.nombre::text,
    pv.nombre::text,
    ult.created_at,
    ult.nombre
  from ordenes_compra o
  join proyectos pr on pr.id = o.proyecto_id
  left join proveedores pv on pv.unique_id = o.proveedor_id
  left join lateral (
    select e.created_at, pf.nombre::text as nombre
    from entradas_almacen e
    left join perfiles pf on pf.id = e.recibido_por
    where e.orden_compra_id = o.id
      and e.anulada_at is null
      and (p_usuario is null or e.recibido_por = p_usuario)
      and (p_desde is null or e.created_at >= p_desde)
      and (p_hasta is null or e.created_at <= p_hasta)
    order by e.created_at desc, e.id desc
    limit 1
  ) ult on true
  where o.estado = 'aprobada'
    and (p_numero is null or o.numero = p_numero)
    and (p_proveedor is null or p_proveedor = '' or pv.nombre ilike '%' || p_proveedor || '%')
    and (
      p_estado is null
      or (p_estado = 'por_recibir' and o.estado_entrega in ('sin_entregar', 'entrega_parcial'))
      or (p_estado <> 'por_recibir' and o.estado_entrega = p_estado)
    )
    -- con filtro de persona/fecha solo cuentan las órdenes con una entrada que lo cumple
    and (not v_filtra_entrada or ult.created_at is not null)
  order by o.numero desc
  limit greatest(p_limite, 1) offset greatest(p_offset, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.listar_ordenes_para_entrada(p_incluir_entregadas boolean DEFAULT false, p_proyecto_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, numero integer, estado_entrega text, proyecto_codigo text, proyecto_nombre text, proveedor_nombre text, fecha_entrega date, total_lineas bigint, cantidad_ordenada numeric, cantidad_recibida numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;
  if p_proyecto_id is not null and not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
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
    and (p_proyecto_id is null or o.proyecto_id = p_proyecto_id)
  group by o.id, pr.codigo, pr.nombre, pv.nombre
  order by o.numero desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.listar_roles_con_permisos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._exigir_administrador();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'clave', r.clave, 'nombre', r.nombre, 'es_sistema', r.es_sistema,
      'permisos', coalesce((select jsonb_agg(rp.permiso order by rp.permiso)
                              from public.rol_permisos rp where rp.rol_id = r.id), '[]'::jsonb),
      'usuarios', (select count(*) from public.perfiles p where p.rol_id = r.id)
    ) order by r.orden, r.nombre)
    from public.roles r
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.listar_salidas_proyecto(p_proyecto_id uuid)
 RETURNS TABLE(id uuid, fecha date, created_at timestamp with time zone, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad numeric, cantidad_original numeric, retira text, observaciones text, registrado_por_nombre text, editada_at timestamp with time zone, anulada_at timestamp with time zone, motivo_anulacion text)
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
$function$
;

CREATE OR REPLACE FUNCTION public.listar_usuarios_accesos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._exigir_administrador();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', p.nombre, 'email', p.email, 'username', p.username,
      'rol_id', p.rol_id, 'todos_los_proyectos', p.todos_los_proyectos,
      'proyecto_ids', coalesce((select jsonb_agg(up.proyecto_id)
                                  from public.usuario_proyectos up where up.usuario_id = p.id), '[]'::jsonb),
      'banderas_anteriores', jsonb_build_object(
        'es_admin', p.es_admin, 'rol_compras', p.rol_compras, 'admin_insumos', p.admin_insumos,
        'admin_proyectos', p.admin_proyectos, 'admin_mano_obra', p.admin_mano_obra,
        'admin_usuarios', p.admin_usuarios)
    ) order by p.nombre)
    from public.perfiles p
  ), '[]'::jsonb);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.modificar_pedido(p_pedido_id uuid, p_cantidad numeric, p_fecha_requerida date, p_urgente boolean, p_observaciones text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v record;
  v_max numeric;
  v_obs text := nullif(trim(p_observaciones), '');
begin
  select id, estado, solicitado_por, cantidad, fecha_requerida, urgente, observaciones,
         presupuesto_item_id, insumo_id
    into v from pedidos_insumos where id = p_pedido_id for update;

  if not found then
    raise exception 'El pedido no existe.';
  end if;
  if v.solicitado_por is distinct from auth.uid() then
    raise exception 'Solo quien hizo el pedido puede modificarlo.';
  end if;
  if v.estado <> 'pendiente' then
    raise exception 'Solo se puede modificar un pedido pendiente de aprobación.';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor que cero.';
  end if;
  if p_fecha_requerida is null then
    raise exception 'La fecha requerida es obligatoria.';
  end if;
  if p_fecha_requerida <> v.fecha_requerida and p_fecha_requerida < (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha requerida no puede ser anterior a hoy.';
  end if;

  -- El disponible ya descuenta este mismo pedido (está pendiente): se le suma.
  v_max := coalesce(public.disponible_insumo_item(v.presupuesto_item_id, v.insumo_id), 0) + v.cantidad;
  if p_cantidad > v_max then
    raise exception 'La cantidad supera lo disponible del presupuesto (máximo %).', v_max;
  end if;

  if p_cantidad = v.cantidad
     and p_fecha_requerida = v.fecha_requerida
     and coalesce(p_urgente, false) = v.urgente
     and v_obs is not distinct from v.observaciones then
    raise exception 'No hay cambios que guardar.';
  end if;

  update pedidos_insumos
     set cantidad = p_cantidad,
         fecha_requerida = p_fecha_requerida,
         urgente = coalesce(p_urgente, false),
         observaciones = v_obs
   where id = p_pedido_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.modificar_requisicion(p_id uuid, p_lineas jsonb, p_fecha_requerida date, p_urgente boolean, p_observaciones text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_h record;
  v_obs text := nullif(trim(p_observaciones), '');
  v_urgente boolean := coalesce(p_urgente, false);
  v_total int;
  v_proyectos int;
  v_proyecto uuid;
  v_previa numeric;
  v_max numeric;
  v_quitados jsonb;
  v_agregados jsonb;
  v_cambios jsonb;
  l record;
begin
  select * into v_h from requisiciones where id = p_id for update;
  if not found then raise exception 'La requisición no existe.'; end if;
  if v_h.solicitado_por is distinct from v_uid then
    raise exception 'Solo quien hizo la requisición puede modificarla.';
  end if;

  perform 1 from pedidos_insumos where grupo_pedido_id = p_id for update;
  if exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado not in ('pendiente', 'cancelado'))
     or not exists (select 1 from pedidos_insumos where grupo_pedido_id = p_id and estado = 'pendiente') then
    raise exception 'Solo se puede modificar una requisición pendiente de aprobación.';
  end if;

  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'La requisición debe tener al menos un insumo.';
  end if;
  if p_fecha_requerida is null then raise exception 'La fecha requerida es obligatoria.'; end if;
  if p_fecha_requerida is distinct from v_h.fecha_requerida
     and p_fecha_requerida < (now() at time zone 'America/Bogota')::date then
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
  if v_proyectos <> 1 or v_proyecto is distinct from v_h.proyecto_id then
    raise exception 'Todos los insumos deben ser del mismo proyecto de la requisición.';
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
    select coalesce(sum(p.cantidad), 0) into v_previa
      from pedidos_insumos p
     where p.grupo_pedido_id = p_id and p.estado = 'pendiente'
       and p.presupuesto_item_id = l.presupuesto_item_id and p.insumo_id = l.insumo_id;
    v_max := coalesce(public.disponible_insumo_item(l.presupuesto_item_id, l.insumo_id), 0) + v_previa;
    if l.cantidad > v_max then
      raise exception 'La cantidad pedida supera lo disponible del presupuesto (máximo %).', v_max;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('insumo', mi.descripcion, 'item', pi.codigo, 'cantidad', p.cantidad)), '[]'::jsonb)
    into v_quitados
    from pedidos_insumos p
    join maestro_insumos mi on mi.id = p.insumo_id
    join presupuesto_items pi on pi.id = p.presupuesto_item_id
   where p.grupo_pedido_id = p_id and p.estado = 'pendiente'
     and not exists (
       select 1 from jsonb_to_recordset(p_lineas)
         as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)
       where x.presupuesto_item_id = p.presupuesto_item_id and x.insumo_id = p.insumo_id);

  select coalesce(jsonb_agg(jsonb_build_object('insumo', mi.descripcion, 'item', pi.codigo, 'cantidad', x.cantidad)), '[]'::jsonb)
    into v_agregados
    from jsonb_to_recordset(p_lineas)
           as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)
    join maestro_insumos mi on mi.id = x.insumo_id
    join presupuesto_items pi on pi.id = x.presupuesto_item_id
   where not exists (
     select 1 from pedidos_insumos p
     where p.grupo_pedido_id = p_id and p.estado = 'pendiente'
       and p.presupuesto_item_id = x.presupuesto_item_id and p.insumo_id = x.insumo_id);

  select coalesce(jsonb_agg(jsonb_build_object('insumo', mi.descripcion, 'item', pi.codigo, 'de', p.cantidad, 'a', x.cantidad)), '[]'::jsonb)
    into v_cambios
    from pedidos_insumos p
    join jsonb_to_recordset(p_lineas)
           as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)
      on x.presupuesto_item_id = p.presupuesto_item_id and x.insumo_id = p.insumo_id
    join maestro_insumos mi on mi.id = p.insumo_id
    join presupuesto_items pi on pi.id = p.presupuesto_item_id
   where p.grupo_pedido_id = p_id and p.estado = 'pendiente' and p.cantidad <> x.cantidad;

  if v_quitados = '[]'::jsonb and v_agregados = '[]'::jsonb and v_cambios = '[]'::jsonb
     and p_fecha_requerida is not distinct from v_h.fecha_requerida
     and v_urgente = v_h.urgente
     and v_obs is not distinct from v_h.observaciones then
    raise exception 'No hay cambios que guardar.';
  end if;

  delete from pedidos_insumos p
   where p.grupo_pedido_id = p_id and p.estado = 'pendiente'
     and not exists (
       select 1 from jsonb_to_recordset(p_lineas)
         as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)
       where x.presupuesto_item_id = p.presupuesto_item_id and x.insumo_id = p.insumo_id);

  update pedidos_insumos p
     set cantidad = x.cantidad,
         fecha_requerida = p_fecha_requerida, urgente = v_urgente, observaciones = v_obs
    from jsonb_to_recordset(p_lineas)
           as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)
   where p.grupo_pedido_id = p_id and p.estado = 'pendiente'
     and x.presupuesto_item_id = p.presupuesto_item_id and x.insumo_id = p.insumo_id;

  insert into pedidos_insumos
    (grupo_pedido_id, presupuesto_item_id, item_apu_id, insumo_id, cantidad,
     fecha_requerida, urgente, observaciones, soporte_url, solicitado_por)
  select p_id, x.presupuesto_item_id, x.item_apu_id, x.insumo_id, x.cantidad,
         p_fecha_requerida, v_urgente, v_obs, v_h.soporte_url, v_h.solicitado_por
    from jsonb_to_recordset(p_lineas)
           as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)
   where not exists (
     select 1 from pedidos_insumos p
     where p.grupo_pedido_id = p_id and p.estado = 'pendiente'
       and p.presupuesto_item_id = x.presupuesto_item_id and p.insumo_id = x.insumo_id);

  update requisiciones
     set fecha_requerida = p_fecha_requerida, urgente = v_urgente, observaciones = v_obs
   where id = p_id;

  perform public._evento_requisicion(p_id, 'modificada', null, jsonb_build_object(
    'agregados', v_agregados, 'quitados', v_quitados, 'cambios', v_cambios,
    'antes', jsonb_build_object('fecha_requerida', v_h.fecha_requerida, 'urgente', v_h.urgente, 'observaciones', v_h.observaciones),
    'despues', jsonb_build_object('fecha_requerida', p_fecha_requerida, 'urgente', v_urgente, 'observaciones', v_obs)));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificar_insumo_sobre_presupuesto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fila record;
  pct_sobre numeric;
  titulo text;
  mensaje text;
begin
  for fila in
    select r.insumo_descripcion, r.valor_presupuestado, r.valor_comprado
    from public._resumen_ejecucion_proyecto_base(new.proyecto_id) r
    where r.insumo_id in (
      select distinct pe.insumo_id
      from ordenes_compra_items oci
      join pedidos_insumos pe on pe.id = oci.pedido_insumo_id
      where oci.orden_compra_id = new.id
    )
    and r.valor_presupuestado > 0
    and r.valor_comprado > r.valor_presupuestado
  loop
    pct_sobre := (fila.valor_comprado / fila.valor_presupuestado - 1) * 100;
    titulo := case when pct_sobre >= 10 then 'Insumo con sobrecosto (+10%)' else 'Insumo sobre presupuesto' end;
    mensaje := fila.insumo_descripcion || ': comprado $' || round(fila.valor_comprado)::text ||
      ' vs. presupuestado $' || round(fila.valor_presupuestado)::text ||
      ' (' || round(pct_sobre, 1) || '% por encima). Orden de compra #' || new.numero || '.';

    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select p.id, 'insumo_sobre_presupuesto', 'orden_compra', new.id, titulo, mensaje
    from perfiles p
    where public.tiene_accion(p.id, 'aprobar_oc');
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificar_precio_sobre_efectivo_oc_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_insumo_id uuid;
  v_insumo_descripcion text;
  v_precio_efectivo numeric;
  v_numero_orden integer;
  v_pct_sobre numeric;
begin
  select mi.id, mi.descripcion
    into v_insumo_id, v_insumo_descripcion
    from pedidos_insumos pi
    join maestro_insumos mi on mi.id = pi.insumo_id
    where pi.id = new.pedido_insumo_id;

  -- Pedido o insumo eliminado/inconsistente: no hay nada que comparar.
  if v_insumo_id is null then
    return new;
  end if;

  select pe.precio_efectivo into v_precio_efectivo
    from precios_efectivos_insumos(array[v_insumo_id]) pe;

  -- Sin precio efectivo (o cero) no hay base real de comparación -- mismo
  -- criterio de guarda que notificar_insumo_sobre_presupuesto usa con
  -- valor_presupuestado > 0.
  if v_precio_efectivo is null or v_precio_efectivo <= 0 then
    return new;
  end if;

  if new.precio_unitario > v_precio_efectivo * 1.10 then
    select numero into v_numero_orden from ordenes_compra where id = new.orden_compra_id;
    v_pct_sobre := (new.precio_unitario / v_precio_efectivo - 1) * 100;

    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    select
      p.id,
      'orden_compra_precio_sobre_efectivo',
      'orden_compra',
      new.orden_compra_id,
      'Precio de OC por encima del valor vigente (+10%)',
      v_insumo_descripcion || ': precio puesto en la OC $' || round(new.precio_unitario)::text ||
        ' vs. precio unitario vigente $' || round(v_precio_efectivo)::text ||
        ' (' || round(v_pct_sobre, 1) || '% por encima). Orden de compra #' || v_numero_orden || '.'
    from perfiles p
    where public.tiene_accion(p.id, 'aprobar_oc');
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificar_resolucion_oc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.estado is distinct from old.estado and new.estado in ('aprobada', 'rechazada') then
    perform public.notificar_una(
      new.created_by,
      case new.estado when 'aprobada' then 'orden_compra_aprobada' else 'orden_compra_rechazada' end,
      'orden_compra', new.id,
      case new.estado when 'aprobada' then 'Orden de compra aprobada' else 'Orden de compra rechazada' end,
      'La orden de compra #' || new.numero || ' fue ' ||
        case new.estado when 'aprobada' then 'aprobada' else 'rechazada' end || '.' ||
        case when new.estado = 'rechazada' and nullif(trim(new.motivo_rechazo), '') is not null
             then ' Motivo: ' || trim(new.motivo_rechazo) else '' end
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificar_resolucion_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_insumo text;
  v_numero bigint;
begin
  if new.rechazado_compras_at is not null and old.rechazado_compras_at is null then
    select descripcion into v_insumo from maestro_insumos where id = new.insumo_id;
    select numero into v_numero from requisiciones where id = new.grupo_pedido_id;
    perform public.notificar_una(
      new.solicitado_por, 'pedido_rechazado', 'requisicion', new.grupo_pedido_id,
      'Insumo rechazado por Compras',
      'Compras rechazó "' || coalesce(v_insumo, 'un insumo') || '" (' || new.cantidad::text ||
        ') de tu requisición #' || coalesce(v_numero::text, '?') || '.' ||
        case when nullif(trim(new.observaciones_compras), '') is not null
             then ' Motivo: ' || trim(new.observaciones_compras) else '' end
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notificar_una(p_usuario uuid, p_tipo text, p_entidad_tipo text, p_entidad_id uuid, p_titulo text, p_mensaje text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_usuario is null then return; end if;
  if exists (
    select 1 from notificaciones
    where usuario_id = p_usuario and tipo = p_tipo and entidad_id = p_entidad_id
      and mensaje = p_mensaje and created_at > now() - interval '1 minute'
  ) then
    return;
  end if;
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  values (p_usuario, p_tipo, p_entidad_tipo, p_entidad_id, p_titulo, p_mensaje);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.obtener_permisos_usuario(p_usuario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_rol uuid;
  v_es_admin boolean;
  v_ve_todos boolean;
  v_edita_todos boolean;
  v_edita boolean;
  v_proyectos jsonb;
begin
  select rol_id into v_rol from public.perfiles where id = p_usuario_id;

  -- Con rol asignado: el rol decide.
  if v_rol is not null then
    v_es_admin := public.es_admin(p_usuario_id);
    v_ve_todos := v_es_admin or public.usuario_ve_todos_proyectos(p_usuario_id);
    v_edita := public.tiene_accion(p_usuario_id, 'editar_presupuestos');

    if v_ve_todos then
      return jsonb_build_object(
        'esAdmin', v_es_admin, 'veTodosProyectos', true,
        'puedeEditarTodos', v_edita, 'proyectos', '{}'::jsonb
      );
    end if;

    select coalesce(jsonb_object_agg(up.proyecto_id, v_edita), '{}'::jsonb)
      into v_proyectos
      from public.usuario_proyectos up
     where up.usuario_id = p_usuario_id;

    return jsonb_build_object(
      'esAdmin', false, 'veTodosProyectos', false,
      'puedeEditarTodos', false, 'proyectos', v_proyectos
    );
  end if;

  -- Sin rol: lógica anterior, sin cambios.
  select es_admin into v_es_admin from public.perfiles where id = p_usuario_id;

  if v_es_admin then
    return jsonb_build_object(
      'esAdmin', true, 'veTodosProyectos', true,
      'puedeEditarTodos', true, 'proyectos', '{}'::jsonb
    );
  end if;

  select bool_or(g.ve_todos_proyectos), bool_or(g.ve_todos_proyectos and g.puede_editar_todos)
    into v_ve_todos, v_edita_todos
    from public.usuario_grupos ug
    join public.grupos g on g.id = ug.grupo_id
   where ug.usuario_id = p_usuario_id;

  if v_ve_todos then
    return jsonb_build_object(
      'esAdmin', false, 'veTodosProyectos', true,
      'puedeEditarTodos', coalesce(v_edita_todos, false), 'proyectos', '{}'::jsonb
    );
  end if;

  select coalesce(jsonb_object_agg(proyecto_id, puede_editar), '{}'::jsonb)
    into v_proyectos
    from (
      select combinado.proyecto_id, bool_or(combinado.puede_editar) as puede_editar
      from (
        select gp.proyecto_id, gp.puede_editar
          from public.grupo_proyectos gp
          join public.usuario_grupos ug on ug.grupo_id = gp.grupo_id
         where ug.usuario_id = p_usuario_id
        union all
        select up.proyecto_id, up.puede_editar
          from public.usuario_proyectos up
         where up.usuario_id = p_usuario_id
      ) as combinado
      group by combinado.proyecto_id
    ) as agregado;

  return jsonb_build_object(
    'esAdmin', false, 'veTodosProyectos', false,
    'puedeEditarTodos', false, 'proyectos', v_proyectos
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ordenes_compra_con_sobrecosto_precio(p_orden_ids uuid[])
 RETURNS TABLE(orden_compra_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with lineas as (
    select oci.orden_compra_id, oci.precio_unitario, pi.insumo_id
    from ordenes_compra_items oci
    join pedidos_insumos pi on pi.id = oci.pedido_insumo_id
    where oci.orden_compra_id = any(p_orden_ids)
  ),
  precios as (
    select insumo_id, precio_efectivo
    from precios_efectivos_insumos((select array_agg(distinct insumo_id) from lineas))
  )
  select distinct l.orden_compra_id
  from lineas l
  join precios p on p.insumo_id = l.insumo_id
  where p.precio_efectivo > 0
    and l.precio_unitario > p.precio_efectivo * 1.10;
$function$
;

CREATE OR REPLACE FUNCTION public.permisos_rol_usuario(p_usuario_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := coalesce(p_usuario_id, auth.uid());
  v_rol_id uuid;
  v_todos boolean;
  v_rol record;
  v_es_admin boolean;
  v_pestanas text[];
  v_acciones text[];
begin
  if v_uid is null then
    raise exception 'No autenticado.';
  end if;
  if v_uid <> coalesce(auth.uid(), v_uid) and not public.es_admin(auth.uid()) then
    raise exception 'No autorizado.';
  end if;

  select rol_id, todos_los_proyectos into v_rol_id, v_todos from public.perfiles where id = v_uid;
  v_es_admin := public.es_admin(v_uid);

  if v_rol_id is null then
    select coalesce(array_agg(a), '{}') into v_acciones
      from unnest(array['editar_presupuestos','aprobar_pedidos','desaprobar_pedidos','cancelar_pedidos',
                        'aprobar_mano_obra','aprobar_insumos','gestionar_almacen','comprar',
                        'aprobar_oc','desaprobar_oc','cancelar_oc']) as a
     where public.tiene_accion(v_uid, a);

    return jsonb_build_object(
      'sinRol', true, 'rolId', null, 'rolClave', null, 'rolNombre', null,
      'esAdministrador', v_es_admin,
      'pestanas', '[]'::jsonb, 'acciones', to_jsonb(v_acciones),
      'todosProyectos', public.usuario_ve_todos_proyectos(v_uid)
    );
  end if;

  select id, clave, nombre into v_rol from public.roles where id = v_rol_id;

  select coalesce(array_agg(substr(rp.permiso, 5)), '{}') into v_pestanas
    from public.rol_permisos rp where rp.rol_id = v_rol_id and rp.permiso like 'tab.%';
  select coalesce(array_agg(substr(rp.permiso, 8)), '{}') into v_acciones
    from public.rol_permisos rp where rp.rol_id = v_rol_id and rp.permiso like 'accion.%';

  return jsonb_build_object(
    'sinRol', false, 'rolId', v_rol.id, 'rolClave', v_rol.clave, 'rolNombre', v_rol.nombre,
    'esAdministrador', v_es_admin,
    'pestanas', to_jsonb(v_pestanas), 'acciones', to_jsonb(v_acciones),
    'todosProyectos', v_es_admin or v_todos
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.precio_promedio_compra_insumo(p_insumo_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with compras as (
    select precio_unitario * (1 - porcentaje_descuento / 100.0) as precio_efectivo,
           fecha_compra as fecha
    from historico_precios_compra
    where insumo_id = p_insumo_id

    union all

    select oci.precio_unitario * (1 - oci.porcentaje_descuento / 100.0) as precio_efectivo,
           oci.created_at::date as fecha
    from ordenes_compra_items oci
    join pedidos_insumos pi on pi.id = oci.pedido_insumo_id
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    where pi.insumo_id = p_insumo_id
      and oc.estado = 'aprobada'
  )
  select coalesce(
    (select avg(precio_efectivo) from compras where fecha >= (now() - interval '6 months')::date),
    (select avg(precio_efectivo) from compras)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.precios_efectivos_insumos(p_insumo_ids uuid[])
 RETURNS TABLE(insumo_id uuid, precio_efectivo numeric, tipo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with compras as (
    select h.insumo_id,
           h.precio_unitario * (1 - h.porcentaje_descuento / 100.0) as precio,
           h.fecha_compra as fecha
    from historico_precios_compra h
    where h.insumo_id = any(p_insumo_ids)
    union all
    select pi.insumo_id,
           oci.precio_unitario * (1 - oci.porcentaje_descuento / 100.0),
           oci.created_at::date
    from ordenes_compra_items oci
    join pedidos_insumos pi on pi.id = oci.pedido_insumo_id
    join ordenes_compra oc on oc.id = oci.orden_compra_id
    where pi.insumo_id = any(p_insumo_ids)
      and oc.estado = 'aprobada'
  ),
  promedios as (
    select c.insumo_id,
           avg(c.precio) filter (where c.fecha >= (now() - interval '6 months')::date) as reciente,
           avg(c.precio) as historico
    from compras c
    group by c.insumo_id
  )
  select mi.id, coalesce(p.reciente, p.historico, mi.vr_unitario), mi.tipo
  from maestro_insumos mi
  left join promedios p on p.insumo_id = mi.id
  where mi.id = any(p_insumo_ids)
$function$
;

CREATE OR REPLACE FUNCTION public.proyectos_editables(p_usuario_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with u as (
    select coalesce((select pf.rol_id is null from public.perfiles pf where pf.id = p_usuario_id), true) as sin_rol
  )
  -- Sin rol (o sin perfil): admin o grupo que ve y edita todo -> todos.
  select p.id from public.proyectos p, u
  where u.sin_rol
    and (
      public.es_admin(p_usuario_id)
      or exists (
        select 1
        from public.usuario_grupos ug
        join public.grupos g on g.id = ug.grupo_id
        where ug.usuario_id = p_usuario_id
          and g.ve_todos_proyectos = true
          and g.puede_editar_todos = true
      )
    )
  union
  select up.proyecto_id from public.usuario_proyectos up, u
  where u.sin_rol and up.usuario_id = p_usuario_id and up.puede_editar = true
  union
  select gp.proyecto_id
  from public.usuario_grupos ug
  join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id, u
  where u.sin_rol and ug.usuario_id = p_usuario_id and gp.puede_editar = true
  union
  -- Con rol: acción editar_presupuestos + ver el proyecto.
  select v.id from public.proyectos_visibles(p_usuario_id) as v(id), u
  where not u.sin_rol and public.tiene_accion(p_usuario_id, 'editar_presupuestos')
$function$
;

CREATE OR REPLACE FUNCTION public.proyectos_visibles(p_usuario_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id from public.proyectos p
  where public.es_admin(p_usuario_id) or public.usuario_ve_todos_proyectos(p_usuario_id)
  union
  select up.proyecto_id from public.usuario_proyectos up where up.usuario_id = p_usuario_id
  union
  select gp.proyecto_id
  from public.perfiles pf
  join public.usuario_grupos ug on ug.usuario_id = pf.id
  join public.grupo_proyectos gp on gp.grupo_id = ug.grupo_id
  where pf.id = p_usuario_id and pf.rol_id is null
$function$
;

CREATE OR REPLACE FUNCTION public.recalcular_valor_apus(p_apu_ids uuid[])
 RETURNS TABLE(apu_id uuid, valor numeric)
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  with apus as (
    select distinct unnest(p_apu_ids) as id
  ),
  totales as (
    select a.id as apu_id,
      coalesce(sum(moc.valor_unitario), 0)
      + coalesce(sum(ia.cantidad * ia.rendimiento * coalesce(ia.precio_unitario_congelado, mi.vr_unitario))
                   filter (where mi.id is not null), 0)
      + coalesce(sum(ia.cantidad * ia.rendimiento * ec.valor_unitario), 0)
      + coalesce(sum(tp.valor_unitario), 0)
      + coalesce(sum(ia.porcentaje_mano_obra / 100.0) * coalesce(sum(moc.valor_unitario), 0), 0)
        as total
    from apus a
    left join public.item_apu ia on ia.apu_id = a.id
    left join public.mano_obra_categorias moc on moc.id = ia.mano_obra_categoria_id
    left join public.maestro_insumos mi on mi.id = ia.insumo_id
    left join public.equipo_categorias ec on ec.id = ia.equipo_categoria_id
    left join public.transporte_precios tp on tp.id = ia.transporte_precio_id
    group by a.id
  ),
  actualizados as (
    update public.presupuesto_items pi
    set valor_unitario = t.total,
        valor_total = case when pi.cantidad is not null then t.total * pi.cantidad else null end
    from totales t
    where pi.apu_id = t.apu_id
    returning pi.id
  )
  select t.apu_id, t.total from totales t
$function$
;

CREATE OR REPLACE FUNCTION public.recalcular_valor_apu(p_apu_id uuid)
 RETURNS numeric
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select valor from public.recalcular_valor_apus(array[p_apu_id])
$function$
;

CREATE OR REPLACE FUNCTION public.rechazar_orden_compra(p_orden_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_oc') then
    raise exception 'No autorizado -- no tienes permiso para rechazar órdenes de compra.';
  end if;

  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de rechazo es obligatorio.';
  end if;

  -- Las líneas en ordenes_compra_items se dejan intactas a propósito (decisión:
  -- revisión manual de Compras, no se liberan los pedidos automáticamente).
  update ordenes_compra
    set estado = 'rechazada', aprobada_por = auth.uid(), aprobada_at = now(), motivo_rechazo = p_motivo
    where id = p_orden_id and estado = 'pendiente_aprobacion';

  if not found then
    raise exception 'La orden no existe o ya no está pendiente de aprobación.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reenviar_solicitud_contrato(p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb)
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public._guardar_solicitud_contrato(p_id, p_datos, p_obligaciones, p_entregables, p_items, p_documentos, true)
$function$
;
