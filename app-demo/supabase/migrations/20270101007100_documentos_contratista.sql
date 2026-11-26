-- Documentos del contratista: reemplazar, agregar y quitar desde el detalle
-- (decisiones del usuario, 2026-11-26).
--
-- 1. Cada documento se guarda solo (guardar_documento_contratista), sin el
--    formulario completo del contratista: un dato de contacto que falte en el
--    tercero (lo corrige Financiera, 20270101006100) ya no frena un documento.
-- 2. Se pueden quitar solo los opcionales (hoja de vida,
--    quitar_documento_contratista). Los obligatorios solo se reemplazan.
-- 3. La certificación bancaria vive SOLO en la cuenta del tercero (Terceros,
--    la verifica Financiera): crear_contratista ya no la pide y ni crear ni
--    editar la aceptan. Las que ya tiene el contratista se conservan como
--    historia. certificaciones_contratista da las de sus cuentas a quien tiene
--    ver_datos_bancarios (la app firma el enlace con la service role).
-- 4. Reemplazar con un archivo del mismo tipo SOBRESCRIBE el archivo en su misma
--    ruta (así la copia de Google Drive, 20270101006800, se actualiza en vez de
--    crear otra): política contratistas_archivos_update. Con otro tipo de archivo
--    (PDF -> JPG) va a una ruta nueva y el viejo se borra del bucket.
--
-- Historial: lo escribe el disparador de siempre (documento subido /
-- reemplazado / quitado, trg_historial_contratista_documento).

begin;
set local lock_timeout = '10s';

-- 1. crear_contratista y editar_contratista sin certificación bancaria --------------
do $$
declare
  v text;
  n int;
begin
  v := pg_get_functiondef('public.crear_contratista(uuid,jsonb,jsonb)'::regprocedure);
  n := (select count(*) from regexp_matches(v, '''certificacion_bancaria'',\s*', 'g'));
  if n <> 2 then
    raise exception 'crear_contratista cambió: se esperaban 2 menciones de la certificación y hay %.', n;
  end if;
  execute regexp_replace(v, '''certificacion_bancaria'',\s*', '', 'g');

  v := pg_get_functiondef('public.editar_contratista(uuid,jsonb,jsonb)'::regprocedure);
  n := (select count(*) from regexp_matches(v,
         'if not v_bancarios then\s*v_permitidos := array_remove\(v_permitidos, ''certificacion_bancaria''\);\s*end if;', 'g'));
  if n <> 1 then
    raise exception 'editar_contratista cambió: no se encontró el bloque de la certificación.';
  end if;
  execute regexp_replace(v,
    'if not v_bancarios then\s*v_permitidos := array_remove\(v_permitidos, ''certificacion_bancaria''\);\s*end if;',
    'v_permitidos := array_remove(v_permitidos, ''certificacion_bancaria'');');
end;
$$;

-- 2. Documentos que aplican por tipo de persona (sin la certificación) ----------------
create or replace function public._documentos_contratista(p_tipo_persona text, p_solo_opcionales boolean default false)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case
    when p_solo_opcionales then case when p_tipo_persona = 'natural' then array['hoja_vida'] else array[]::text[] end
    when p_tipo_persona = 'natural' then array['cedula', 'rut', 'autorizacion_datos', 'hoja_vida']
    else array['camara_comercio', 'rut', 'cedula_representante', 'autorizacion_datos', 'consulta_oficial_cumplimiento']
  end
$$;

-- 3. Guardar (reemplazar o agregar) UN documento ---------------------------------------
-- El navegador ya subió el archivo a contratistas/<id>/...; devuelve la ruta del
-- archivo anterior si quedó en otra ruta (la app lo borra del bucket), o null.
create or replace function public.guardar_documento_contratista(p_id uuid, p_documento jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo_persona text;
  v_tipo text := p_documento ->> 'tipo';
  v_ruta text := p_documento ->> 'ruta';
  v_nombre text := nullif(trim(p_documento ->> 'nombre_archivo'), '');
  v_mime text := p_documento ->> 'mime';
  v_tamano bigint;
  v_vieja text;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_contratistas') then
    raise exception 'No tienes permiso para cambiar los documentos de los contratistas.';
  end if;
  select tipo_persona into v_tipo_persona from public.contratistas where id = p_id for update;
  if not found then
    raise exception 'El contratista no existe.';
  end if;
  if v_tipo = 'certificacion_bancaria' then
    raise exception 'La certificación bancaria va con la cuenta del tercero: la cambia Financiera en Terceros.';
  end if;
  if v_tipo is null or not (v_tipo = any (public._documentos_contratista(v_tipo_persona))) then
    raise exception 'El documento "%" no aplica para este tipo de persona.', coalesce(v_tipo, '');
  end if;
  if v_ruta is null or left(v_ruta, 37) is distinct from p_id::text || '/' or position('..' in v_ruta) > 0 then
    raise exception 'La ruta del documento no corresponde a este contratista.';
  end if;
  if v_nombre is null then
    raise exception 'Falta el nombre del archivo.';
  end if;
  if v_mime is null or v_mime not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Solo PDF, JPG o PNG.';
  end if;
  begin
    v_tamano := (p_documento ->> 'tamano')::bigint;
  exception when others then
    v_tamano := null;
  end;
  if v_tamano is null or v_tamano <= 0 or v_tamano > 10 * 1024 * 1024 then
    raise exception 'El archivo debe pesar hasta 10 MB.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'contratistas' and o.name = v_ruta) then
    raise exception 'No se encontró el archivo. Vuelve a adjuntarlo.';
  end if;

  -- Borrar y crear en la misma transacción: el historial lo junta en "reemplazado".
  delete from public.contratista_documentos
   where contratista_id = p_id and tipo = v_tipo
  returning ruta into v_vieja;
  insert into public.contratista_documentos (contratista_id, tipo, ruta, nombre_archivo, tamano, mime)
  values (p_id, v_tipo, v_ruta, v_nombre, v_tamano, v_mime);

  update public.contratistas set updated_at = now(), updated_by = auth.uid() where id = p_id;

  return case when v_vieja is distinct from v_ruta then v_vieja end;
end;
$$;

-- 4. Quitar un documento opcional ------------------------------------------------------
-- Devuelve la ruta del archivo (la app lo borra del bucket; la copia de Drive queda).
create or replace function public.quitar_documento_contratista(p_id uuid, p_tipo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo_persona text;
  v_ruta text;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_contratistas') then
    raise exception 'No tienes permiso para cambiar los documentos de los contratistas.';
  end if;
  select tipo_persona into v_tipo_persona from public.contratistas where id = p_id for update;
  if not found then
    raise exception 'El contratista no existe.';
  end if;
  if not (p_tipo = any (public._documentos_contratista(v_tipo_persona, true))) then
    raise exception 'Ese documento es obligatorio: se puede reemplazar, pero no quitar.';
  end if;
  delete from public.contratista_documentos
   where contratista_id = p_id and tipo = p_tipo
  returning ruta into v_ruta;
  if v_ruta is null then
    raise exception 'El contratista no tiene ese documento.';
  end if;
  update public.contratistas set updated_at = now(), updated_by = auth.uid() where id = p_id;
  return v_ruta;
end;
$$;

-- 5. Certificaciones bancarias de las cuentas del tercero del contratista ---------------
-- Solo con ver_datos_bancarios y alguna pestaña que ve contratistas (igual que
-- contratistas_select). Cuentas no inactivas que tengan certificación.
create or replace function public.certificaciones_contratista(p_id uuid)
returns table (cuenta_id uuid, banco text, tipo_cuenta text, numero_final text, estado text,
               ruta text, nombre text, mime text, subida_en timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.tiene_accion(v_uid, 'ver_datos_bancarios') then
    raise exception 'No tienes permiso para ver la certificación bancaria.';
  end if;
  if not (public.tiene_pestana(v_uid, 'contratos.contratistas')
          or public.tiene_pestana(v_uid, 'contratos.preaprobacion')
          or public.tiene_pestana(v_uid, 'contratos.aprobar_minutas')
          or public.tiene_accion(v_uid, 'solicitar_contratos')
          or public.tiene_accion(v_uid, 'gestionar_contratistas')) then
    raise exception 'No tienes permiso para ver los contratistas.';
  end if;
  return query
    select c.id, b.nombre, c.tipo_cuenta, right(c.numero_cuenta, 4), c.estado,
           c.certificacion_ruta, c.certificacion_nombre, c.certificacion_mime, c.certificacion_subida_en
      from public.contratistas k
      join public.terceros_cuentas c on c.tercero_id = k.tercero_id
      left join public.bancos b on b.id = c.banco_id
     where k.id = p_id
       and c.certificacion_ruta is not null
       and coalesce(c.estado, '') <> 'INACTIVO'
     order by c.creado_en;
end;
$$;

revoke all on function public._documentos_contratista(text, boolean) from public, anon, authenticated;
revoke all on function public.guardar_documento_contratista(uuid, jsonb) from public, anon;
revoke all on function public.quitar_documento_contratista(uuid, text) from public, anon;
revoke all on function public.certificaciones_contratista(uuid) from public, anon;
grant execute on function public.guardar_documento_contratista(uuid, jsonb) to authenticated;
grant execute on function public.quitar_documento_contratista(uuid, text) to authenticated;
grant execute on function public.certificaciones_contratista(uuid) to authenticated;

-- 6. Sobrescribir un documento en su misma ruta (upsert del navegador) ----------------
-- Sin leer otras tablas (memoria de la base, 20270101006300). La certificación
-- bancaria del contratista ya no se toca.
drop policy if exists contratistas_archivos_update on storage.objects;
create policy contratistas_archivos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'contratistas'
    and (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    and storage.filename(name) not like 'certificacion_bancaria%'
  )
  with check (
    bucket_id = 'contratistas'
    and (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    and storage.filename(name) not like 'certificacion_bancaria%'
  );

commit;
