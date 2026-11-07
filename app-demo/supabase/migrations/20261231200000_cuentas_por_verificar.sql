-- Cuentas por verificar en una tabla (decisión del usuario, 2026-11-06):
-- Financiera revisa todas las cuentas PENDIENTES de una vez, ve la
-- certificación bancaria al lado y verifica sin abrir tercero por tercero.
-- * Cada cuenta puede tener SU certificación bancaria (antes solo existía la
--   del contratista; las cuentas de proveedores no tenían ninguna). Bucket
--   privado `terceros`, ruta `<cuenta_id>/<marca>.<ext>`; la suben y la ven
--   quienes editan o verifican terceros.
-- * `cuentas_por_verificar()`: la lista (con la certificación de la cuenta o,
--   si no tiene, la del contratista del tercero, y cuántos pagos la esperan).
-- * `guardar_certificacion_cuenta`: registra el archivo ya subido.
-- * `url_certificacion_cuenta`: dónde está el archivo, para un enlace firmado.
-- * Al CREAR un tercero (lo puede cualquiera) se puede adjuntar la
--   certificación de su cuenta: el navegador la sube primero a
--   `nuevo/<su usuario>/...` y `crear_tercero` la valida y la pega a la cuenta.
-- Se puede correr dos veces. Va después de 20261231100000.

alter table public.terceros_cuentas
  add column if not exists certificacion_ruta text,
  add column if not exists certificacion_nombre text,
  add column if not exists certificacion_mime text,
  add column if not exists certificacion_subida_en timestamptz,
  add column if not exists certificacion_subida_por uuid references public.perfiles(id);

create index if not exists terceros_cuentas_pendientes on public.terceros_cuentas (creado_en) where estado = 'PENDIENTE';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('terceros', 'terceros', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists terceros_archivos_select on storage.objects;
create policy terceros_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'terceros'
         and ((select public.tiene_accion((select auth.uid()), 'verificar_terceros'))
              or (select public.tiene_accion((select auth.uid()), 'editar_terceros'))));
-- Insertar: quien edita o verifica (en cualquier carpeta), o cualquiera con
-- sesión en SU carpeta `nuevo/<uid>/` (certificación al crear un tercero).
drop policy if exists terceros_archivos_insert on storage.objects;
create policy terceros_archivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'terceros'
              and ((select public.tiene_accion((select auth.uid()), 'verificar_terceros'))
                   or (select public.tiene_accion((select auth.uid()), 'editar_terceros'))
                   or ((storage.foldername(name))[1] = 'nuevo'
                       and (storage.foldername(name))[2] = (select auth.uid())::text)));
-- Borrar solo lo que todavía no es la certificación de ninguna cuenta (si el
-- registro falla, el navegador limpia lo que subió).
drop policy if exists terceros_archivos_delete on storage.objects;
create policy terceros_archivos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'terceros'
         and ((select public.tiene_accion((select auth.uid()), 'verificar_terceros'))
              or (select public.tiene_accion((select auth.uid()), 'editar_terceros'))
              or ((storage.foldername(name))[1] = 'nuevo'
                  and (storage.foldername(name))[2] = (select auth.uid())::text))
         and not exists (select 1 from public.terceros_cuentas c where c.certificacion_ruta = name));

create or replace function public._puede_revisar_cuentas(p_uid uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select public.tiene_accion(p_uid, 'verificar_terceros') or public.tiene_accion(p_uid, 'editar_terceros') $$;
revoke all on function public._puede_revisar_cuentas(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ la lista
create or replace function public.cuentas_por_verificar()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._puede_revisar_cuentas(auth.uid()) then
    raise exception 'No tienes permiso para revisar cuentas de terceros.';
  end if;
  return coalesce((
    select jsonb_agg(f order by (f->>'pagos')::int desc, f->>'creado_en')
      from (
        select jsonb_build_object(
                 'cuenta_id', c.id, 'tercero_id', t.id,
                 'razon_social', t.razon_social, 'tipo_documento', t.tipo_documento,
                 'numero_documento', t.numero_documento, 'dv', t.dv,
                 'banco', b.nombre, 'tipo_cuenta', c.tipo_cuenta, 'numero_cuenta', c.numero_cuenta,
                 'etiqueta', c.etiqueta, 'observaciones', c.observaciones,
                 'creado_en', c.creado_en, 'creado_por', p.nombre,
                 'certificacion', case
                   when c.certificacion_ruta is not null then jsonb_build_object(
                     'origen', 'cuenta', 'nombre', c.certificacion_nombre, 'mime', c.certificacion_mime)
                   else (select jsonb_build_object('origen', 'contratista', 'nombre', d.nombre_archivo, 'mime', d.mime)
                           from public.contratistas k
                           join public.contratista_documentos d on d.contratista_id = k.id and d.tipo = 'certificacion_bancaria'
                          where k.tercero_id = t.id
                          order by d.subido_at desc limit 1)
                 end,
                 'pagos', (select count(*) from public.pagos g
                            where g.cuenta_tercero_id = c.id
                              and g.estado in ('programado', 'solicitado', 'en_espera', 'aprobado'))
               ) as f
          from public.terceros_cuentas c
          join public.terceros t on t.id = c.tercero_id
          left join public.bancos b on b.id = c.banco_id
          left join public.perfiles p on p.id = c.creado_por
         where c.estado = 'PENDIENTE'
      ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.cuentas_por_verificar() from public, anon;
grant execute on function public.cuentas_por_verificar() to authenticated;

-- ------------------------------------------- registrar la certificación subida
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
revoke all on function public.guardar_certificacion_cuenta(uuid, text, text, text) from public, anon;
grant execute on function public.guardar_certificacion_cuenta(uuid, text, text, text) to authenticated;

-- ------------------------------------- dónde está la certificación (para verla)
create or replace function public.url_certificacion_cuenta(p_cuenta_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v record;
begin
  if not public._puede_revisar_cuentas(auth.uid()) then
    raise exception 'No tienes permiso para ver la certificación bancaria.';
  end if;
  select c.certificacion_ruta, c.certificacion_nombre, c.certificacion_mime, c.tercero_id into v
    from public.terceros_cuentas c where c.id = p_cuenta_id;
  if not found then
    raise exception 'La cuenta no existe.';
  end if;
  if v.certificacion_ruta is not null then
    return jsonb_build_object('bucket', 'terceros', 'ruta', v.certificacion_ruta,
                              'nombre', v.certificacion_nombre, 'mime', v.certificacion_mime);
  end if;
  -- La del contratista solo la ve quien verifica (política del bucket contratistas).
  if not public.tiene_accion(auth.uid(), 'verificar_terceros') then
    return null;
  end if;
  return (select jsonb_build_object('bucket', 'contratistas', 'ruta', d.ruta, 'nombre', d.nombre_archivo, 'mime', d.mime)
            from public.contratistas k
            join public.contratista_documentos d on d.contratista_id = k.id and d.tipo = 'certificacion_bancaria'
           where k.tercero_id = v.tercero_id
           order by d.subido_at desc limit 1);
end;
$$;
revoke all on function public.url_certificacion_cuenta(uuid) from public, anon;
grant execute on function public.url_certificacion_cuenta(uuid) to authenticated;

-- Mis pendientes: "Verificar" abre la tabla de cuentas por verificar.
do $$
declare
  d text := pg_get_functiondef('public._pendientes_de(uuid)'::regprocedure);
  a text := 'null, c.creado_en, c.creado_por, null::date, ''/ayf/terceros''';
  b text := 'null, c.creado_en, c.creado_por, null::date, ''/ayf/terceros?vista=verificar''';
begin
  if position(b in d) > 0 then
    return;
  end if;
  if position(a in d) = 0 then
    raise exception '_pendientes_de no tiene el texto esperado.';
  end if;
  execute replace(d, a, b);
end $$;

-- ------------------------------------- certificación al crear el tercero
-- La llama crear_tercero con p_cuenta.certificacion = {ruta, nombre, mime}.
create or replace function public._certificacion_tercero_nuevo(p_tercero_id uuid, p_cert jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ruta text := p_cert ->> 'ruta';
  v_mime text := p_cert ->> 'mime';
begin
  if v_ruta is null or v_ruta not like 'nuevo/' || auth.uid()::text || '/%' then
    raise exception 'La certificación bancaria no se subió bien: vuelve a adjuntarla.';
  end if;
  if coalesce(v_mime, '') not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'La certificación debe ser PDF, JPG o PNG.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'terceros' and o.name = v_ruta) then
    raise exception 'No se encontró la certificación subida: vuelve a adjuntarla.';
  end if;
  update public.terceros_cuentas
     set certificacion_ruta = v_ruta,
         certificacion_nombre = left(coalesce(nullif(trim(p_cert ->> 'nombre'), ''), 'certificacion'), 200),
         certificacion_mime = v_mime, certificacion_subida_en = now(), certificacion_subida_por = auth.uid()
   where tercero_id = p_tercero_id;
end;
$$;
revoke all on function public._certificacion_tercero_nuevo(uuid, jsonb) from public, anon, authenticated;

do $$
declare
  d text := pg_get_functiondef('public.crear_tercero(jsonb, jsonb)'::regprocedure);
  a text := 'nullif(btrim(coalesce(p_cuenta ->> ''observaciones'', '''')), ''''));';
begin
  if position('_certificacion_tercero_nuevo' in d) > 0 then
    return;
  end if;
  if position(a in d) = 0 then
    raise exception 'crear_tercero no tiene el texto esperado.';
  end if;
  execute replace(d, a, a || E'
    if p_cuenta ? ''certificacion'' and jsonb_typeof(p_cuenta -> ''certificacion'') = ''object'' then
      perform public._certificacion_tercero_nuevo(v_id, p_cuenta -> ''certificacion'');
    end if;');
end $$;
