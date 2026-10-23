-- Dispersores en la app (decisiones del usuario, 2026-10-23): toda la consola
-- de dispersores de Python (servidor.py + nucleo/) dentro de CONYCA360, en
-- A&F › Pagos › Realizar Pagos. Una persona (Financiera) dispersa todos los
-- pagos de los tres consolidados.
--
-- Entran los pagos LIQUIDADOS (Consolidado) con su valor a pagar truncado al
-- peso. La cuenta del beneficiario es SIEMPRE la del pago (la del titular si
-- se eligió otro). Los mismos seis estados de la consola: Por asignar,
-- Asignados, Confirmar cuenta, Bloqueados, No van por dispersor (PSE y lo que
-- se paga por otro medio: van a "Otros pagos pendientes") y Ya dispersados.
-- Generar = el pago queda DISPERSADO (no hay estado "pagado", decisión del
-- usuario): es el seguro contra el doble pago (antes la columna X del Sheet).
--
-- Cada tanda (cuenta a debitar + semana) queda registrada con sus archivos (los
-- de Python, mismos nombres y formatos), el soporte GRUPAL (Ronda N) y, por
-- cada pago, su soporte INDIVIDUAL; todo en el bucket privado `dispersores`.

-- 1. Pestaña y acción ---------------------------------------------------------

insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
 cross join (values ('tab.ayf.realizar_pagos'), ('accion.generar_dispersores')) as p(permiso)
 where r.clave = 'financiera'
on conflict do nothing;

-- Quien realiza pagos ve los pagos (y sus terceros) de los tres consolidados.
create or replace function public._consolidados_visibles(p_uid uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.consolidados c
   where public.tiene_pestana(p_uid, 'ayf.consolidado_' || c.clave)
      or public.tiene_pestana(p_uid, 'ayf.consolidado_gerencia')
      or public.tiene_pestana(p_uid, 'ayf.realizar_pagos')
$$;

-- Las cuentas a debitar (BASE_CUENTAS): las lee quien realiza pagos.
drop policy if exists cuentas_empresa_select on public.cuentas_empresa;
create policy cuentas_empresa_select on public.cuentas_empresa for select to authenticated
  using ((select public.es_admin((select auth.uid())))
         or (select public.tiene_pestana((select auth.uid()), 'ayf.realizar_pagos')));

-- 2. Pagos --------------------------------------------------------------------

alter table public.pagos
  add column if not exists cuenta_debitar_id uuid references public.cuentas_empresa(id),
  add column if not exists fuera_dispersor boolean not null default false,
  add column if not exists cuenta_confirmada_en timestamptz,
  add column if not exists cuenta_confirmada_por uuid references public.perfiles(id),
  add column if not exists dispersion_id uuid,
  add column if not exists dispersado_en timestamptz,
  -- Etiquetas del pago (las define el usuario; 'NOM' = nómina: el archivo
  -- lleva _NOM y la tanda va aparte, como el modo nómina de la consola).
  add column if not exists etiquetas text[] not null default '{}';
create index if not exists idx_pagos_cuenta_debitar on public.pagos(cuenta_debitar_id) where cuenta_debitar_id is not null;
create index if not exists idx_pagos_dispersion on public.pagos(dispersion_id) where dispersion_id is not null;
create index if not exists idx_pagos_cuenta_confirmada_por on public.pagos(cuenta_confirmada_por) where cuenta_confirmada_por is not null;
create index if not exists idx_pagos_liquidados_semana on public.pagos(anio, semana) where liquidacion_estado = 'liquidado';

-- Otra cuenta en el pago = hay que confirmarla otra vez.
create or replace function public._pago_cuenta_sin_confirmar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.cuenta_tercero_id is distinct from old.cuenta_tercero_id then
    new.cuenta_confirmada_en := null;
    new.cuenta_confirmada_por := null;
  end if;
  return new;
end;
$$;
revoke all on function public._pago_cuenta_sin_confirmar() from public, anon, authenticated;
drop trigger if exists trg_pago_cuenta_sin_confirmar on public.pagos;
create trigger trg_pago_cuenta_sin_confirmar before update of cuenta_tercero_id on public.pagos
  for each row execute function public._pago_cuenta_sin_confirmar();

-- 3. Tandas -------------------------------------------------------------------

create table if not exists public.dispersiones (
  id uuid primary key,
  cuenta_empresa_id uuid not null references public.cuentas_empresa(id),
  apodo text not null,
  banco text not null,
  clase_pago text not null,
  anio int,
  semana int,
  es_nomina boolean not null default false,
  secuencia text not null,
  ronda int not null,
  nombre_base text not null,
  fecha date not null,
  registros int not null,
  total numeric(18,2) not null,
  truncado text,
  archivos jsonb not null,           -- [{nombre, ruta, tipo}]
  soporte_ruta text not null,        -- el soporte grupal (Ronda N)
  soporte_nombre text not null,
  generado_por uuid not null references public.perfiles(id),
  generado_en timestamptz not null default now()
);
create index if not exists idx_dispersiones_cuenta_semana on public.dispersiones(cuenta_empresa_id, anio, semana);
create index if not exists idx_dispersiones_nombre on public.dispersiones(nombre_base, anio);
create index if not exists idx_dispersiones_generado_por on public.dispersiones(generado_por);
create index if not exists idx_dispersiones_generado_en on public.dispersiones(generado_en desc);

create table if not exists public.dispersion_pagos (
  dispersion_id uuid not null references public.dispersiones(id) on delete cascade,
  pago_id uuid not null unique references public.pagos(id),
  item text,
  valor numeric(18,2) not null,
  soporte_ruta text not null,        -- el soporte individual del pago
  soporte_nombre text not null,
  primary key (dispersion_id, pago_id)
);

alter table public.pagos drop constraint if exists pagos_dispersion_id_fkey;
alter table public.pagos add constraint pagos_dispersion_id_fkey
  foreign key (dispersion_id) references public.dispersiones(id);

alter table public.dispersiones enable row level security;
alter table public.dispersion_pagos enable row level security;
-- Se ven con Realizar Pagos, o si se ve alguno de sus pagos (RLS de pagos).
drop policy if exists dispersiones_select on public.dispersiones;
create policy dispersiones_select on public.dispersiones for select to authenticated
  using ((select public.tiene_pestana((select auth.uid()), 'ayf.realizar_pagos'))
         or exists (select 1 from public.dispersion_pagos dp join public.pagos g on g.id = dp.pago_id
                     where dp.dispersion_id = dispersiones.id));
drop policy if exists dispersion_pagos_select on public.dispersion_pagos;
create policy dispersion_pagos_select on public.dispersion_pagos for select to authenticated
  using ((select public.tiene_pestana((select auth.uid()), 'ayf.realizar_pagos'))
         or exists (select 1 from public.pagos g where g.id = dispersion_pagos.pago_id));
revoke insert, update, delete on public.dispersiones, public.dispersion_pagos from anon, authenticated;
grant select on public.dispersiones, public.dispersion_pagos to authenticated;

-- 4. Archivos -----------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('dispersores', 'dispersores', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Ruta <dispersion_id>/<archivo> (y <dispersion_id>/items/<soporte individual>).
drop policy if exists dispersores_archivos_select on storage.objects;
create policy dispersores_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'dispersores' and (
    (select public.tiene_pestana((select auth.uid()), 'ayf.realizar_pagos'))
    or exists (select 1 from public.dispersiones d where d.id::text = (storage.foldername(objects.name))[1])));
drop policy if exists dispersores_archivos_insert on storage.objects;
create policy dispersores_archivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dispersores'
              and (select public.tiene_accion((select auth.uid()), 'generar_dispersores'))
              and not exists (select 1 from public.dispersiones d where d.id::text = (storage.foldername(objects.name))[1]));
-- Se borra lo subido de una tanda que no se alcanzó a registrar.
drop policy if exists dispersores_archivos_delete on storage.objects;
create policy dispersores_archivos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dispersores'
         and (select public.tiene_accion((select auth.uid()), 'generar_dispersores'))
         and not exists (select 1 from public.dispersiones d where d.id::text = (storage.foldername(objects.name))[1]));

-- 5. Funciones ------------------------------------------------------------------

-- Lo que se puede tocar antes de generar: liquidado, aprobado, sin dispersar.
create or replace function public._pagos_por_dispersar(p_ids uuid[])
returns setof public.pagos
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'generar_dispersores') then
    raise exception 'No autorizado -- no tienes permiso para generar dispersores.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 3000 then
    raise exception 'Como mucho 3000 pagos a la vez.';
  end if;
  return query
    select g.* from public.pagos g
     where g.id = any (coalesce(p_ids, '{}'))
       and g.estado = 'aprobado' and g.liquidacion_estado = 'liquidado'
       and g.consolidado_id in (select public._consolidados_visibles(auth.uid()))
     for update of g;
end;
$$;
revoke all on function public._pagos_por_dispersar(uuid[]) from public, anon, authenticated;

-- Paso 2: cuenta a debitar (null = quitar la asignación). No se asigna a lo
-- que no va por dispersor (/api/asignar solo tocaba Por asignar y Asignados;
-- la pantalla ya filtra los bloqueados y por confirmar).
create or replace function public.asignar_cuenta_debitar(p_ids uuid[], p_cuenta_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_cuenta_id is not null and not exists (select 1 from public.cuentas_empresa c where c.id = p_cuenta_id and c.estado = 'ACTIVA') then
    raise exception 'La cuenta a debitar no existe o no está activa.';
  end if;
  update public.pagos g set cuenta_debitar_id = p_cuenta_id
    from public._pagos_por_dispersar(p_ids) x
   where g.id = x.id and not x.fuera_dispersor;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- "No van por dispersor" (se pagan por otro medio) o devolverlos al dispersor.
create or replace function public.marcar_fuera_dispersor(p_ids uuid[], p_fuera boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.pagos g
     set fuera_dispersor = p_fuera,
         cuenta_debitar_id = case when p_fuera then null else g.cuenta_debitar_id end
    from public._pagos_por_dispersar(p_ids) x
   where g.id = x.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- "Confirmar cuenta del tercero": la cuenta del pago está sin verificar o
-- cambió después de solicitarlo. Queda en el soporte ("confirmadas a mano").
create or replace function public.confirmar_cuenta_pagos(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.pagos g
     set cuenta_confirmada_en = now(), cuenta_confirmada_por = auth.uid(), cuenta_modificada = null
    from public._pagos_por_dispersar(p_ids) x
   where g.id = x.id and x.cuenta_tercero_id is not null;
  get diagnostics v_n = row_count;
  -- la novedad de "la cuenta cambió" se quita con la confirmación
  update public.pagos g set novedad = public._pago_novedad(g.id)
   where g.id = any (coalesce(p_ids, '{}')) and g.cuenta_confirmada_por = auth.uid();
  return v_n;
end;
$$;

-- Generar: registra TODAS las tandas en una transacción (todo o nada) y deja
-- sus pagos dispersados. Cada tanda:
--   {id, cuenta_empresa_id, clase_pago, anio, semana, es_nomina, secuencia,
--    ronda, nombre_base, fecha, total, truncado, archivos:[{nombre,ruta,tipo}],
--    soporte:{nombre,ruta}, pagos:[{pago_id, item, valor, soporte:{nombre,ruta}}]}
-- La base vuelve a revisar: cada pago sigue liquidado, sin dispersar, asignado
-- a ESA cuenta, con el valor a pagar truncado que dice la tanda; la secuencia y
-- la ronda son las siguientes (otra persona pudo generar en el medio); y cada
-- archivo existe en el bucket.
create or replace function public.registrar_dispersiones(p_tandas jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t jsonb;
  v_p jsonb;
  v_a jsonb;
  v_ids uuid[];
  v_pago public.pagos;
  v_cuenta public.cuentas_empresa;
  v_banco text;
  v_n_previas int;
  v_ronda int;
  v_total numeric;
  v_n int := 0;
  v_id uuid;
begin
  if not public.tiene_accion(auth.uid(), 'generar_dispersores') then
    raise exception 'No autorizado -- no tienes permiso para generar dispersores.';
  end if;
  if jsonb_typeof(p_tandas) is distinct from 'array' or jsonb_array_length(p_tandas) = 0 then
    raise exception 'No hay ningún pago asignado.';
  end if;

  for v_t in select * from jsonb_array_elements(p_tandas) loop
    v_id := (v_t ->> 'id')::uuid;
    select * into v_cuenta from public.cuentas_empresa where id = (v_t ->> 'cuenta_empresa_id')::uuid;
    if not found or v_cuenta.estado <> 'ACTIVA' then
      raise exception 'La cuenta a debitar de una tanda no existe o no está activa.';
    end if;
    select nombre into v_banco from public.bancos where id = v_cuenta.banco_id;
    -- Una generación a la vez por cuenta (secuencia y ronda).
    perform pg_advisory_xact_lock(hashtext('dispersores:' || v_cuenta.id::text));

    select count(*) into v_n_previas from public.dispersiones d
     where d.cuenta_empresa_id = v_cuenta.id
       and d.anio is not distinct from (v_t ->> 'anio')::int and d.semana is not distinct from (v_t ->> 'semana')::int;
    if (v_t ->> 'secuencia') is distinct from ('A' || (v_n_previas + 1)) then
      raise exception 'Otra persona generó un dispersor de % mientras tanto: vuelve a generar.', v_cuenta.apodo;
    end if;
    select count(*) + 1 into v_ronda from public.dispersiones d
     where d.nombre_base = v_t ->> 'nombre_base' and d.anio is not distinct from (v_t ->> 'anio')::int;
    if (v_t ->> 'ronda')::int is distinct from v_ronda then
      raise exception 'Otra persona generó un dispersor de % mientras tanto: vuelve a generar.', v_cuenta.apodo;
    end if;

    -- Archivos (todos en la carpeta de la tanda).
    for v_a in select * from jsonb_array_elements(coalesce(v_t -> 'archivos', '[]') || jsonb_build_array(v_t -> 'soporte')) loop
      if split_part(v_a ->> 'ruta', '/', 1) <> v_id::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'dispersores' and o.name = v_a ->> 'ruta') then
        raise exception 'No se encontró el archivo % de la tanda de %.', v_a ->> 'nombre', v_cuenta.apodo;
      end if;
    end loop;

    select array_agg((x ->> 'pago_id')::uuid) into v_ids from jsonb_array_elements(v_t -> 'pagos') x;
    v_total := 0;
    for v_p in select * from jsonb_array_elements(v_t -> 'pagos') loop
      select * into v_pago from public.pagos where id = (v_p ->> 'pago_id')::uuid for update;
      if not found or not (v_pago.consolidado_id in (select public._consolidados_visibles(auth.uid()))) then
        raise exception 'Un pago de la tanda de % no existe o no tienes acceso.', v_cuenta.apodo;
      end if;
      if v_pago.estado <> 'aprobado' or v_pago.liquidacion_estado is distinct from 'liquidado' then
        raise exception 'El pago ITEM % ya no está listo para dispersar (está %).', v_pago.item, v_pago.estado;
      end if;
      if v_pago.cuenta_debitar_id is distinct from v_cuenta.id or v_pago.fuera_dispersor then
        raise exception 'El pago ITEM % ya no está asignado a %: vuelve a generar.', v_pago.item, v_cuenta.apodo;
      end if;
      if floor(v_pago.valor_a_pagar) <> (v_p ->> 'valor')::numeric then
        raise exception 'El valor a pagar del ITEM % cambió: vuelve a generar.', v_pago.item;
      end if;
      if split_part(v_p -> 'soporte' ->> 'ruta', '/', 1) <> v_id::text
         or not exists (select 1 from storage.objects o where o.bucket_id = 'dispersores' and o.name = v_p -> 'soporte' ->> 'ruta') then
        raise exception 'No se encontró el soporte individual del ITEM %.', v_pago.item;
      end if;
      v_total := v_total + (v_p ->> 'valor')::numeric;
    end loop;
    if v_total <> (v_t ->> 'total')::numeric then
      raise exception 'El total de la tanda de % no cuadra con sus pagos.', v_cuenta.apodo;
    end if;

    insert into public.dispersiones (id, cuenta_empresa_id, apodo, banco, clase_pago, anio, semana, es_nomina,
                                     secuencia, ronda, nombre_base, fecha, registros, total, truncado,
                                     archivos, soporte_ruta, soporte_nombre, generado_por)
    values (v_id, v_cuenta.id, v_cuenta.apodo, coalesce(v_banco, ''), v_t ->> 'clase_pago',
            (v_t ->> 'anio')::int, (v_t ->> 'semana')::int, coalesce((v_t ->> 'es_nomina')::boolean, false),
            v_t ->> 'secuencia', v_ronda, v_t ->> 'nombre_base', (v_t ->> 'fecha')::date,
            jsonb_array_length(v_t -> 'pagos'), v_total, nullif(v_t ->> 'truncado', ''),
            v_t -> 'archivos', v_t -> 'soporte' ->> 'ruta', v_t -> 'soporte' ->> 'nombre', auth.uid());
    insert into public.dispersion_pagos (dispersion_id, pago_id, item, valor, soporte_ruta, soporte_nombre)
    select v_id, (x ->> 'pago_id')::uuid, x ->> 'item', (x ->> 'valor')::numeric,
           x -> 'soporte' ->> 'ruta', x -> 'soporte' ->> 'nombre'
      from jsonb_array_elements(v_t -> 'pagos') x;
    update public.pagos
       set estado = 'dispersado', dispersion_id = v_id, dispersado_en = now()
     where id = any (v_ids);
    v_n := v_n + coalesce(array_length(v_ids, 1), 0);
  end loop;
  return v_n;
end;
$$;

revoke all on function public.asignar_cuenta_debitar(uuid[], uuid) from public, anon;
grant execute on function public.asignar_cuenta_debitar(uuid[], uuid) to authenticated;
revoke all on function public.marcar_fuera_dispersor(uuid[], boolean) from public, anon;
grant execute on function public.marcar_fuera_dispersor(uuid[], boolean) to authenticated;
revoke all on function public.confirmar_cuenta_pagos(uuid[]) from public, anon;
grant execute on function public.confirmar_cuenta_pagos(uuid[]) to authenticated;
revoke all on function public.registrar_dispersiones(jsonb) from public, anon;
grant execute on function public.registrar_dispersiones(jsonb) to authenticated;
