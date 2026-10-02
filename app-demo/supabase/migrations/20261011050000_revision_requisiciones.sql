-- Revisión de seguridad y rendimiento de las requisiciones agrupadas.
--
--  1. CANDADO por proyecto al crear / modificar una requisición. Antes dos
--     requisiciones simultáneas del mismo insumo podían pasar las dos la
--     validación del cupo y excederlo (el cupo se lee antes de insertar). Es el
--     único cambio de las funciones: se agrega la línea pg_advisory_xact_lock.
--  2. comprado_pedidos pasa a SECURITY INVOKER (respeta RLS) y la línea de
--     requisición se valida contra el APU de su ítem.
--  3. Índices para los joins del estado de compra y los listados de órdenes.
--     Cada uno se crea SOLO si la tabla no tiene ya un índice que empiece por esa
--     columna (en la base pueden existir índices creados a mano con otro nombre).
--
-- Corre DESPUÉS de 20261010100000.

-- ---------------------------------------------------------------- 1. candados
create or replace function public.crear_requisicion(
  p_lineas jsonb,
  p_fecha_requerida date,
  p_urgente boolean,
  p_observaciones text,
  p_soporte_url text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- Un solo "creando o editando" a la vez por proyecto: sin esto, dos
  -- requisiciones simultáneas pasan las dos el tope de cupo y lo exceden (el
  -- cupo se lee antes de insertar).
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
    -- item_apu_id lo manda el cliente: debe ser la línea de APU de ESE insumo en
    -- el APU de ESE ítem (si no, se podría referenciar un APU ajeno).
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
$$;

create or replace function public.modificar_requisicion(
  p_id uuid,
  p_lineas jsonb,
  p_fecha_requerida date,
  p_urgente boolean,
  p_observaciones text
) returns void
language plpgsql
security definer
set search_path = public
as $$
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

  -- Mismo candado por proyecto que crear_requisicion (ver allá).
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
    -- item_apu_id lo manda el cliente: debe ser la línea de APU de ESE insumo en
    -- el APU de ESE ítem (si no, se podría referenciar un APU ajeno).
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

  -- Qué cambia (para el historial).
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

  -- Aplicar.
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
$$;

revoke all on function public.crear_requisicion(jsonb, date, boolean, text, text) from public, anon;
revoke all on function public.modificar_requisicion(uuid, jsonb, date, boolean, text) from public, anon;
grant execute on function public.crear_requisicion(jsonb, date, boolean, text, text) to authenticated;
grant execute on function public.modificar_requisicion(uuid, jsonb, date, boolean, text) to authenticated;

-- ----------------------------------------------------- comprado_pedidos (RLS)
-- Era SECURITY DEFINER: devolvía lo comprado de CUALQUIER id de línea que se le
-- pasara. Ahora es SECURITY INVOKER: la selección de pedidos_insumos respeta RLS
-- (solo las líneas que el usuario ya puede ver); el cálculo de lo comprado sigue
-- yendo por _comprado_pedido (definer), porque las órdenes de compra de esas
-- líneas pueden no ser visibles para quien pregunta.
create or replace function public.comprado_pedidos(p_ids uuid[])
returns table(pedido_id uuid, comprado numeric)
language sql
stable
as $$
  select p.id, public._comprado_pedido(p.id)
  from pedidos_insumos p
  where p.id = any(p_ids)
$$;

revoke all on function public.comprado_pedidos(uuid[]) from public, anon;
grant execute on function public.comprado_pedidos(uuid[]) to authenticated;

-- ----------------------------------------------------------------- 2. índices
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'ordenes_compra_items'
      and indexdef ~ '\(pedido_insumo_id[,)\s]'
  ) then
    create index ordenes_compra_items_pedido_idx on public.ordenes_compra_items (pedido_insumo_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'ordenes_compra_items'
      and indexdef ~ '\(orden_compra_id[,)\s]'
  ) then
    create index ordenes_compra_items_orden_idx on public.ordenes_compra_items (orden_compra_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'pedidos_insumos'
      and indexdef ~ '\(insumo_id[,)\s]'
  ) then
    create index pedidos_insumos_insumo_idx on public.pedidos_insumos (insumo_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'ordenes_compra'
      and indexdef ~ '\(estado[,)\s]'
  ) then
    create index ordenes_compra_estado_idx on public.ordenes_compra (estado, created_at desc);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'ordenes_compra'
      and indexdef ~ '\(proyecto_id[,)\s]'
  ) then
    create index ordenes_compra_proyecto_idx on public.ordenes_compra (proyecto_id, created_at desc);
  end if;
end $$;

