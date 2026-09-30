-- ENTRADAS de almacén: recepción de material contra órdenes de compra.
--
-- ordenes_compra.estado NO se toca (sigue pendiente_aprobacion|aprobada|
-- rechazada): PDF, detalle, visualización y resumen_ejecucion_proyecto
-- dependen de 'aprobada'. El avance de recepción vive en estado_entrega.

alter table public.ordenes_compra
  add column if not exists estado_entrega text not null default 'sin_entregar';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ordenes_compra_estado_entrega_check'
  ) then
    alter table public.ordenes_compra
      add constraint ordenes_compra_estado_entrega_check
      check (estado_entrega in ('sin_entregar', 'entrega_parcial', 'entregada'));
  end if;
end $$;

create table if not exists public.entradas_almacen (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  orden_compra_id uuid not null references public.ordenes_compra(id),
  remision text,
  observaciones text,
  recibido_por uuid references public.perfiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.entradas_almacen_items (
  id uuid primary key default gen_random_uuid(),
  entrada_id uuid not null references public.entradas_almacen(id) on delete cascade,
  orden_compra_item_id uuid not null references public.ordenes_compra_items(id),
  cantidad numeric not null check (cantidad > 0)
);

create index if not exists entradas_almacen_orden_idx
  on public.entradas_almacen (orden_compra_id);
create index if not exists entradas_almacen_items_entrada_idx
  on public.entradas_almacen_items (entrada_id);
create index if not exists entradas_almacen_items_oc_item_idx
  on public.entradas_almacen_items (orden_compra_item_id);

-- Sin policies: nadie accede directo, solo vía las funciones security
-- definer de abajo (que validan es_admin / admin_insumos).
alter table public.entradas_almacen enable row level security;
alter table public.entradas_almacen_items enable row level security;

create or replace function public._puede_gestionar_entradas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.es_admin or p.admin_insumos from public.perfiles p where p.id = auth.uid()),
    false
  );
$$;

-- OC aprobadas que aún aceptan entradas (sin_entregar / entrega_parcial).
create or replace function public.listar_ordenes_para_entrada()
returns table (
  id uuid,
  numero integer,
  estado_entrega text,
  proyecto_codigo text,
  proyecto_nombre text,
  proveedor_nombre text,
  fecha_entrega date,
  total_lineas bigint,
  cantidad_ordenada numeric,
  cantidad_recibida numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
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
    coalesce(sum(r.recibida), 0)
  from ordenes_compra o
  join proyectos pr on pr.id = o.proyecto_id
  left join proveedores pv on pv.id = o.proveedor_id
  left join ordenes_compra_items i on i.orden_compra_id = o.id
  left join lateral (
    select sum(ei.cantidad) as recibida
    from entradas_almacen_items ei
    where ei.orden_compra_item_id = i.id
  ) r on true
  where o.estado = 'aprobada'
    and o.estado_entrega in ('sin_entregar', 'entrega_parcial')
  group by o.id, pr.codigo, pr.nombre, pv.nombre
  order by o.numero desc;
end;
$$;

-- Detalle de una OC: líneas con ordenado / recibido / pendiente + historial.
create or replace function public.detalle_orden_para_entrada(p_orden_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
    left join proveedores pv on pv.id = o.proveedor_id
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
           'cantidad_recibida', coalesce(r.recibida, 0),
           'cantidad_pendiente', greatest(i.cantidad - coalesce(r.recibida, 0), 0)
         ) order by mi.codigo), '[]'::jsonb)
    into v_lineas
    from ordenes_compra_items i
    join pedidos_insumos pi on pi.id = i.pedido_insumo_id
    join maestro_insumos mi on mi.id = pi.insumo_id
    left join lateral (
      select sum(ei.cantidad) as recibida
      from entradas_almacen_items ei
      where ei.orden_compra_item_id = i.id
    ) r on true
   where i.orden_compra_id = p_orden_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'numero', e.numero,
           'remision', e.remision,
           'observaciones', e.observaciones,
           'recibido_por', pf.nombre,
           'created_at', e.created_at,
           'lineas', (
             select jsonb_agg(jsonb_build_object(
                      'insumo_descripcion', mi.descripcion,
                      'um', mi.u_m,
                      'cantidad', ei.cantidad))
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
$$;

-- p_lineas: [{ "orden_compra_item_id": uuid, "cantidad": number }, ...]
-- Líneas con cantidad 0 se ignoran. Recibir más de lo pendiente falla.
-- Si tras la entrada todas las líneas están completas -> 'entregada';
-- si no -> 'entrega_parcial'.
create or replace function public.registrar_entrada_almacen(
  p_orden_id uuid,
  p_remision text,
  p_observaciones text,
  p_lineas jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden record;
  v_entrada_id uuid;
  v_linea jsonb;
  v_item record;
  v_cantidad numeric;
  v_recibida numeric;
  v_insertadas int := 0;
  v_incompletas int;
begin
  if not public._puede_gestionar_entradas() then
    raise exception 'No tienes permiso para gestionar entradas de almacén.';
  end if;

  -- Bloquea la orden: dos almacenistas no pueden pasarse del pedido a la vez.
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

    select coalesce(sum(cantidad), 0) into v_recibida
      from entradas_almacen_items where orden_compra_item_id = v_item.id;

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

  select count(*) into v_incompletas
    from ordenes_compra_items i
   where i.orden_compra_id = p_orden_id
     and i.cantidad > coalesce(
       (select sum(ei.cantidad) from entradas_almacen_items ei
         where ei.orden_compra_item_id = i.id), 0);

  update ordenes_compra
     set estado_entrega = case when v_incompletas = 0 then 'entregada' else 'entrega_parcial' end
   where id = p_orden_id;

  return v_entrada_id;
end;
$$;

revoke all on function public.listar_ordenes_para_entrada() from public;
revoke all on function public.detalle_orden_para_entrada(uuid) from public;
revoke all on function public.registrar_entrada_almacen(uuid, text, text, jsonb) from public;
grant execute on function public.listar_ordenes_para_entrada() to authenticated;
grant execute on function public.detalle_orden_para_entrada(uuid) to authenticated;
grant execute on function public.registrar_entrada_almacen(uuid, text, text, jsonb) to authenticated;
