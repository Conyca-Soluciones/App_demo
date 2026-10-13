-- Estado de las requisiciones guardado en la tabla, no recalculado al leer.
--
-- requisiciones_vista calculaba estado y estado_compra de CADA requisición al
-- consultarla: contaba sus líneas y, por cada línea aprobada, sumaba lo
-- comprado en órdenes de compra (_comprado_pedido). Filtrar "pendientes" o
-- paginar obligaba a calcular todas las requisiciones del histórico antes de
-- quedarse con 20: crece con cada requisición que se hace.
--
-- Ahora requisiciones guarda n_lineas, estado y estado_compra, y los
-- mantienen al día triggers sobre lo único que los cambia:
--   pedidos_insumos       (líneas creadas, borradas o modificadas)
--   ordenes_compra_items  (lo comprado de cada línea)
--   ordenes_compra        (OC cancelada o rechazada deja de contar)
-- Los triggers son por sentencia: aprobar 200 líneas recalcula la requisición
-- una vez, no 200. La regla es la misma de la vista (una sola función,
-- _estado_requisiciones) y la vista conserva columnas, orden y tipos, así que
-- la app no cambia.
--
-- Bloqueos: el recálculo bloquea la fila de la requisición. Si alguien crea
-- una OC justo en el mismo instante en que otro desaprueba ESA requisición,
-- Postgres puede abortar una de las dos ("deadlock detected") y basta con
-- repetirla; antes una esperaba a la otra.
--
-- Al final: un chequeo que compara lo guardado con lo calculado (debe dar 0).
-- Se puede correr más de una vez.

alter table public.requisiciones
  add column if not exists n_lineas      integer not null default 0,
  add column if not exists estado        text    not null default 'cancelada',
  add column if not exists estado_compra text;

-- La regla (antes dentro de la vista). Devuelve lo calculado para p_ids.
create or replace function public._estado_requisiciones(p_ids uuid[])
returns table(id uuid, n_lineas integer, estado text, estado_compra text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    r.id,
    l.n_lineas,
    case
      when l.n_lineas = 0 or l.n_cancelado = l.n_lineas then 'cancelada'
      when l.n_pendiente > 0 then 'pendiente'
      when l.n_aprobado > 0 then 'aprobada'
      else 'rechazada'
    end,
    case
      when l.n_pendiente > 0 or l.n_aprobado = 0 then null
      when l.n_activas = 0 then 'rechazada_compras'
      when l.n_por_comprar = 0 then 'completa'
      else 'pendiente'
    end
  from public.requisiciones r
  cross join lateral (
    select
      count(*)::integer as n_lineas,
      count(*) filter (where p.estado = 'cancelado')::integer as n_cancelado,
      count(*) filter (where p.estado = 'pendiente')::integer as n_pendiente,
      count(*) filter (where p.estado = 'aprobado')::integer as n_aprobado,
      count(*) filter (where p.estado = 'aprobado' and p.rechazado_compras_at is null)::integer as n_activas,
      count(*) filter (where p.estado = 'aprobado' and p.rechazado_compras_at is null
                         and public._comprado_pedido(p.id) < p.cantidad)::integer as n_por_comprar
    from public.pedidos_insumos p
    where p.grupo_pedido_id = r.id
  ) l
  where r.id = any(p_ids)
$function$;

-- Guarda lo calculado; solo escribe las que cambiaron.
create or replace function public._recalcular_estado_requisiciones(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  -- mismo orden de bloqueo en todas las transacciones
  perform 1 from public.requisiciones r where r.id = any(p_ids) order by r.id for update;
  update public.requisiciones r
  set n_lineas = e.n_lineas, estado = e.estado, estado_compra = e.estado_compra
  from public._estado_requisiciones(p_ids) e
  where r.id = e.id
    and (r.n_lineas, r.estado, r.estado_compra)
        is distinct from (e.n_lineas, e.estado, e.estado_compra);
end;
$function$;

revoke all on function public._estado_requisiciones(uuid[]) from public, anon, authenticated;
revoke all on function public._recalcular_estado_requisiciones(uuid[]) from public, anon, authenticated;

-- Triggers. Postgres no deja una tabla de transición en un trigger de varios
-- eventos, por eso hay uno por evento.

-- pedidos_insumos: la requisición de las líneas tocadas (la vieja y la nueva
-- si cambió grupo_pedido_id).
create or replace function public._trg_estado_req_pedidos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct grupo_pedido_id) into v_ids from nuevas;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct grupo_pedido_id) into v_ids from viejas;
  else
    select array_agg(distinct g) into v_ids
    from (select grupo_pedido_id as g from nuevas
          union select grupo_pedido_id from viejas) x;
  end if;
  perform public._recalcular_estado_requisiciones(v_ids);
  return null;
end;
$function$;

drop trigger if exists estado_req_pedidos_ins on public.pedidos_insumos;
drop trigger if exists estado_req_pedidos_upd on public.pedidos_insumos;
drop trigger if exists estado_req_pedidos_del on public.pedidos_insumos;
create trigger estado_req_pedidos_ins after insert on public.pedidos_insumos
  referencing new table as nuevas
  for each statement execute function public._trg_estado_req_pedidos();
create trigger estado_req_pedidos_upd after update on public.pedidos_insumos
  referencing old table as viejas new table as nuevas
  for each statement execute function public._trg_estado_req_pedidos();
create trigger estado_req_pedidos_del after delete on public.pedidos_insumos
  referencing old table as viejas
  for each statement execute function public._trg_estado_req_pedidos();

-- ordenes_compra_items: la requisición de cada línea comprada.
create or replace function public._trg_estado_req_oc_items()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct p.grupo_pedido_id) into v_ids
    from nuevas i join public.pedidos_insumos p on p.id = i.pedido_insumo_id;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct p.grupo_pedido_id) into v_ids
    from viejas i join public.pedidos_insumos p on p.id = i.pedido_insumo_id;
  else
    select array_agg(distinct p.grupo_pedido_id) into v_ids
    from (select pedido_insumo_id from nuevas
          union select pedido_insumo_id from viejas) i
    join public.pedidos_insumos p on p.id = i.pedido_insumo_id;
  end if;
  perform public._recalcular_estado_requisiciones(v_ids);
  return null;
end;
$function$;

drop trigger if exists estado_req_oc_items_ins on public.ordenes_compra_items;
drop trigger if exists estado_req_oc_items_upd on public.ordenes_compra_items;
drop trigger if exists estado_req_oc_items_del on public.ordenes_compra_items;
create trigger estado_req_oc_items_ins after insert on public.ordenes_compra_items
  referencing new table as nuevas
  for each statement execute function public._trg_estado_req_oc_items();
create trigger estado_req_oc_items_upd after update on public.ordenes_compra_items
  referencing old table as viejas new table as nuevas
  for each statement execute function public._trg_estado_req_oc_items();
create trigger estado_req_oc_items_del after delete on public.ordenes_compra_items
  referencing old table as viejas
  for each statement execute function public._trg_estado_req_oc_items();

-- ordenes_compra: solo cuando cambia el estado (cancelar/rechazar/revivir).
create or replace function public._trg_estado_req_oc()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids uuid[];
begin
  select array_agg(distinct p.grupo_pedido_id) into v_ids
  from nuevas n
  join viejas v on v.id = n.id
  join public.ordenes_compra_items i on i.orden_compra_id = n.id
  join public.pedidos_insumos p on p.id = i.pedido_insumo_id
  where n.estado is distinct from v.estado;
  perform public._recalcular_estado_requisiciones(v_ids);
  return null;
end;
$function$;

drop trigger if exists estado_req_oc_upd on public.ordenes_compra;
create trigger estado_req_oc_upd after update on public.ordenes_compra
  referencing old table as viejas new table as nuevas
  for each statement execute function public._trg_estado_req_oc();

revoke all on function public._trg_estado_req_pedidos() from public, anon, authenticated;
revoke all on function public._trg_estado_req_oc_items() from public, anon, authenticated;
revoke all on function public._trg_estado_req_oc() from public, anon, authenticated;

-- Llenar las que ya existen.
select public._recalcular_estado_requisiciones(array(select id from public.requisiciones));

-- La vista lee lo guardado. Mismas columnas, mismo orden, mismos tipos.
create or replace view public.requisiciones_vista
with (security_invoker = true) as
select
  r.id,
  r.numero,
  r.proyecto_id,
  pr.codigo as proyecto_codigo,
  pr.nombre as proyecto_nombre,
  r.solicitado_por,
  pf.nombre as solicitante_nombre,
  r.fecha_requerida,
  r.urgente,
  r.observaciones,
  r.soporte_url,
  r.created_at,
  r.n_lineas,
  r.estado,
  r.estado_compra
from public.requisiciones r
left join public.proyectos pr on pr.id = r.proyecto_id
left join public.perfiles pf on pf.id = r.solicitado_por;

-- Para "pendientes por aprobar" (urgentes primero, más viejas primero) y para
-- el registro filtrado por estado (más nuevas primero).
create index if not exists requisiciones_estado_urgente_idx
  on public.requisiciones (estado, urgente desc, created_at, numero);
create index if not exists requisiciones_estado_created_idx
  on public.requisiciones (estado, created_at desc, numero desc);

-- Chequeo: requisiciones donde lo guardado no coincide con la regla. Debe dar 0.
select count(*) as requisiciones_con_estado_distinto
from public.requisiciones r
join public._estado_requisiciones(array(select id from public.requisiciones)) e on e.id = r.id
where (r.n_lineas, r.estado, r.estado_compra)
      is distinct from (e.n_lineas, e.estado, e.estado_compra);
