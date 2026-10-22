-- Restaura los buckets de Storage de Contratos y sus políticas (2026-10-08).
--
-- Al borrar los archivos de prueba del proyecto ZZ se borraron los buckets
-- completos "contratistas" y "contratos", y con ellos las 6 políticas de
-- storage.objects. Sin esto no se puede crear un contratista ni mandar una
-- solicitud de contrato ("Bucket not found").
--
-- Mismo contenido que las migraciones 20261011000000, 20261012000000,
-- 20261012100000, 20261012200000 y 20261014000000 (versión final, igual al
-- volcado supabase/esquema/04_seguridad.sql). Se puede correr más de una vez.

-- ---------------------------------------------------------------- Buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratistas', 'contratistas', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos', 'contratos', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------- Políticas: contratistas
drop policy if exists contratistas_archivos_select on storage.objects;
create policy contratistas_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratistas'
    and (
      (select public.tiene_pestana((select auth.uid()), 'contratos.contratistas'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    )
  );

drop policy if exists contratistas_archivos_insert on storage.objects;
create policy contratistas_archivos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contratistas'
    and (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
  );

-- Solo se pueden borrar archivos que todavía no son documento de nadie
-- (limpieza cuando falla la creación).
drop policy if exists contratistas_archivos_delete on storage.objects;
create policy contratistas_archivos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'contratistas'
    and (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    and not exists (select 1 from public.contratista_documentos d where d.ruta = storage.objects.name)
  );

-- ---------------------------------------------------- Políticas: contratos
-- Ver: la subconsulta sobre contratos ya aplica su política (puede_ver_contrato).
drop policy if exists contratos_archivos_select on storage.objects;
create policy contratos_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratos'
    and exists (select 1 from public.contratos c where c.id::text = (storage.foldername(storage.objects.name))[1])
  );

drop policy if exists contratos_archivos_insert on storage.objects;
create policy contratos_archivos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contratos'
    and (select public.tiene_accion((select auth.uid()), 'solicitar_contratos'))
  );

drop policy if exists contratos_archivos_delete on storage.objects;
create policy contratos_archivos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'contratos'
    and (select public.tiene_accion((select auth.uid()), 'solicitar_contratos'))
    and not exists (select 1 from public.contrato_documentos d where d.ruta = storage.objects.name)
  );

-- ------------------------------------------------------------ Verificación
-- Debe dar 2 buckets y 6 políticas.
select
  (select count(*) from storage.buckets where id in ('contratistas', 'contratos')) as buckets,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'contrat%_archivos_%') as politicas;
