-- Copia del contrato y del otrosí firmada por el contratista (decisión del
-- usuario, 2026-11-12).
--
-- * Contratos por grupos y generales tienen una columna para adjuntarla, y el
--   detalle del contrato la deja descargar al lado del encabezado.
-- * Mismos permisos que pólizas: la sube quien tiene la pestaña Pólizas y ve el
--   proyecto (subir_contrato_firmado / subir_otrosi_firmado). Se puede cambiar
--   (devuelven la ruta anterior para que la app la borre).
-- * Contrato aprobado (solicitud y minuta) sin la copia firmada: no se pueden
--   hacer actas (_guardar_acta). El otrosí no bloquea nada.
-- * Mis pendientes: "Subir contrato firmado" y "Subir otrosí firmado" para
--   quien pidió el contrato / el otrosí.
-- * Archivos en el bucket contratos, carpeta <contrato_id>/firmado/.
--
-- Va antes del código (las pantallas leen las columnas nuevas). Parches por
-- texto exacto sobre _guardar_acta y _pendientes_de (fallan si no encuentran el
-- texto; no hacen nada si ya están). Se puede correr más de una vez.

begin;

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_b in d) > 0 then
    return;
  end if;
  if position(p_a in d) = 0 then
    raise exception '% no tiene el texto esperado: %', p_fn, left(p_a, 120);
  end if;
  execute replace(d, p_a, p_b);
end;
$$;

-- Columnas --------------------------------------------------------------------
alter table public.contratos add column if not exists firmado_ruta text;
alter table public.contratos add column if not exists firmado_nombre text;
alter table public.contratos add column if not exists firmado_mime text;
alter table public.contratos add column if not exists firmado_subido_at timestamptz;
alter table public.contratos add column if not exists firmado_subido_por uuid references public.perfiles(id);

alter table public.otrosis add column if not exists firmado_ruta text;
alter table public.otrosis add column if not exists firmado_nombre text;
alter table public.otrosis add column if not exists firmado_mime text;
alter table public.otrosis add column if not exists firmado_subido_at timestamptz;
alter table public.otrosis add column if not exists firmado_subido_por uuid references public.perfiles(id);

-- contratos tiene permisos por columna: las nuevas se leen igual que las demás.
grant select (firmado_ruta, firmado_nombre, firmado_mime, firmado_subido_at, firmado_subido_por)
  on public.contratos to authenticated;

-- Archivos ---------------------------------------------------------------------
-- ¿La ruta ya es la copia firmada de algún contrato u otrosí? (SECURITY DEFINER:
-- la política de borrado la usa y quien sube puede no leer contratos).
create or replace function public._ruta_firmado_registrada(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from contratos where firmado_ruta = p_ruta)
      or exists (select 1 from otrosis where firmado_ruta = p_ruta)
$$;
-- Se usa dentro de una política: necesita EXECUTE para authenticated.
revoke all on function public._ruta_firmado_registrada(text) from public, anon;
grant execute on function public._ruta_firmado_registrada(text) to authenticated;

-- ¿Puede ver la copia firmada de ese contrato? (pestañas de contratos o de
-- pólizas, y el proyecto).
create or replace function public._puede_ver_firmado(p_contrato text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from contratos c
     where c.id::text = p_contrato
       and (public._puede_ver_otrosis(auth.uid()))
       and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id))
$$;
revoke all on function public._puede_ver_firmado(text) from public, anon;
grant execute on function public._puede_ver_firmado(text) to authenticated;

drop policy if exists contratos_firmado_insert on storage.objects;
create policy contratos_firmado_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'contratos' and (storage.foldername(name))[2] = 'firmado'
              and (select public.tiene_pestana((select auth.uid()), 'contratos.polizas'))
              and public._puede_ver_firmado((storage.foldername(name))[1]));

drop policy if exists contratos_firmado_select on storage.objects;
create policy contratos_firmado_select on storage.objects for select to authenticated
  using (bucket_id = 'contratos' and (storage.foldername(name))[2] = 'firmado'
         and public._puede_ver_firmado((storage.foldername(name))[1]));

drop policy if exists contratos_firmado_delete on storage.objects;
create policy contratos_firmado_delete on storage.objects for delete to authenticated
  using (bucket_id = 'contratos' and (storage.foldername(name))[2] = 'firmado'
         and (select public.tiene_pestana((select auth.uid()), 'contratos.polizas'))
         and public._puede_ver_firmado((storage.foldername(name))[1])
         and not public._ruta_firmado_registrada(name));

-- Validación común del archivo.
create or replace function public._validar_archivo_firmado(p_contrato_id uuid, p_ruta text, p_nombre text, p_mime text, p_tamano bigint)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_ruta is null or split_part(p_ruta, '/', 1) <> p_contrato_id::text or split_part(p_ruta, '/', 2) <> 'firmado' then
    raise exception 'El archivo no es de este contrato.';
  end if;
  if p_mime is null or p_mime not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'La copia firmada tiene que ser PDF, JPG o PNG.';
  end if;
  if p_tamano is null or p_tamano <= 0 or p_tamano > 10485760 then
    raise exception 'El archivo no puede pasar de 10 MB.';
  end if;
  if nullif(trim(coalesce(p_nombre, '')), '') is null or length(p_nombre) > 300 then
    raise exception 'El nombre del archivo no es válido.';
  end if;
  if not exists (select 1 from storage.objects s where s.bucket_id = 'contratos' and s.name = p_ruta) then
    raise exception 'No se encontró el archivo subido. Vuelve a adjuntarlo.';
  end if;
end;
$$;
revoke all on function public._validar_archivo_firmado(uuid, text, text, text, bigint) from public, anon, authenticated;

-- Subir o cambiar la copia firmada del contrato. Devuelve la ruta anterior.
create or replace function public.subir_contrato_firmado(
  p_contrato_id uuid, p_ruta text, p_nombre text, p_mime text, p_tamano bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c record;
begin
  if not public.tiene_pestana(v_uid, 'contratos.polizas') then
    raise exception 'No tienes permiso para subir el contrato firmado.';
  end if;
  select id, proyecto_id, estado, minuta_estado, firmado_ruta into c
    from contratos where id = p_contrato_id for update;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, c.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if c.estado <> 'aprobada' or c.minuta_estado is distinct from 'aprobada' then
    raise exception 'El contrato todavía no está aprobado: no tiene versión para firmar.';
  end if;
  perform public._validar_archivo_firmado(p_contrato_id, p_ruta, p_nombre, p_mime, p_tamano);

  update contratos
     set firmado_ruta = p_ruta, firmado_nombre = trim(p_nombre), firmado_mime = p_mime,
         firmado_subido_at = now(), firmado_subido_por = v_uid
   where id = p_contrato_id;
  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('contrato', p_contrato_id, 'firmado_contratista', v_uid,
          jsonb_build_object('archivo', trim(p_nombre), 'reemplazo', c.firmado_ruta is not null));
  return c.firmado_ruta;
end;
$$;
revoke all on function public.subir_contrato_firmado(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.subir_contrato_firmado(uuid, text, text, text, bigint) to authenticated;

-- Lo mismo para un otrosí aprobado (va en la carpeta de su contrato).
create or replace function public.subir_otrosi_firmado(
  p_otrosi_id uuid, p_ruta text, p_nombre text, p_mime text, p_tamano bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o record;
begin
  if not public.tiene_pestana(v_uid, 'contratos.polizas') then
    raise exception 'No tienes permiso para subir el otrosí firmado.';
  end if;
  select id, contrato_id, proyecto_id, estado, numero, firmado_ruta into o
    from otrosis where id = p_otrosi_id for update;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id) then
    raise exception 'El otrosí no existe o no tienes acceso.';
  end if;
  if o.estado <> 'aprobada' then
    raise exception 'El otrosí todavía no está aprobado.';
  end if;
  perform public._validar_archivo_firmado(o.contrato_id, p_ruta, p_nombre, p_mime, p_tamano);

  update otrosis
     set firmado_ruta = p_ruta, firmado_nombre = trim(p_nombre), firmado_mime = p_mime,
         firmado_subido_at = now(), firmado_subido_por = v_uid
   where id = p_otrosi_id;
  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('otrosi', p_otrosi_id, 'firmado_contratista', v_uid,
          jsonb_build_object('archivo', trim(p_nombre), 'reemplazo', o.firmado_ruta is not null));
  return o.firmado_ruta;
end;
$$;
revoke all on function public.subir_otrosi_firmado(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.subir_otrosi_firmado(uuid, text, text, text, bigint) to authenticated;

-- La copia firmada del contrato y de sus otrosí (para el detalle y las actas;
-- quien hace actas puede no leer contratos). null = sin copia.
create or replace function public.firmados_de_contrato(p_contrato_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_proyecto uuid;
begin
  select proyecto_id into v_proyecto from contratos where id = p_contrato_id;
  if v_proyecto is null or not public.usuario_puede_ver_proyecto(auth.uid(), v_proyecto) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  return jsonb_build_object(
    'contrato', (select case when c.firmado_ruta is null then null else jsonb_build_object(
                   'ruta', c.firmado_ruta, 'nombre', c.firmado_nombre, 'mime', c.firmado_mime,
                   'subido_at', c.firmado_subido_at, 'subido_por_nombre', pf.nombre) end
                   from contratos c left join perfiles pf on pf.id = c.firmado_subido_por where c.id = p_contrato_id),
    'otrosis', coalesce((select jsonb_object_agg(o.id, jsonb_build_object(
                   'ruta', o.firmado_ruta, 'nombre', o.firmado_nombre, 'mime', o.firmado_mime,
                   'subido_at', o.firmado_subido_at, 'subido_por_nombre', pf.nombre))
                   from otrosis o left join perfiles pf on pf.id = o.firmado_subido_por
                  where o.contrato_id = p_contrato_id and o.firmado_ruta is not null), '{}'::jsonb));
end;
$$;
revoke all on function public.firmados_de_contrato(uuid) from public, anon;
grant execute on function public.firmados_de_contrato(uuid) to authenticated;

-- Actas: sin la copia firmada del contrato no se hacen -------------------------
select pg_temp._parche('public._guardar_acta(uuid,uuid,jsonb)'::regprocedure,
  $a$    raise exception 'La póliza del contrato todavía no está aprobada por Jurídica: no se pueden hacer actas.';
  end if;$a$,
  $b$    raise exception 'La póliza del contrato todavía no está aprobada por Jurídica: no se pueden hacer actas.';
  end if;
  if not exists (select 1 from public.contratos where id = p_contrato_id and firmado_ruta is not null) then
    raise exception 'Falta subir el contrato firmado por el contratista: sin él no se pueden hacer actas.';
  end if;$b$);

-- Mis pendientes ---------------------------------------------------------------
select pg_temp._parche('public._pendientes_de(uuid)'::regprocedure,
  $a$  -- ------------------------------------------------ Lo mío: póliza por subir$a$,
  $b$  -- ------------------------------------------------ Lo mío: copia firmada por el contratista
  -- Contrato aprobado (o un otrosí suyo) sin la copia firmada (20270101001900).
  union all
  select 'mi_contrato_por_firmar', 'hacer', c.id, c.proyecto_id,
         coalesce(c.numero_contrato, c.codigo), k.nombre,
         c.valor, coalesce(c.minuta_resuelta_at, c.created_at), null::uuid, null::date,
         '/contratos/solicitar?ver=' || c.id
    from contratos c
    join contratistas k on k.id = c.contratista_id
   where c.solicitado_por = p_uid and c.estado = 'aprobada' and c.minuta_estado = 'aprobada'
     and c.liquidado_at is null and c.firmado_ruta is null
  union all
  select 'mi_otrosi_por_firmar', 'hacer', o.id, o.proyecto_id,
         'Otrosí N° ' || o.numero || ' · ' || coalesce(c.numero_contrato, c.codigo), k.nombre,
         null::numeric, coalesce(o.aprobado_at, o.created_at), null::uuid, null::date,
         '/contratos/solicitar?ver=' || c.id
    from otrosis o
    join contratos c on c.id = o.contrato_id
    join contratistas k on k.id = c.contratista_id
   where o.solicitado_por = p_uid and o.estado = 'aprobada' and o.firmado_ruta is null
     and c.liquidado_at is null

  -- ------------------------------------------------ Lo mío: póliza por subir$b$);

commit;
