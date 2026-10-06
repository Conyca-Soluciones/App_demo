-- A&F · Migración 6: que un pago nunca se pierda en silencio.
--
-- 1. Si al aprobar una orden NO se pudieron crear sus pagos (la aprobación de la
--    orden nunca se bloquea), el error queda registrado en pagos_fallos y la
--    pantalla del Consolidado avisa y permite reintentar.
-- 2. Un pago aprobado sin ITEM (el proyecto no tenía empresa, o la empresa no
--    tenía consolidado) lo recibe solo en cuanto se corrige eso, y el aviso dice
--    cuál de las dos cosas falta.
-- 3. reintentar_pagos(): reintenta los fallos y asigna ITEM a los que esperan.

-- ------------------------------------------------------------ pagos_fallos
create table if not exists public.pagos_fallos (
  id              bigint generated always as identity primary key,
  orden_compra_id uuid not null references public.ordenes_compra(id) on delete cascade,
  error           text not null,
  creado_en       timestamptz not null default now(),
  resuelto_en     timestamptz
);
create index if not exists idx_pagos_fallos_orden on public.pagos_fallos(orden_compra_id);
create index if not exists idx_pagos_fallos_pendientes on public.pagos_fallos(creado_en) where resuelto_en is null;

alter table public.pagos_fallos enable row level security;
drop policy if exists pagos_fallos_select on public.pagos_fallos;
create policy pagos_fallos_select on public.pagos_fallos
  for select to authenticated
  using (public.tiene_pestana((select auth.uid()), 'ayf.consolidado'));
grant select on public.pagos_fallos to authenticated;

-- Aprobados que esperan ITEM.
create index if not exists idx_pagos_aprobados_sin_item
  on public.pagos(aprobado_en) where estado = 'aprobado' and item is null;

-- -------------------------------------------------------------- novedad
create or replace function public._pago_novedad(p_pago_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(concat_ws(' ',
    case when p.empresa_id is null
      then 'El proyecto no tiene una empresa asignada.'
      when p.consolidado_id is null
      then 'La empresa no tiene consolidado asignado.' end,
    case when p.tercero_id is null
      then 'No hay un tercero registrado para este pago.'
      when p.cuenta_tercero_id is null
      then 'Falta elegir la cuenta bancaria del tercero.'
      when c.estado is distinct from 'ACTIVO'
      then 'La cuenta bancaria del tercero está pendiente de verificar.' end
  )), '')
  from public.pagos p
  left join public.terceros_cuentas c on c.id = p.cuenta_tercero_id
  where p.id = p_pago_id
$$;
revoke all on function public._pago_novedad(uuid) from public, anon, authenticated;

-- Vuelve a leer la empresa y el consolidado del proyecto (solo mientras el
-- pago no tiene ITEM: con ITEM, su consolidado ya no cambia).
create or replace function public._pago_sincronizar_empresa(p_pago_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pagos p
     set empresa_id = py.empresa_id,
         consolidado_id = e.consolidado_id
    from public.proyectos py
    left join public.empresas e on e.id = py.empresa_id
   where p.id = p_pago_id
     and py.id = p.proyecto_id
     and p.item is null
     and p.estado in ('programado', 'solicitado', 'aprobado')
$$;
revoke all on function public._pago_sincronizar_empresa(uuid) from public, anon, authenticated;

-- Semana e ITEM de un pago aprobado (ver migración 2), ahora releyendo antes la
-- empresa y el consolidado del proyecto si todavía no se conocían.
create or replace function public._pago_asignar_item(p_pago_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p     record;
  v_anio  smallint;
  v_sem   smallint;
  v_item  integer;
begin
  select id, estado, consolidado_id, item, aprobado_en into v_p
    from public.pagos where id = p_pago_id for update;
  if not found or v_p.item is not null or v_p.estado <> 'aprobado' then
    return;
  end if;

  if v_p.consolidado_id is null then
    perform public._pago_sincronizar_empresa(p_pago_id);
    select consolidado_id into v_p.consolidado_id from public.pagos where id = p_pago_id;
  end if;

  if v_p.consolidado_id is not null then
    select s.anio, s.semana into v_anio, v_sem from public._semana_pago(coalesce(v_p.aprobado_en, now())) s;

    insert into public.pagos_contadores as c (consolidado_id, anio, semana, ultimo)
    values (v_p.consolidado_id, v_anio, v_sem, 1)
    on conflict (consolidado_id, anio, semana) do update set ultimo = c.ultimo + 1
    returning c.ultimo into v_item;

    update public.pagos set anio = v_anio, semana = v_sem, item = v_item where id = p_pago_id;
  end if;

  perform public._pago_actualizar_novedad(p_pago_id);
end;
$$;
revoke all on function public._pago_asignar_item(uuid) from public, anon, authenticated;

-- Al aprobar un pago también se relee el proyecto (por si la empresa se asignó
-- mientras esperaba).
create or replace function public.aprobar_pago(p_pago_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para aprobar pagos.';
  end if;

  update public.pagos
     set estado = 'aprobado', aprobado_por = auth.uid(), aprobado_en = now()
   where id = p_pago_id and estado = 'solicitado';
  if not found then
    raise exception 'El pago no existe o ya no está pendiente de aprobación.';
  end if;

  perform public._pago_asignar_item(p_pago_id);
end;
$$;
revoke all on function public.aprobar_pago(uuid) from public, anon;
grant execute on function public.aprobar_pago(uuid) to authenticated;

-- Cuando a un proyecto se le asigna (o cambia) la empresa, sus pagos que
-- esperaban eso se actualizan y reciben ITEM en el orden en que se aprobaron.
create or replace function public._proyecto_empresa_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  for v_id in
    select id from public.pagos
     where proyecto_id = new.id and item is null
       and estado in ('programado', 'solicitado', 'aprobado')
     order by aprobado_en nulls last, id
  loop
    perform public._pago_sincronizar_empresa(v_id);
    perform public._pago_asignar_item(v_id);
    perform public._pago_actualizar_novedad(v_id);
  end loop;
  return new;
end;
$$;
revoke all on function public._proyecto_empresa_cambio() from public, anon, authenticated;

drop trigger if exists trg_proyecto_empresa_cambio on public.proyectos;
create trigger trg_proyecto_empresa_cambio
  after update of empresa_id on public.proyectos
  for each row when (old.empresa_id is distinct from new.empresa_id)
  execute function public._proyecto_empresa_cambio();

-- ----------------------------------------- registrar el fallo y reintentar
create or replace function public._oc_estado_pagos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'aprobada' then
    -- Nunca debe impedir que la orden se apruebe: si falla, queda registrado.
    begin
      perform public._crear_pagos_orden(new.id);
    exception when others then
      raise warning 'No se pudieron crear los pagos de la orden %: %', new.id, sqlerrm;
      begin
        insert into public.pagos_fallos (orden_compra_id, error) values (new.id, sqlerrm);
      exception when others then
        null;
      end;
    end;

  elsif old.estado = 'aprobada' and new.estado in ('pendiente_aprobacion', 'cancelada') then
    if exists (
      select 1 from public.pagos
       where orden_compra_id = new.id and estado in ('en_dispersion', 'dispersado')
    ) then
      raise exception
        'No se puede devolver ni cancelar la orden: ya tiene un pago en dispersión o pagado. Resuélvelo primero con Financiera.';
    end if;

    update public.pagos
       set estado = 'anulado', anulado_en = now(),
           motivo_anulacion = case when new.estado = 'cancelada'
             then 'La orden de compra fue cancelada.' else 'La orden de compra fue devuelta a pendiente.' end
     where orden_compra_id = new.id
       and estado in ('programado', 'solicitado', 'aprobado', 'liquidado');

    -- Los fallos de una orden que ya no está aprobada dejan de importar.
    update public.pagos_fallos set resuelto_en = now()
     where orden_compra_id = new.id and resuelto_en is null;
  end if;
  return null;
end;
$$;
revoke all on function public._oc_estado_pagos() from public, anon, authenticated;

-- Reintenta los pagos de las órdenes que fallaron y asigna ITEM a los
-- aprobados que lo esperan. Devuelve cuántos fallos se resolvieron y a cuántos
-- pagos se les dio ITEM.
create or replace function public.reintentar_pagos()
returns table(fallos_resueltos integer, items_asignados integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_f      record;
  v_id     uuid;
  v_fallos integer := 0;
  v_items  integer := 0;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_pagos') then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;

  for v_f in
    select distinct on (orden_compra_id) id, orden_compra_id
      from public.pagos_fallos
     where resuelto_en is null
     order by orden_compra_id, creado_en desc
  loop
    begin
      perform public._crear_pagos_orden(v_f.orden_compra_id);
      update public.pagos_fallos set resuelto_en = now()
       where orden_compra_id = v_f.orden_compra_id and resuelto_en is null;
      v_fallos := v_fallos + 1;
    exception when others then
      update public.pagos_fallos set error = sqlerrm where id = v_f.id;
    end;
  end loop;

  for v_id in
    select id from public.pagos
     where estado = 'aprobado' and item is null
     order by aprobado_en, id
  loop
    perform public._pago_asignar_item(v_id);
    if exists (select 1 from public.pagos where id = v_id and item is not null) then
      v_items := v_items + 1;
    end if;
  end loop;

  return query select v_fallos, v_items;
end;
$$;
revoke all on function public.reintentar_pagos() from public, anon;
grant execute on function public.reintentar_pagos() to authenticated;
