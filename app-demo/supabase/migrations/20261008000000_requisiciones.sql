-- REQUISICIONES AGRUPADAS (como las órdenes de compra).
--
-- Una requisición = una cabecera con NÚMERO (Requisición 1, 2, ...) que agrupa
-- cualquier cantidad de insumos. Las líneas siguen siendo las filas de
-- pedidos_insumos (una por insumo + ítem del presupuesto): de ahí salen el
-- cupo del presupuesto, las órdenes de compra, el inventario y la
-- visualización, así que NADA de eso cambia.
--
--   * La cabecera REUTILIZA grupo_pedido_id como id: las requisiciones que ya
--     existen quedan agrupadas tal como se crearon, sin tocar sus líneas.
--   * El estado de la requisición NO se guarda: se deriva de sus líneas
--     (vista requisiciones_vista), así no puede descuadrarse.
--       estado        pendiente | aprobada | rechazada | cancelada
--       estado_compra (solo aprobadas) completa = todas las líneas ya están en
--                     órdenes de compra; pendiente = falta alguna
--   * El CUPO del presupuesto no cambia: cada línea sigue contando como
--     comprometida mientras esté pendiente o aprobada (_comprometido_insumo_item).
--     Cancelar o rechazar la requisición pasa todas sus líneas a
--     cancelado/rechazado, y el cupo vuelve solo. Editar revalida cada línea
--     contra el cupo (lo disponible + lo que esa misma línea ya tenía).
--   * Aprobar, rechazar, desaprobar, cancelar y modificar actúan sobre la
--     requisición ENTERA (funciones *_requisicion). Compras sigue pudiendo
--     comprar y rechazar por línea.
--
-- Corre DESPUÉS de 20261007100000.

-- ------------------------------------------------------------------ tabla
create sequence if not exists public.requisiciones_numero_seq;

create table if not exists public.requisiciones (
  id uuid primary key,                       -- = pedidos_insumos.grupo_pedido_id
  numero bigint not null unique default nextval('public.requisiciones_numero_seq'),
  proyecto_id uuid references public.proyectos(id),
  solicitado_por uuid references public.perfiles(id),
  fecha_requerida date,
  urgente boolean not null default false,
  observaciones text,
  soporte_url text,
  created_at timestamptz not null default now()
);

alter table public.requisiciones enable row level security;

-- Se ve si se ve alguna de sus líneas (las policies de pedidos_insumos se
-- aplican dentro de la subconsulta). Sin policies de escritura: todo cambio
-- pasa por las funciones *_requisicion.
drop policy if exists requisiciones_select on public.requisiciones;
create policy requisiciones_select on public.requisiciones
  for select to authenticated
  using (exists (select 1 from public.pedidos_insumos p where p.grupo_pedido_id = requisiciones.id));

revoke all on public.requisiciones from anon;
revoke insert, update, delete on public.requisiciones from authenticated;
grant select on public.requisiciones to authenticated;

-- ---------------------------------------------------- datos que ya existían
-- Una línea sin grupo se vuelve su propia requisición.
update public.pedidos_insumos set grupo_pedido_id = id where grupo_pedido_id is null;

with grupos as (
  select
    p.grupo_pedido_id as id,
    min(p.created_at) as creado,
    (array_agg(pr.proyecto_id order by p.created_at, p.id))[1] as proyecto_id,
    (array_agg(p.solicitado_por order by p.created_at, p.id))[1] as solicitado_por,
    (array_agg(p.fecha_requerida order by p.created_at, p.id))[1] as fecha_requerida,
    coalesce(bool_or(p.urgente), false) as urgente,
    (array_agg(p.observaciones order by p.created_at, p.id))[1] as observaciones,
    (array_agg(p.soporte_url order by p.created_at, p.id))[1] as soporte_url
  from public.pedidos_insumos p
  left join public.presupuesto_items pi on pi.id = p.presupuesto_item_id
  left join public.presupuestos pr on pr.id = pi.presupuesto_id
  group by p.grupo_pedido_id
),
base as (select coalesce(max(numero), 0) as maximo from public.requisiciones)
insert into public.requisiciones
  (id, numero, proyecto_id, solicitado_por, fecha_requerida, urgente, observaciones, soporte_url, created_at)
select g.id,
       base.maximo + row_number() over (order by g.creado, g.id),
       g.proyecto_id, g.solicitado_por, g.fecha_requerida, g.urgente, g.observaciones, g.soporte_url, g.creado
from grupos g
cross join base
where not exists (select 1 from public.requisiciones r where r.id = g.id);

select setval('public.requisiciones_numero_seq', greatest((select coalesce(max(numero), 0) from public.requisiciones), 1));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pedidos_insumos'::regclass and conname = 'pedidos_insumos_requisicion_fkey'
  ) then
    alter table public.pedidos_insumos
      add constraint pedidos_insumos_requisicion_fkey
      foreign key (grupo_pedido_id) references public.requisiciones(id);
  end if;
end $$;

create index if not exists pedidos_insumos_grupo_idx on public.pedidos_insumos (grupo_pedido_id);

-- ------------------------------------- tipos nuevos en historial / notificaciones
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.historial_eventos'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%entidad_tipo%'
  loop
    execute format('alter table public.historial_eventos drop constraint %I', c.conname);
  end loop;
  alter table public.historial_eventos
    add constraint historial_eventos_entidad_tipo_check
    check (entidad_tipo in ('orden_compra', 'pedido', 'requisicion'));

  for c in
    select conname from pg_constraint
    where conrelid = 'public.notificaciones'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%entidad_tipo%'
  loop
    execute format('alter table public.notificaciones drop constraint %I', c.conname);
  end loop;
  alter table public.notificaciones
    add constraint notificaciones_entidad_tipo_check
    check (entidad_tipo in ('pedido_insumo', 'orden_compra', 'requisicion')) not valid;
end $$;

-- Historia que ya existía: creación y resolución, marcadas como reconstruidas.
insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, created_at, datos)
select 'requisicion', r.id, 'creada', r.solicitado_por, r.created_at,
       jsonb_build_object('numero', r.numero, 'reconstruido', true)
  from public.requisiciones r
 where not exists (
   select 1 from public.historial_eventos h
   where h.entidad_tipo = 'requisicion' and h.entidad_id = r.id and h.evento = 'creada');

insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, created_at, datos)
select distinct on (p.grupo_pedido_id)
       'requisicion', p.grupo_pedido_id,
       case p.estado when 'aprobado' then 'aprobada' when 'rechazado' then 'rechazada' else 'cancelada' end,
       case when p.estado = 'cancelado' then p.cancelado_por else p.resuelto_por end,
       case when p.estado = 'cancelado' then p.motivo_cancelacion else p.comentario_resolucion end,
       coalesce(case when p.estado = 'cancelado' then p.cancelado_at else p.resuelto_at end, p.created_at),
       jsonb_build_object('reconstruido', true)
  from public.pedidos_insumos p
 where p.estado in ('aprobado', 'rechazado', 'cancelado')
   and not exists (
     select 1 from public.historial_eventos h
     where h.entidad_tipo = 'requisicion' and h.entidad_id = p.grupo_pedido_id
       and h.evento in ('aprobada', 'rechazada', 'cancelada'))
 order by p.grupo_pedido_id, p.created_at;

-- --------------------------------------------------------- ayudas internas
-- Cuánto de una línea ya está en órdenes de compra vigentes (ni canceladas ni
-- rechazadas). SECURITY DEFINER: el estado de compra de una requisición no
-- debe depender de qué órdenes deja ver RLS a quien pregunta.
create or replace function public._comprado_pedido(p_pedido_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(oci.cantidad), 0)
  from ordenes_compra_items oci
  join ordenes_compra oc on oc.id = oci.orden_compra_id
  where oci.pedido_insumo_id = p_pedido_id
    and oc.estado not in ('cancelada', 'rechazada')
$$;

revoke all on function public._comprado_pedido(uuid) from public, anon;
grant execute on function public._comprado_pedido(uuid) to authenticated, service_role;

-- Lo comprado de varias líneas a la vez (para mostrar el avance de compra en
-- el detalle de una requisición; ver _comprado_pedido).
create or replace function public.comprado_pedidos(p_ids uuid[])
returns table(pedido_id uuid, comprado numeric)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, public._comprado_pedido(p.id)
  from pedidos_insumos p
  where p.id = any(p_ids)
$$;

revoke all on function public.comprado_pedidos(uuid[]) from public, anon;
grant execute on function public.comprado_pedidos(uuid[]) to authenticated;

create or replace function public._evento_requisicion(
  p_id uuid, p_evento text, p_motivo text default null, p_datos jsonb default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('requisicion', p_id, p_evento, auth.uid(), p_motivo, p_datos)
$$;

revoke all on function public._evento_requisicion(uuid, text, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------- vista
create or replace view public.requisiciones_vista with (security_invoker = true) as
select
  r.id, r.numero, r.proyecto_id,
  pr.codigo as proyecto_codigo, pr.nombre as proyecto_nombre,
  r.solicitado_por, pf.nombre as solicitante_nombre,
  r.fecha_requerida, r.urgente, r.observaciones, r.soporte_url, r.created_at,
  l.n_lineas,
  case
    when l.n_lineas = 0 or l.n_cancelado = l.n_lineas then 'cancelada'
    when l.n_pendiente > 0 then 'pendiente'
    when l.n_aprobado > 0 then 'aprobada'
    else 'rechazada'
  end as estado,
  case
    when l.n_pendiente > 0 or l.n_aprobado = 0 then null
    when l.n_activas = 0 then 'rechazada_compras'
    when l.n_por_comprar = 0 then 'completa'
    else 'pendiente'
  end as estado_compra
from public.requisiciones r
left join public.proyectos pr on pr.id = r.proyecto_id
left join public.perfiles pf on pf.id = r.solicitado_por
cross join lateral (
  select
    count(*)::int as n_lineas,
    (count(*) filter (where p.estado = 'cancelado'))::int as n_cancelado,
    (count(*) filter (where p.estado = 'pendiente'))::int as n_pendiente,
    (count(*) filter (where p.estado = 'aprobado'))::int as n_aprobado,
    (count(*) filter (where p.estado = 'aprobado' and p.rechazado_compras_at is null))::int as n_activas,
    (count(*) filter (
       where p.estado = 'aprobado' and p.rechazado_compras_at is null
         and public._comprado_pedido(p.id) < p.cantidad))::int as n_por_comprar
  from public.pedidos_insumos p
  where p.grupo_pedido_id = r.id
) l;

revoke all on public.requisiciones_vista from anon;
grant select on public.requisiciones_vista to authenticated;

-- ------------------------------------------------------- crear requisición
-- p_lineas: [{presupuesto_item_id, item_apu_id, insumo_id, cantidad}, ...]
-- Crea la cabecera (con su número) y todas las líneas en una sola operación.
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

-- --------------------------------------------- aprobar / rechazar (entera)
create or replace function public.resolver_requisicion(p_id uuid, p_estado text, p_comentario text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- ------------------------------------------------------------- desaprobar
create or replace function public.desaprobar_requisicion(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- --------------------------------------------------------------- cancelar
-- Solo quien la hizo y solo mientras está pendiente de aprobación. El cupo de
-- todas sus líneas vuelve al presupuesto.
create or replace function public.cancelar_requisicion(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- -------------------------------------------------------------- modificar
-- Reemplaza el contenido de una requisición pendiente: agrega, quita o cambia
-- insumos/ítems/cantidades, y la fecha, urgencia y observaciones. Cada línea
-- se revalida contra el cupo: lo disponible MÁS lo que esa misma línea ya
-- tenía reservado.
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

-- --------------------------------------------------------- historial
-- Ahora también de una requisición: sus propios eventos y, además, los
-- rechazos de Compras de cualquiera de sus líneas (con el nombre del insumo).
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
  elsif p_tipo = 'requisicion' then
    select exists (
      select 1 from public.pedidos_insumos p
      where p.grupo_pedido_id = p_id
        and (public.usuario_tiene_acceso_a_item(p.presupuesto_item_id)
             or public.rol_compras(auth.uid())
             or public.tiene_accion(auth.uid(), 'aprobar_pedidos'))
    ) into v_ok;
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
$$;

-- ---------------------------------------------------- notificaciones
-- Aprobar/rechazar una requisición ya notifica resolver_requisicion (una sola
-- notificación por requisición, no una por línea). Este disparador queda solo
-- para el rechazo de COMPRAS, que sí es por línea.
create or replace function public.notificar_resolucion_pedido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
$$;

-- ------------------------------------------------------------- permisos
revoke all on function public.crear_requisicion(jsonb, date, boolean, text, text) from public, anon;
revoke all on function public.resolver_requisicion(uuid, text, text) from public, anon;
revoke all on function public.desaprobar_requisicion(uuid, text) from public, anon;
revoke all on function public.cancelar_requisicion(uuid, text) from public, anon;
revoke all on function public.modificar_requisicion(uuid, jsonb, date, boolean, text) from public, anon;
revoke all on function public.historial_entidad(text, uuid) from public, anon;
grant execute on function public.crear_requisicion(jsonb, date, boolean, text, text) to authenticated;
grant execute on function public.resolver_requisicion(uuid, text, text) to authenticated;
grant execute on function public.desaprobar_requisicion(uuid, text) to authenticated;
grant execute on function public.cancelar_requisicion(uuid, text) to authenticated;
grant execute on function public.modificar_requisicion(uuid, jsonb, date, boolean, text) to authenticated;
grant execute on function public.historial_entidad(text, uuid) to authenticated;
