-- Revisión del flujo de requisiciones/compras/almacén (2026-10-02).
--
-- 1. Escritura directa en pedidos_insumos y ordenes_compra.
--    authenticated tenía INSERT/UPDATE en pedidos_insumos y la política de
--    INSERT no limitaba estado ni cantidad: por la API se podía meter una
--    línea ya 'aprobado' en una requisición existente, saltándose la
--    aprobación y el tope del presupuesto. La política de UPDATE de
--    aprobar_pedidos dejaba cambiar cualquier columna de cualquier proyecto, y
--    la de compras no tenía WITH CHECK. La app ya escribe todo por funciones
--    SECURITY DEFINER (crear_requisicion, resolver_requisicion,
--    crear_orden_compra, ...); lo único directo era el rechazo de Compras, que
--    pasa a rechazar_pedido_compras(). Se quitan los permisos de escritura y
--    las políticas que ya no sirven.
--
-- 2. Almacén solo en los proyectos del usuario.
--    Las funciones de entradas/salidas/inventario solo pedían la acción
--    gestionar_almacen: un almacenista podía ver y mover el almacén de
--    cualquier proyecto. Ahora además tiene que poder ver el proyecto
--    (usuario_puede_ver_proyecto: admin, "todos los proyectos", asignación
--    directa o grupo). Quien tiene "todos los proyectos" sigue viéndolos todos.
--    Mismo patrón que 20261017000000: la original se renombra con "_" (sin
--    permiso para usuarios) y una envoltura con el nombre de siempre revisa
--    el proyecto. Los listados (sin proyecto = "todos") se reescriben para
--    filtrar por proyectos_visibles. Se borra el listar_ordenes_entradas
--    viejo sin p_proyecto_id.
--
-- Se puede correr dos veces. Va junto con el cambio de la app que usa
-- rechazar_pedido_compras(): aplicar al desplegar ese cambio.

-- ===========================================================================
-- 1. Requisiciones y órdenes de compra: solo por funciones
-- ===========================================================================

create or replace function public.rechazar_pedido_compras(p_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.rol_compras(auth.uid()) then
    raise exception 'No tienes permiso para rechazar requisiciones en Compras.';
  end if;
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo del rechazo es obligatorio.';
  end if;

  -- Solo una vez y solo sobre requisiciones aprobadas.
  update pedidos_insumos
     set rechazado_compras_at = now(),
         rechazado_compras_por = auth.uid(),
         observaciones_compras = trim(p_motivo)
   where id = p_pedido_id
     and estado = 'aprobado'
     and rechazado_compras_at is null;

  if not found then
    raise exception 'Esta requisición ya no está disponible para Compras (ya fue rechazada o cambió de estado). Actualiza la página.';
  end if;
end;
$$;

revoke all on function public.rechazar_pedido_compras(uuid, text) from public, anon;
grant execute on function public.rechazar_pedido_compras(uuid, text) to authenticated;

revoke insert, update, delete, truncate on public.pedidos_insumos from anon, authenticated;
revoke insert, update, delete, truncate on public.ordenes_compra from anon, authenticated;
revoke insert, update, delete, truncate on public.ordenes_compra_items from anon, authenticated;

drop policy if exists pedidos_insumos_insert on public.pedidos_insumos;
drop policy if exists pedidos_insumos_update on public.pedidos_insumos;
drop policy if exists pedidos_insumos_update_compras on public.pedidos_insumos;
drop policy if exists ordenes_compra_insert on public.ordenes_compra;

-- ===========================================================================
-- 2. Almacén por proyecto
-- ===========================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'registrar_entrada_almacen(uuid, text, text, jsonb)',
    'detalle_orden_para_entrada(uuid)',
    'editar_entrada_almacen(uuid, text, text, jsonb)',
    'anular_entrada_almacen(uuid, text)',
    'editar_salida_almacen(uuid, numeric, text, text)',
    'anular_salida_almacen(uuid, text)',
    'entradas_por_orden(uuid[])',
    'inventario_proyecto(uuid)',
    'listar_salidas_proyecto(uuid)'
  ] loop
    if to_regprocedure('public._' || f) is null then
      execute format('alter function public.%s rename to %I', f, '_' || split_part(f, '(', 1));
    end if;
    execute format('revoke all on function public.%s from public, anon, authenticated', '_' || f);
  end loop;
end;
$$;

-- Proyecto de una orden de compra / entrada / salida. Si no existe devuelve
-- null y la función original da su propio error.
create or replace function public._proyecto_de_orden(p_orden_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select proyecto_id from ordenes_compra where id = p_orden_id
$$;

create or replace function public._proyecto_de_entrada(p_entrada_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select o.proyecto_id from entradas_almacen e join ordenes_compra o on o.id = e.orden_compra_id
   where e.id = p_entrada_id
$$;

create or replace function public._proyecto_de_salida(p_salida_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select proyecto_id from salidas_insumos where id = p_salida_id
$$;

-- Falla si el usuario no ve el proyecto. Con proyecto null no hace nada.
create or replace function public._exigir_proyecto_almacen(p_proyecto_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_proyecto_id is not null and not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso al almacén de este proyecto.';
  end if;
end;
$$;

revoke all on function public._proyecto_de_orden(uuid) from public, anon, authenticated;
revoke all on function public._proyecto_de_entrada(uuid) from public, anon, authenticated;
revoke all on function public._proyecto_de_salida(uuid) from public, anon, authenticated;
revoke all on function public._exigir_proyecto_almacen(uuid) from public, anon, authenticated;

create or replace function public.registrar_entrada_almacen(p_orden_id uuid, p_remision text, p_observaciones text, p_lineas jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_proyecto_almacen(public._proyecto_de_orden(p_orden_id));
  return public._registrar_entrada_almacen(p_orden_id, p_remision, p_observaciones, p_lineas);
end;
$$;

create or replace function public.detalle_orden_para_entrada(p_orden_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._exigir_proyecto_almacen(public._proyecto_de_orden(p_orden_id));
  return public._detalle_orden_para_entrada(p_orden_id);
end;
$$;

create or replace function public.editar_entrada_almacen(p_entrada_id uuid, p_remision text, p_observaciones text, p_lineas jsonb)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_proyecto_almacen(public._proyecto_de_entrada(p_entrada_id));
  return public._editar_entrada_almacen(p_entrada_id, p_remision, p_observaciones, p_lineas);
end;
$$;

create or replace function public.anular_entrada_almacen(p_entrada_id uuid, p_motivo text)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_proyecto_almacen(public._proyecto_de_entrada(p_entrada_id));
  return public._anular_entrada_almacen(p_entrada_id, p_motivo);
end;
$$;

create or replace function public.editar_salida_almacen(p_salida_id uuid, p_cantidad numeric, p_retira text, p_observaciones text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_proyecto_almacen(public._proyecto_de_salida(p_salida_id));
  perform public._editar_salida_almacen(p_salida_id, p_cantidad, p_retira, p_observaciones);
end;
$$;

create or replace function public.anular_salida_almacen(p_salida_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_proyecto_almacen(public._proyecto_de_salida(p_salida_id));
  perform public._anular_salida_almacen(p_salida_id, p_motivo);
end;
$$;

-- Solo las órdenes de proyectos que el usuario ve; las demás se ignoran.
create or replace function public.entradas_por_orden(p_orden_ids uuid[])
returns table(orden_id uuid, entrada_id uuid, numero bigint, created_at timestamp with time zone, recibido_por uuid, recibido_por_nombre text)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select * from public._entradas_por_orden(array(
    select o.id from ordenes_compra o
     where o.id = any(p_orden_ids)
       and o.proyecto_id in (select public.proyectos_visibles(auth.uid()))
  ));
end;
$$;

-- Antes bastaba gestionar_almacen para ver cualquier proyecto; ahora hay que
-- ver el proyecto (quien lo ve ya podía consultarlo).
create or replace function public.inventario_proyecto(p_proyecto_id uuid)
returns table(insumo_id uuid, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad_entrada numeric, cantidad_salida numeric, cantidad_disponible numeric, costo_promedio numeric, valor_inventario numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes permiso para ver el inventario de este proyecto.';
  end if;
  return query select * from public._inventario_proyecto(p_proyecto_id);
end;
$$;

create or replace function public.listar_salidas_proyecto(p_proyecto_id uuid)
returns table(id uuid, fecha date, created_at timestamp with time zone, insumo_codigo integer, insumo_descripcion text, insumo_um text, cantidad numeric, cantidad_original numeric, retira text, observaciones text, registrado_por_nombre text, editada_at timestamp with time zone, anulada_at timestamp with time zone, motivo_anulacion text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes permiso para ver las salidas de este proyecto.';
  end if;
  return query select * from public._listar_salidas_proyecto(p_proyecto_id);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'registrar_entrada_almacen(uuid, text, text, jsonb)',
    'detalle_orden_para_entrada(uuid)',
    'editar_entrada_almacen(uuid, text, text, jsonb)',
    'anular_entrada_almacen(uuid, text)',
    'editar_salida_almacen(uuid, numeric, text, text)',
    'anular_salida_almacen(uuid, text)',
    'entradas_por_orden(uuid[])',
    'inventario_proyecto(uuid)',
    'listar_salidas_proyecto(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- Listados: sin proyecto ya no son "todos", sino los que el usuario ve.
-- Mismo cuerpo que en producción + el filtro de proyectos_visibles.

create or replace function public.listar_ordenes_para_entrada(p_incluir_entregadas boolean default false, p_proyecto_id uuid default null::uuid)
returns table(id uuid, numero integer, estado_entrega text, proyecto_codigo text, proyecto_nombre text, proveedor_nombre text, fecha_entrega date, total_lineas bigint, cantidad_ordenada numeric, cantidad_recibida numeric)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
    and o.proyecto_id in (select public.proyectos_visibles(auth.uid()))
  group by o.id, pr.codigo, pr.nombre, pv.nombre
  order by o.numero desc;
end;
$function$;

create or replace function public.listar_ordenes_entradas(p_proyecto_id uuid default null::uuid, p_numero integer default null::integer, p_proveedor text default null::text, p_usuario uuid default null::uuid, p_estado text default null::text, p_desde timestamp with time zone default null::timestamp with time zone, p_hasta timestamp with time zone default null::timestamp with time zone, p_limite integer default 51, p_offset integer default 0)
returns table(id uuid, numero integer, estado_entrega text, proyecto_codigo text, proyecto_nombre text, proveedor_nombre text, entrada_at timestamp with time zone, entrada_por text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
    and o.proyecto_id in (select public.proyectos_visibles(auth.uid()))
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
$function$;

-- Versión vieja sin p_proyecto_id: listaba todos los proyectos. La app usa la de arriba.
drop function if exists public.listar_ordenes_entradas(integer, text, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer);
