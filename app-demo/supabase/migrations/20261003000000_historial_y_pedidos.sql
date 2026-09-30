-- HISTORIAL de órdenes de compra y pedidos + desaprobar / cancelar / modificar PEDIDOS.
--
-- 1) historial_eventos: registro inmutable de quién hizo qué y cuándo. Lo
--    escriben DISPARADORES sobre ordenes_compra y pedidos_insumos, así que
--    cubre cualquier camino (pantallas, funciones SQL, cambios directos) y no
--    depende de que cada pantalla se acuerde de registrarlo. Sin policies:
--    nadie lo edita ni lo borra; solo se lee con historial_entidad().
-- 2) Pedidos: estado 'cancelado' + desaprobar / cancelar / modificar, con las
--    mismas reglas que las órdenes de compra.

-- ------------------------------------------------------------------ historial
create table if not exists public.historial_eventos (
  id uuid primary key default gen_random_uuid(),
  entidad_tipo text not null check (entidad_tipo in ('orden_compra', 'pedido')),
  entidad_id uuid not null,
  evento text not null,
  usuario_id uuid references public.perfiles(id) on delete set null,
  motivo text,
  datos jsonb,
  created_at timestamptz not null default now()
);

create index if not exists historial_eventos_entidad_idx
  on public.historial_eventos (entidad_tipo, entidad_id, created_at);

alter table public.historial_eventos enable row level security;

-- ------------------------------------------------------------ columnas pedidos
alter table public.pedidos_insumos
  add column if not exists desaprobado_at timestamptz,
  add column if not exists desaprobado_por uuid references public.perfiles(id),
  add column if not exists motivo_desaprobacion text,
  add column if not exists cancelado_at timestamptz,
  add column if not exists cancelado_por uuid references public.perfiles(id),
  add column if not exists motivo_cancelacion text;

alter table public.pedidos_insumos drop constraint if exists pedidos_insumos_estado_check;
alter table public.pedidos_insumos
  add constraint pedidos_insumos_estado_check
  check (estado in ('pendiente', 'aprobado', 'rechazado', 'cancelado'));

-- Cancelar ya no BORRA el pedido (se perdía el rastro): ahora cambia a
-- 'cancelado' con motivo, vía cancelar_pedido(). Se quita el borrado directo.
drop policy if exists pedidos_insumos_delete_propio_pendiente on public.pedidos_insumos;

-- ------------------------------------------------- disparador: órdenes de compra
create or replace function public.trg_historial_orden_compra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  if new.enviada and not old.enviada then
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id)
    values ('orden_compra', new.id, 'marcada_enviada', auth.uid());
  end if;

  if new.estado_entrega is distinct from old.estado_entrega then
    insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
    values ('orden_compra', new.id, 'entrega_actualizada', auth.uid(),
            jsonb_build_object('de', old.estado_entrega, 'a', new.estado_entrega));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_historial_orden_compra on public.ordenes_compra;
create trigger trg_historial_orden_compra
  after insert or update on public.ordenes_compra
  for each row execute function public.trg_historial_orden_compra();

-- ------------------------------------------------------- disparador: pedidos
create or replace function public.trg_historial_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

drop trigger if exists trg_historial_pedido on public.pedidos_insumos;
create trigger trg_historial_pedido
  after insert or update on public.pedidos_insumos
  for each row execute function public.trg_historial_pedido();

-- ------------------------------------------------ historia que ya existía
-- Se reconstruye lo que las tablas ya sabían (creación y aprobación/rechazo);
-- queda marcado como 'reconstruido' porque no es un registro en vivo. Lo que
-- no se guardaba (p. ej. quién marcó una orden como enviada) no se puede
-- reconstruir.
insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, created_at, datos)
select 'orden_compra', o.id, 'creada', o.created_by, o.created_at,
       jsonb_build_object('numero', o.numero, 'reconstruido', true)
  from public.ordenes_compra o
 where not exists (
   select 1 from public.historial_eventos h
   where h.entidad_tipo = 'orden_compra' and h.entidad_id = o.id and h.evento = 'creada');

insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, created_at, datos)
select 'orden_compra', o.id,
       case o.estado when 'aprobada' then 'aprobada' else 'rechazada' end,
       o.aprobada_por, o.motivo_rechazo, coalesce(o.aprobada_at, o.created_at),
       jsonb_build_object('reconstruido', true)
  from public.ordenes_compra o
 where o.estado in ('aprobada', 'rechazada') and o.aprobada_por is not null
   and not exists (
     select 1 from public.historial_eventos h
     where h.entidad_tipo = 'orden_compra' and h.entidad_id = o.id
       and h.evento in ('aprobada', 'rechazada'));

insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, created_at, datos)
select 'pedido', p.id, 'creado', p.solicitado_por, p.created_at,
       jsonb_build_object('cantidad', p.cantidad, 'reconstruido', true)
  from public.pedidos_insumos p
 where not exists (
   select 1 from public.historial_eventos h
   where h.entidad_tipo = 'pedido' and h.entidad_id = p.id and h.evento = 'creado');

insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, created_at, datos)
select 'pedido', p.id,
       case p.estado when 'aprobado' then 'aprobado' else 'rechazado' end,
       p.resuelto_por, p.comentario_resolucion, coalesce(p.resuelto_at, p.created_at),
       jsonb_build_object('reconstruido', true)
  from public.pedidos_insumos p
 where p.estado in ('aprobado', 'rechazado') and p.resuelto_por is not null
   and not exists (
     select 1 from public.historial_eventos h
     where h.entidad_tipo = 'pedido' and h.entidad_id = p.id
       and h.evento in ('aprobado', 'rechazado'));

-- ------------------------------------------------------- leer el historial
-- Lo ve quien puede ver la orden / el pedido (mismas reglas que sus policies).
create or replace function public.historial_entidad(p_tipo text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  if p_tipo = 'orden_compra' then
    select (public.rol_compras(auth.uid()) or public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
      into v_ok from public.ordenes_compra o where o.id = p_id;
  elsif p_tipo = 'pedido' then
    select (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id) or public.rol_compras(auth.uid()))
      into v_ok from public.pedidos_insumos p where p.id = p_id;
  else
    raise exception 'Tipo de historial desconocido.';
  end if;

  if not coalesce(v_ok, false) then
    raise exception 'No tienes permiso para ver este historial.';
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
$$;

-- ------------------------------------------------------------ permisos nuevos
-- Acciones desaprobar_pedidos y cancelar_pedidos (mismo criterio que aprobar
-- pedidos cuando un usuario aún no tiene rol).
create or replace function public.tiene_accion(p_usuario_id uuid, p_accion text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
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
$$;

create or replace function public.permisos_rol_usuario(p_usuario_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
$$;

-- El Líder Técnico (que ya aprueba pedidos) también puede desaprobarlos y
-- cancelarlos; se cambia desde Roles y permisos.
insert into public.rol_permisos (rol_id, permiso)
select r.id, x.permiso
  from public.roles r
  cross join (values ('accion.desaprobar_pedidos'), ('accion.cancelar_pedidos')) as x(permiso)
 where r.clave = 'lider_tecnico'
on conflict do nothing;

-- ---------------------------------------------------- modificar un pedido
-- Solo quien lo hizo, y solo mientras está pendiente de aprobación. No se
-- cambia el insumo ni el ítem: para eso se cancela y se crea otro.
create or replace function public.modificar_pedido(
  p_pedido_id uuid,
  p_cantidad numeric,
  p_fecha_requerida date,
  p_urgente boolean,
  p_observaciones text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  if p_fecha_requerida <> v.fecha_requerida and p_fecha_requerida < current_date then
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
$$;

-- ------------------------------------------------------ cancelar un pedido
-- Pendiente: lo cancela quien lo hizo, o quien tenga la acción cancelar_pedidos.
-- Aprobado : solo quien tenga cancelar_pedidos, y solo si ninguna orden de
--            compra activa lo usa (primero se cancela la orden).
create or replace function public.cancelar_pedido(p_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_puede boolean := public.tiene_accion(auth.uid(), 'cancelar_pedidos');
begin
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;

  select id, estado, solicitado_por into v from pedidos_insumos where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido no existe.';
  end if;

  if v.estado = 'pendiente' then
    if not (v.solicitado_por = auth.uid() or v_puede) then
      raise exception 'Solo quien hizo el pedido, o quien tenga permiso de cancelar pedidos, puede cancelarlo.';
    end if;
  elsif v.estado = 'aprobado' then
    if not v_puede then
      raise exception 'No tienes permiso para cancelar un pedido ya aprobado.';
    end if;
    if exists (
      select 1
      from ordenes_compra_items oci
      join ordenes_compra oc on oc.id = oci.orden_compra_id
      where oci.pedido_insumo_id = p_pedido_id and oc.estado <> 'cancelada'
    ) then
      raise exception 'El pedido ya está en una orden de compra. Cancela primero la orden.';
    end if;
  else
    raise exception 'Solo se puede cancelar un pedido pendiente o aprobado.';
  end if;

  update pedidos_insumos
     set estado = 'cancelado', cancelado_por = auth.uid(), cancelado_at = now(),
         motivo_cancelacion = trim(p_motivo)
   where id = p_pedido_id;
end;
$$;

-- ---------------------------------------------------- desaprobar un pedido
create or replace function public.desaprobar_pedido(p_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
    where oci.pedido_insumo_id = p_pedido_id and oc.estado <> 'cancelada'
  ) then
    raise exception 'El pedido ya está en una orden de compra: no se puede desaprobar. Cancela primero la orden.';
  end if;

  update pedidos_insumos
     set estado = 'pendiente',
         resuelto_por = null, resuelto_at = null, comentario_resolucion = null,
         desaprobado_por = auth.uid(), desaprobado_at = now(), motivo_desaprobacion = trim(p_motivo)
   where id = p_pedido_id;
end;
$$;

-- -------------------------------------------------------------------- permisos
revoke all on function public.historial_entidad(text, uuid) from public;
revoke all on function public.modificar_pedido(uuid, numeric, date, boolean, text) from public;
revoke all on function public.cancelar_pedido(uuid, text) from public;
revoke all on function public.desaprobar_pedido(uuid, text) from public;
grant execute on function public.historial_entidad(text, uuid) to authenticated;
grant execute on function public.modificar_pedido(uuid, numeric, date, boolean, text) to authenticated;
grant execute on function public.cancelar_pedido(uuid, text) to authenticated;
grant execute on function public.desaprobar_pedido(uuid, text) to authenticated;
