-- Anexos de la requisición (2026-11-24, decisión del usuario): al crear una requisición
-- se pueden adjuntar archivos (planos, fichas técnicas, fotos, cotizaciones...) para que
-- Compras tenga más información. Opcionales, hasta 10 por requisición, 10 MB cada uno;
-- PDF, imágenes, Excel o Word.
--
-- - Tabla requisicion_anexos: la ve quien ve la requisición (su RLS). Se escribe solo con
--   las funciones.
-- - Bucket privado "requisiciones", carpeta = id de la requisición. Sube quien hizo la
--   requisición; se lee si el archivo es anexo de una requisición que la persona ve.
-- - agregar_anexo_requisicion / eliminar_anexo_requisicion: solo quien hizo la
--   requisición, mientras no esté cancelada ni rechazada. Historial: anexo_agregado /
--   anexo_eliminado. Al eliminar devuelve la ruta y la app borra el archivo.
--
-- Solo agrega. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

-- ------------------------------------------------------------ Tabla
create table if not exists public.requisicion_anexos (
  id uuid primary key default gen_random_uuid(),
  requisicion_id uuid not null references public.requisiciones(id) on delete cascade,
  ruta text not null unique,
  nombre_archivo text not null,
  mime text,
  tamano bigint,
  subido_por uuid references public.perfiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_requisicion_anexos_requisicion on public.requisicion_anexos (requisicion_id);
create index if not exists idx_requisicion_anexos_subido_por on public.requisicion_anexos (subido_por);

alter table public.requisicion_anexos enable row level security;
drop policy if exists requisicion_anexos_select on public.requisicion_anexos;
create policy requisicion_anexos_select on public.requisicion_anexos for select to authenticated
  using (exists (select 1 from public.requisiciones r where r.id = requisicion_anexos.requisicion_id));
revoke all on public.requisicion_anexos from anon, authenticated;
grant select on public.requisicion_anexos to authenticated;

-- ------------------------------------------------------------ Bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('requisiciones', 'requisiciones', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
on conflict (id) do nothing;

-- Subir: en la carpeta de una requisición que hizo la persona.
drop policy if exists requisiciones_anexos_insert on storage.objects;
create policy requisiciones_anexos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'requisiciones'
              and (storage.foldername(name))[1] in (
                select r.id::text from public.requisiciones r where r.solicitado_por = (select auth.uid())));
-- Borrar: lo que subió y ya no es anexo (si guardar falla, o al eliminarlo).
drop policy if exists requisiciones_anexos_delete on storage.objects;
create policy requisiciones_anexos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'requisiciones' and owner_id = (select auth.uid())::text
         and name not in (select a.ruta from public.requisicion_anexos a));
-- Ver: si es anexo de una requisición que la persona ve (RLS de requisicion_anexos).
drop policy if exists requisiciones_anexos_select on storage.objects;
create policy requisiciones_anexos_select on storage.objects for select to authenticated
  using (bucket_id = 'requisiciones' and name in (select a.ruta from public.requisicion_anexos a));

-- ------------------------------------------------------------ Funciones
create or replace function public._exigir_anexos_requisicion(p_req uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
begin
  if auth.uid() is null then
    raise exception 'No autenticado.';
  end if;
  select id, solicitado_por, estado into v_r from requisiciones where id = p_req for update;
  if not found then
    raise exception 'La requisición no existe.';
  end if;
  if v_r.solicitado_por is distinct from auth.uid() then
    raise exception 'Solo quien hizo la requisición puede cambiar sus anexos.';
  end if;
  if v_r.estado in ('cancelada', 'rechazada') then
    raise exception 'La requisición está %: ya no se cambian sus anexos.', v_r.estado;
  end if;
end;
$$;

create or replace function public.agregar_anexo_requisicion(p_req uuid, p_anexo jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ruta text := nullif(trim(coalesce(p_anexo->>'ruta', '')), '');
  v_mime text := p_anexo->>'mime';
  v_nombre text := left(coalesce(nullif(trim(p_anexo->>'nombre_archivo'), ''), 'anexo'), 200);
  v_id uuid;
begin
  perform public._exigir_anexos_requisicion(p_req);
  if (select count(*) from requisicion_anexos where requisicion_id = p_req) >= 10 then
    raise exception 'Una requisición puede tener máximo 10 anexos.';
  end if;
  if v_ruta is null or v_ruta not like p_req::text || '/%' then
    raise exception 'La ruta del archivo no es de esta requisición.';
  end if;
  if coalesce(v_mime, '') not in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    raise exception 'El anexo debe ser PDF, imagen, Excel o Word.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'requisiciones' and o.name = v_ruta) then
    raise exception 'No se encontró el archivo. Vuelve a adjuntarlo.';
  end if;
  insert into requisicion_anexos (requisicion_id, ruta, nombre_archivo, mime, tamano, subido_por)
  values (p_req, v_ruta, v_nombre, v_mime, nullif(p_anexo->>'tamano', '')::bigint, auth.uid())
  returning id into v_id;
  perform public._evento_requisicion(p_req, 'anexo_agregado', null, jsonb_build_object('archivo', v_nombre));
  return v_id;
end;
$$;

create or replace function public.eliminar_anexo_requisicion(p_anexo uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a requisicion_anexos%rowtype;
begin
  select * into v_a from requisicion_anexos where id = p_anexo;
  if not found then
    raise exception 'El anexo no existe.';
  end if;
  perform public._exigir_anexos_requisicion(v_a.requisicion_id);
  delete from requisicion_anexos where id = p_anexo;
  perform public._evento_requisicion(v_a.requisicion_id, 'anexo_eliminado', null, jsonb_build_object('archivo', v_a.nombre_archivo));
  return v_a.ruta;
end;
$$;

revoke all on function public._exigir_anexos_requisicion(uuid) from public;
revoke all on function public.agregar_anexo_requisicion(uuid, jsonb) from public;
revoke all on function public.eliminar_anexo_requisicion(uuid) from public;
grant execute on function public.agregar_anexo_requisicion(uuid, jsonb) to authenticated;
grant execute on function public.eliminar_anexo_requisicion(uuid) to authenticated;

commit;
