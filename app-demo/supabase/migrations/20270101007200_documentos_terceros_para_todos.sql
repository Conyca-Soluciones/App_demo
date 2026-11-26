-- Terceros para todos y cambiar RUT / certificación bancaria (decisiones del
-- usuario, 2026-11-26).
--
-- 1. La pestaña Terceros (ayf.terceros) se da a todos los roles. Quien no es de
--    A&F (editar o verificar terceros) ve las cuentas con el número ENMASCARADO:
--    terceros_cuentas ya no se lee con solo la pestaña, sino con
--    cuentas_terceros_enmascaradas (SECURITY DEFINER).
-- 2. Acción nueva "cambiar_documentos_terceros" (Cambiar RUT y certificación
--    bancaria), para Compras, Líder Compras, Área Técnica, Líder Técnico, Director
--    de obra y Financiera: ver y cambiar la certificación de cada cuenta y el RUT.
-- 3. Cambiar la certificación de una cuenta ACTIVA la deja PENDIENTE para que
--    Financiera la vuelva a verificar (sale en Cuentas por verificar), salvo que
--    la cambie quien verifica. En un contratista, Jurídica ve esa misma
--    certificación (certificaciones_contratista, 20270101007100).
-- 4. Cambiar el RUT (sin ser de A&F) lo marca "por revisar" (terceros.rut_por_revisar):
--    le sale a Financiera en Mis pendientes (rut_por_revisar) y lo cierra con
--    marcar_rut_revisado. No bloquea las cuentas.
-- El archivo anterior se queda en el bucket (como el RUT de siempre): no se borra.
-- El historial lo escribe terceros_auditoria (disparador de siempre).

begin;
set local lock_timeout = '10s';

-- 1. Permisos de los roles -------------------------------------------------------------
insert into public.rol_permisos (rol_id, permiso)
select r.id, 'tab.ayf.terceros' from public.roles r
 where r.clave <> 'administrador'
on conflict do nothing;

insert into public.rol_permisos (rol_id, permiso)
select r.id, 'accion.cambiar_documentos_terceros' from public.roles r
 where r.clave in ('compras', 'lider_compras', 'area_tecnica', 'lider_tecnico', 'director_obra', 'financiera')
on conflict do nothing;

-- 2. RUT por revisar ---------------------------------------------------------------------
alter table public.terceros add column if not exists rut_por_revisar boolean not null default false;

create or replace function public.guardar_rut_tercero(p_tercero_id uuid, p_ruta text, p_nombre text, p_mime text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ayf boolean := public._puede_revisar_cuentas(v_uid);
begin
  if not (v_ayf
          or public.tiene_accion(v_uid, 'gestionar_pagos')
          or public.tiene_accion(v_uid, 'cambiar_documentos_terceros')) then
    raise exception 'No tienes permiso para subir el RUT.';
  end if;
  if p_ruta is null or p_ruta not like 'rut/' || p_tercero_id::text || '/%' then
    raise exception 'La ruta del archivo no es de este tercero.';
  end if;
  if coalesce(p_mime, '') not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'El RUT debe ser PDF, JPG o PNG.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'terceros' and o.name = p_ruta) then
    raise exception 'No se encontró el archivo subido.';
  end if;
  update public.terceros
     set rut_ruta = p_ruta, rut_nombre = left(coalesce(nullif(trim(p_nombre), ''), 'rut'), 200),
         rut_mime = p_mime, rut_subido_en = now(), rut_subido_por = v_uid,
         -- Lo revisa Financiera si no lo subió A&F (editar o verificar terceros).
         rut_por_revisar = not v_ayf
   where id = p_tercero_id;
  if not found then
    raise exception 'El tercero no existe.';
  end if;
end;
$$;

create or replace function public.marcar_rut_revisado(p_tercero_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._puede_revisar_cuentas(auth.uid()) then
    raise exception 'Solo Financiera (editar o verificar terceros) marca el RUT como revisado.';
  end if;
  update public.terceros set rut_por_revisar = false where id = p_tercero_id and rut_por_revisar;
end;
$$;

-- 3. Certificación de la cuenta ---------------------------------------------------------
create or replace function public.guardar_certificacion_cuenta(p_cuenta_id uuid, p_ruta text, p_nombre text, p_mime text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_verifica boolean := public.tiene_accion(v_uid, 'verificar_terceros');
begin
  if not (public._puede_revisar_cuentas(v_uid) or public.tiene_accion(v_uid, 'cambiar_documentos_terceros')) then
    raise exception 'No tienes permiso para subir la certificación bancaria.';
  end if;
  if p_ruta is null or p_ruta not like p_cuenta_id::text || '/%' then
    raise exception 'La ruta del archivo no es de esta cuenta.';
  end if;
  if coalesce(p_mime, '') not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'La certificación debe ser PDF, JPG o PNG.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'terceros' and o.name = p_ruta) then
    raise exception 'No se encontró el archivo subido.';
  end if;
  update public.terceros_cuentas
     set certificacion_ruta = p_ruta, certificacion_nombre = left(coalesce(nullif(trim(p_nombre), ''), 'certificacion'), 200),
         certificacion_mime = p_mime, certificacion_subida_en = now(), certificacion_subida_por = v_uid,
         -- Una certificación nueva se vuelve a verificar (salvo que la suba quien verifica).
         estado = case when estado = 'ACTIVO' and not v_verifica then 'PENDIENTE' else estado end
   where id = p_cuenta_id;
  if not found then
    raise exception 'La cuenta no existe.';
  end if;
end;
$$;

do $$
declare
  v text;
begin
  v := pg_get_functiondef('public.url_certificacion_cuenta(uuid)'::regprocedure);
  if position('if not public._puede_revisar_cuentas(auth.uid()) then' in v) = 0 then
    raise exception 'url_certificacion_cuenta cambió: no se encontró el permiso.';
  end if;
  execute replace(v, 'if not public._puede_revisar_cuentas(auth.uid()) then',
    'if not (public._puede_revisar_cuentas(auth.uid()) or public.tiene_accion(auth.uid(), ''cambiar_documentos_terceros'')) then');
end;
$$;

-- 4. Cuentas: completas solo para A&F; enmascaradas para quien ve Terceros --------------
drop policy if exists terceros_cuentas_select on public.terceros_cuentas;
create policy terceros_cuentas_select on public.terceros_cuentas
  for select to authenticated
  using ((select public._puede_revisar_cuentas((select auth.uid()))
              or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
              or public._ve_algun_consolidado((select auth.uid()))));

create or replace function public.cuentas_terceros_enmascaradas(p_terceros uuid[])
returns table (id uuid, tercero_id uuid, banco_id uuid, banco text, tipo_cuenta text, numero_cuenta text,
               etiqueta text, estado text, verificada_en date, verificada_por text, observaciones text,
               certificacion_nombre text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.tiene_pestana(auth.uid(), 'ayf.terceros') or public._puede_revisar_cuentas(auth.uid())) then
    raise exception 'No tienes permiso para ver los terceros.';
  end if;
  if coalesce(array_length(p_terceros, 1), 0) > 200 then
    raise exception 'Demasiados terceros a la vez.';
  end if;
  return query
    select c.id, c.tercero_id, c.banco_id, b.nombre, c.tipo_cuenta, '•••• ' || right(c.numero_cuenta, 4),
           c.etiqueta, c.estado, c.verificada_en, c.verificada_por, c.observaciones, c.certificacion_nombre
      from public.terceros_cuentas c
      left join public.bancos b on b.id = c.banco_id
     where c.tercero_id = any (p_terceros);
end;
$$;

revoke all on function public.cuentas_terceros_enmascaradas(uuid[]) from public, anon;
revoke all on function public.marcar_rut_revisado(uuid) from public, anon;
grant execute on function public.cuentas_terceros_enmascaradas(uuid[]) to authenticated;
grant execute on function public.marcar_rut_revisado(uuid) to authenticated;
grant execute on function public.guardar_rut_tercero(uuid, text, text, text) to authenticated;
grant execute on function public.guardar_certificacion_cuenta(uuid, text, text, text) to authenticated;

-- 5. Archivos del bucket terceros: subir y ver con la acción nueva ----------------------
drop policy if exists terceros_archivos_select on storage.objects;
create policy terceros_archivos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'terceros'
         and ((select public.tiene_accion((select auth.uid()), 'verificar_terceros'))
              or (select public.tiene_accion((select auth.uid()), 'editar_terceros'))
              or (select public.tiene_accion((select auth.uid()), 'cambiar_documentos_terceros'))));

drop policy if exists terceros_archivos_insert on storage.objects;
create policy terceros_archivos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'terceros'
              and ((select public.tiene_accion((select auth.uid()), 'verificar_terceros'))
                   or (select public.tiene_accion((select auth.uid()), 'editar_terceros'))
                   or (select public.tiene_accion((select auth.uid()), 'cambiar_documentos_terceros'))
                   or ((storage.foldername(name))[1] = 'nuevo'
                       and (storage.foldername(name))[2] = ((select auth.uid()))::text)));

drop policy if exists terceros_rut_insert on storage.objects;
create policy terceros_rut_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'terceros'
              and (storage.foldername(name))[1] = 'rut'
              and ((select public.tiene_accion((select auth.uid()), 'gestionar_pagos'))
                   or (select public.tiene_accion((select auth.uid()), 'cambiar_documentos_terceros'))));

-- 6. Mis pendientes: RUT por revisar (después de las cuentas por verificar) ------------
do $$
declare
  v text;
  ancla text := E'   where v_verificar and c.estado = ''PENDIENTE''\n';
begin
  v := pg_get_functiondef('public._pendientes_de(uuid)'::regprocedure);
  if (length(v) - length(replace(v, ancla, ''))) / length(ancla) <> 1 then
    raise exception '_pendientes_de cambió: no se encontró el bloque de cuentas por verificar.';
  end if;
  execute replace(v, ancla, ancla || E'\n'
    '  -- ------------------------------------------------ RUT cambiado por revisar (20270101007200)\n'
    '  union all\n'
    '  select ''rut_por_revisar'', ''hacer'', t.id, null::uuid,\n'
    '         t.razon_social, concat_ws('' · '', t.tipo_documento || '' '' || t.numero_documento, t.rut_nombre),\n'
    '         null, t.rut_subido_en, t.rut_subido_por, null::date, ''/ayf/terceros?tercero='' || t.id\n'
    '    from terceros t\n'
    '   where v_verificar and t.rut_por_revisar\n');
end;
$$;

commit;
