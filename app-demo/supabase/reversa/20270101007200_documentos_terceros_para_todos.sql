-- Reversa de 20270101007200_documentos_terceros_para_todos.sql: Terceros vuelve
-- a los roles que lo tenían, se quita la acción cambiar_documentos_terceros, las
-- cuentas se vuelven a leer con la pestaña, y RUT y certificación vuelven a ser
-- solo de A&F. Los archivos ya subidos se quedan.

begin;
set local lock_timeout = '10s';

delete from public.rol_permisos where permiso = 'accion.cambiar_documentos_terceros';
delete from public.rol_permisos rp using public.roles r
 where r.id = rp.rol_id and rp.permiso = 'tab.ayf.terceros'
   and r.clave not in ('director_obra', 'gerencia', 'financiera', 'contabilidad_barranquilla', 'contabilidad_bogota');

-- Mis pendientes sin el bloque del RUT.
do $$
declare
  v text;
  i int;
  j int;
begin
  v := pg_get_functiondef('public._pendientes_de(uuid)'::regprocedure);
  i := position(E'\n  -- ------------------------------------------------ RUT cambiado por revisar (20270101007200)' in v);
  if i > 0 then
    j := position(E'   where v_verificar and t.rut_por_revisar\n' in v);
    execute left(v, i - 1) || substr(v, j + length(E'   where v_verificar and t.rut_por_revisar\n'));
  end if;
end;
$$;

do $$
declare
  v text;
begin
  v := pg_get_functiondef('public.url_certificacion_cuenta(uuid)'::regprocedure);
  execute replace(v,
    'if not (public._puede_revisar_cuentas(auth.uid()) or public.tiene_accion(auth.uid(), ''cambiar_documentos_terceros'')) then',
    'if not public._puede_revisar_cuentas(auth.uid()) then');
end;
$$;

create or replace function public.guardar_certificacion_cuenta(p_cuenta_id uuid, p_ruta text, p_nombre text, p_mime text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._puede_revisar_cuentas(auth.uid()) then
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
         certificacion_mime = p_mime, certificacion_subida_en = now(), certificacion_subida_por = auth.uid()
   where id = p_cuenta_id;
  if not found then
    raise exception 'La cuenta no existe.';
  end if;
end;
$$;

create or replace function public.guardar_rut_tercero(p_tercero_id uuid, p_ruta text, p_nombre text, p_mime text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.tiene_accion(auth.uid(), 'editar_terceros')
          or public.tiene_accion(auth.uid(), 'verificar_terceros')
          or public.tiene_accion(auth.uid(), 'gestionar_pagos')) then
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
         rut_mime = p_mime, rut_subido_en = now(), rut_subido_por = auth.uid()
   where id = p_tercero_id;
  if not found then
    raise exception 'El tercero no existe.';
  end if;
end;
$$;

drop function if exists public.marcar_rut_revisado(uuid);
drop function if exists public.cuentas_terceros_enmascaradas(uuid[]);
alter table public.terceros drop column if exists rut_por_revisar;

drop policy if exists terceros_cuentas_select on public.terceros_cuentas;
create policy terceros_cuentas_select on public.terceros_cuentas
  for select to authenticated
  using ((select public.tiene_pestana((select auth.uid()), 'ayf.terceros')
              or public.tiene_pestana((select auth.uid()), 'ayf.aprobacion_pagos')
              or public._ve_algun_consolidado((select auth.uid()))));

drop policy if exists terceros_archivos_select on storage.objects;
create policy terceros_archivos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'terceros'
         and ((select public.tiene_accion((select auth.uid()), 'verificar_terceros'))
              or (select public.tiene_accion((select auth.uid()), 'editar_terceros'))));

drop policy if exists terceros_archivos_insert on storage.objects;
create policy terceros_archivos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'terceros'
              and ((select public.tiene_accion((select auth.uid()), 'verificar_terceros'))
                   or (select public.tiene_accion((select auth.uid()), 'editar_terceros'))
                   or ((storage.foldername(name))[1] = 'nuevo'
                       and (storage.foldername(name))[2] = ((select auth.uid()))::text)));

drop policy if exists terceros_rut_insert on storage.objects;
create policy terceros_rut_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'terceros'
              and (storage.foldername(name))[1] = 'rut'
              and (select public.tiene_accion((select auth.uid()), 'gestionar_pagos')));

commit;
