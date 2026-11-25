-- Copia de los archivos de la app en Google Drive (decisiones del usuario, 2026-11-25).
--
-- Cada archivo que se sube a Storage (soportes de OC, contratos, pólizas, actas,
-- anexos de requisiciones, RUT, dispersores...) se sigue guardando en Supabase como
-- siempre y, además, se copia a una UNIDAD COMPARTIDA de Google Drive de CONYCA,
-- en carpetas por proyecto. Drive es una copia (archivo de la empresa): si falla o
-- está apagado, la app no cambia. Si un archivo se cambia o se borra en la app, lo
-- que ya está en Drive se queda (un archivo con la MISMA ruta que se sobreescribe
-- sí actualiza su copia).
--
-- 1. Disparador en storage.objects: cada archivo nuevo entra a drive_cola (una
--    fila; si algo falla, se ignora: nunca hace fallar una subida).
-- 2. _drive_destino(bucket, ruta): a qué proyecto y carpeta va, buscándolo en la
--    tabla donde la app registró el archivo. Si todavía no está registrado (el
--    navegador sube primero y registra después) se reintenta; a las 24 horas sin
--    ubicar va a Otros/<bucket>.
-- 3. La función de Supabase "subir-drive" (supabase/functions/subir-drive) toma la
--    cola (tomar_drive), crea las carpetas que falten (cache en drive_carpetas) y
--    sube; marca con marcar_drive. Hasta 5 intentos.
-- 4. pg_cron "subir-drive" cada minuto, solo si está ACTIVO y hay algo por subir.
--
-- Nace APAGADA (ajustes_drive.activo = false). Para encenderla:
--   update ajustes_drive set unidad_id = '<id de la unidad compartida>', activo = true;
--   select drive_encolar_existentes();   -- copia también los archivos que ya hay
-- Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

-- 1. Ajustes ----------------------------------------------------------------------

create table if not exists public.ajustes_drive (
  id boolean primary key default true check (id),
  activo boolean not null default false,
  unidad_id text,     -- id de la unidad compartida (la parte final de su enlace)
  url_funcion text    -- https://<proyecto>.supabase.co/functions/v1/subir-drive
);
insert into public.ajustes_drive (id, url_funcion)
values (true, 'https://xqtkhtnqombzfykyxngt.supabase.co/functions/v1/subir-drive')
on conflict (id) do nothing;
alter table public.ajustes_drive enable row level security;
revoke all on public.ajustes_drive from anon, authenticated;

-- 2. Cola y carpetas ----------------------------------------------------------------

create table if not exists public.drive_cola (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  ruta text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'subiendo', 'subido', 'error', 'omitido')),
  intentos integer not null default 0,
  siguiente_intento timestamptz not null default now(),
  tomado_en timestamptz,
  subido_en timestamptz,
  drive_file_id text,
  ultimo_error text,
  creado_en timestamptz not null default now(),
  unique (bucket, ruta)
);
create index if not exists drive_cola_por_subir on public.drive_cola (siguiente_intento)
  where estado in ('pendiente', 'error');
alter table public.drive_cola enable row level security;
revoke all on public.drive_cola from anon, authenticated;

-- Carpetas ya creadas en Drive. clave = 'proyecto:<id>' para la carpeta de un
-- proyecto y '<clave del padre>/<nombre>' para las demás ('' = raíz de la unidad).
create table if not exists public.drive_carpetas (
  clave text primary key,
  drive_id text not null,
  proyecto_id uuid unique references public.proyectos(id) on delete set null,
  creado_en timestamptz not null default now()
);
alter table public.drive_carpetas enable row level security;
revoke all on public.drive_carpetas from anon, authenticated;

-- 3. A dónde va cada archivo ---------------------------------------------------------

-- Nombre seguro para Drive y para la clave de la carpeta (sin "/" ni saltos).
create or replace function public._drive_limpio(p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(left(trim(regexp_replace(coalesce(p_texto, ''), '[/\\\r\n\t]+', '-', 'g')), 180), '');
$$;

-- {proyecto_id, proyecto_nombre, carpetas[], nombre}. Sin proyecto = desde la raíz.
create or replace function public._drive_resultado(p_proyecto uuid, p_carpetas text[], p_nombre text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'proyecto_id', p.id,
    'proyecto_nombre', case when p.id is not null then
        public._drive_limpio(coalesce(lpad(p.numero::text, 3, '0') || ' - ', '') || coalesce(p.codigo, p.nombre)) end,
    'carpetas', (select coalesce(jsonb_agg(public._drive_limpio(c) order by o), '[]'::jsonb)
                   from unnest(p_carpetas) with ordinality as t(c, o) where public._drive_limpio(c) is not null),
    'nombre', public._drive_limpio(p_nombre))
  from (select 1) uno
  left join public.proyectos p on p.id = p_proyecto;
$$;

-- Carpeta de un contrato dentro de su proyecto.
create or replace function public._drive_carpeta_contrato(p_contrato_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(c.codigo, 'Contrato ' || c.numero) from public.contratos c where c.id = p_contrato_id;
$$;

create or replace function public._drive_destino(p_bucket text, p_ruta text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_archivo text := regexp_replace(p_ruta, '^.*/', '');
  v_carpeta text := split_part(p_ruta, '/', 1);
  r record;
begin
  if p_bucket = 'contratos' then
    select c.proyecto_id, c.id as contrato_id, d.tipo, d.nombre_archivo into r
      from public.contrato_documentos d join public.contratos c on c.id = d.contrato_id where d.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Contratos', public._drive_carpeta_contrato(r.contrato_id)],
                                     r.tipo || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;
    select c.proyecto_id, c.id as contrato_id into r from public.contratos c where c.firmado_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Contratos', public._drive_carpeta_contrato(r.contrato_id)],
                                     'Contrato firmado por el contratista - ' || v_archivo);
    end if;
    select o.proyecto_id, o.contrato_id, o.numero into r from public.otrosis o where o.firmado_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id,
        array['Contratos', public._drive_carpeta_contrato(r.contrato_id), 'Otrosí N° ' || coalesce(r.numero::text, 'sin número')],
        'Otrosí firmado por el contratista - ' || v_archivo);
    end if;

  elsif p_bucket = 'polizas' then
    select coalesce(p.proyecto_id, c.proyecto_id) as proyecto_id, p.contrato_id, p.nombre_archivo into r
      from public.contrato_polizas p join public.contratos c on c.id = p.contrato_id where p.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Contratos', public._drive_carpeta_contrato(r.contrato_id), 'Pólizas'],
                                     coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'actas' then
    select c.proyecto_id, a.contrato_id, a.numero, s.tipo, s.nombre_archivo into r
      from public.acta_soportes s join public.actas a on a.id = s.acta_id join public.contratos c on c.id = a.contrato_id
     where s.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id,
        array['Contratos', public._drive_carpeta_contrato(r.contrato_id), 'Acta ' || lpad(coalesce(r.numero, 0)::text, 2, '0')],
        r.tipo || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'ordenes_compra' then
    select o.proyecto_id, o.codigo, o.numero, s.tipo, s.nombre_archivo into r
      from public.orden_compra_soportes s join public.ordenes_compra o on o.id = s.orden_compra_id where s.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Órdenes de compra', coalesce(r.codigo, 'OC ' || r.numero)],
                                     r.tipo || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;
    select o.proyecto_id, o.codigo, o.numero, f.nombre_archivo into r
      from public.orden_compra_facturas f join public.ordenes_compra o on o.id = f.orden_compra_id where f.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Órdenes de compra', coalesce(r.codigo, 'OC ' || r.numero), 'Facturas'],
                                     coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'entradas' then
    select o.proyecto_id, o.codigo, o.numero as oc_numero, e.numero, s.nombre_archivo into r
      from public.entrada_soportes s
      join public.entradas_almacen e on e.id = s.entrada_id
      join public.ordenes_compra o on o.id = e.orden_compra_id
     where s.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Órdenes de compra', coalesce(r.codigo, 'OC ' || r.oc_numero), 'Entradas'],
                                     'Entrada ' || r.numero || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'requisiciones' then
    select q.proyecto_id, q.codigo, q.numero, x.nombre_archivo into r
      from public.requisicion_anexos x join public.requisiciones q on q.id = x.requisicion_id where x.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Requisiciones', coalesce(r.codigo, 'Requisición ' || r.numero)],
                                     coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'requisiciones_admin' then
    select i.proyecto_id, i.codigo into r from public.requisicion_admin_items i where i.soporte_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['Pagos administrativos', coalesce(r.codigo, 'Sin código')], v_archivo);
    end if;

  elsif p_bucket = 'sinco' then
    select f.proyecto_id, k.numero into r
      from public.sinco_filas f join public.sinco_cuadros k on k.id = f.cuadro_id where f.soporte_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(r.proyecto_id, array['SINCO', 'Cuadro ' || r.numero], v_archivo);
    end if;

  elsif p_bucket = 'documentos_firmados' then
    -- PDF aprobado y congelado: <entidad>/<id>[-<código>].pdf
    select d.entidad, d.entidad_id into r from public.documentos_firmados d where d.ruta = p_ruta limit 1;
    if found then
      if r.entidad = 'contrato' then
        return (select public._drive_resultado(c.proyecto_id, array['Contratos', public._drive_carpeta_contrato(c.id)],
                                               'Contrato aprobado (firmado) - ' || v_archivo)
                  from public.contratos c where c.id = r.entidad_id);
      elsif r.entidad = 'otrosi' then
        return (select public._drive_resultado(o.proyecto_id,
                  array['Contratos', public._drive_carpeta_contrato(o.contrato_id), 'Otrosí N° ' || coalesce(o.numero::text, 'sin número')],
                  'Otrosí aprobado (firmado) - ' || v_archivo)
                  from public.otrosis o where o.id = r.entidad_id);
      elsif r.entidad = 'acta' then
        return (select public._drive_resultado(c.proyecto_id,
                  array['Contratos', public._drive_carpeta_contrato(c.id), 'Acta ' || lpad(coalesce(a.numero, 0)::text, 2, '0')],
                  'Acta aprobada (firmada) - ' || v_archivo)
                  from public.actas a join public.contratos c on c.id = a.contrato_id where a.id = r.entidad_id);
      elsif r.entidad = 'orden_compra' then
        return (select public._drive_resultado(o.proyecto_id, array['Órdenes de compra', coalesce(o.codigo, 'OC ' || o.numero)],
                                               'Orden de compra aprobada (firmada) - ' || v_archivo)
                  from public.ordenes_compra o where o.id = r.entidad_id);
      elsif r.entidad = 'poliza' then
        return coalesce(
          (select public._drive_resultado(c.proyecto_id, array['Contratos', public._drive_carpeta_contrato(c.id), 'Pólizas'],
                                          'Acta de aprobación de la póliza - ' || v_archivo)
             from public.contrato_polizas p join public.contratos c on c.id = p.contrato_id where p.id = r.entidad_id),
          (select public._drive_resultado(c.proyecto_id, array['Contratos', public._drive_carpeta_contrato(c.id), 'Pólizas'],
                                          'Acta de aprobación de la póliza - ' || v_archivo)
             from public.contratos c where c.id = r.entidad_id));
      end if;
      return public._drive_resultado(null, array['Documentos firmados', r.entidad], v_archivo);
    end if;

  elsif p_bucket = 'contratistas' then
    select k.numero_documento, k.nombre, d.tipo, d.nombre_archivo into r
      from public.contratista_documentos d join public.contratistas k on k.id = d.contratista_id where d.ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(null, array['Contratistas', r.numero_documento || ' - ' || r.nombre],
                                     r.tipo || ' - ' || coalesce(r.nombre_archivo, v_archivo));
    end if;

  elsif p_bucket = 'terceros' then
    select t.numero_documento, t.razon_social into r from public.terceros t where t.rut_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(null, array['Terceros', r.numero_documento || ' - ' || r.razon_social], 'RUT - ' || v_archivo);
    end if;
    select t.numero_documento, t.razon_social into r
      from public.terceros_cuentas k join public.terceros t on t.id = k.tercero_id where k.certificacion_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(null, array['Terceros', r.numero_documento || ' - ' || r.razon_social],
                                     'Certificación bancaria - ' || v_archivo);
    end if;

  elsif p_bucket = 'dispersores' then
    if v_carpeta = 'pse' then
      select p.referencia into r from public.pagos p
       where p.pago_comprobante_ruta = p_ruta or p.pago_soporte_ruta = p_ruta limit 1;
      if found then
        return public._drive_resultado(null, array['Pagos', 'PSE y otros medios'],
                                       coalesce('REF ' || r.referencia || ' - ', '') || v_archivo);
      end if;
    else
      select d.anio, d.semana into r from public.dispersiones d where d.id::text = v_carpeta limit 1;
      if found then
        return public._drive_resultado(null, array['Pagos', 'Dispersores', r.anio || ' - Semana ' || lpad(r.semana::text, 2, '0')],
                                       v_archivo);
      end if;
    end if;

  elsif p_bucket = 'balances' then
    select m.codigo into r from public.movimientos_bancarios m where m.soporte_ruta = p_ruta limit 1;
    if found then
      return public._drive_resultado(null, array['Balances'], coalesce(r.codigo || ' - ', '') || v_archivo);
    end if;
  end if;

  return null;  -- todavía no se sabe (o el bucket no se ubica): tomar_drive reintenta
end;
$$;

-- 4. Disparador: cada archivo nuevo (o sobreescrito) entra a la cola ---------------

create or replace function public._drive_encolar_objeto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.version is not distinct from old.version then
    return null;
  end if;
  if new.name like '%.emptyFolderPlaceholder' or coalesce(new.is_delete_marker, false) then
    return null;
  end if;
  begin
    insert into public.drive_cola (bucket, ruta) values (new.bucket_id, new.name)
    on conflict (bucket, ruta) do update
       set estado = 'pendiente', intentos = 0, siguiente_intento = now(), ultimo_error = null, creado_en = now()
     where public.drive_cola.estado <> 'subiendo';
  exception when others then
    null;  -- la copia a Drive nunca hace fallar una subida
  end;
  return null;
end;
$$;

drop trigger if exists trg_drive_encolar on storage.objects;
create trigger trg_drive_encolar
  after insert or update on storage.objects
  for each row execute function public._drive_encolar_objeto();

-- 5. La función de Supabase toma y marca (solo service_role) ------------------------

create or replace function public.tomar_drive(p_limite integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.drive_cola%rowtype;
  v jsonb;
  v_salida jsonb := '[]'::jsonb;
begin
  -- Lo que quedó "subiendo" más de 15 minutos (la función se cayó) vuelve a la cola.
  update public.drive_cola
     set estado = 'error', ultimo_error = coalesce(ultimo_error, 'Sin respuesta de la subida'), siguiente_intento = now()
   where estado = 'subiendo' and tomado_en < now() - interval '15 minutes';

  for r in
    select * from public.drive_cola c
     where c.estado in ('pendiente', 'error') and c.intentos < 5 and c.siguiente_intento <= now()
     order by c.creado_en
     limit least(greatest(coalesce(p_limite, 10), 1), 25)
     for update skip locked
  loop
    v := public._drive_destino(r.bucket, r.ruta);
    if v is null then
      if r.creado_en > now() - interval '24 hours' then
        update public.drive_cola set siguiente_intento = now() + interval '15 minutes' where id = r.id;
        continue;
      end if;
      v := public._drive_resultado(null, array['Otros', r.bucket], regexp_replace(r.ruta, '^.*/', ''));
    end if;
    update public.drive_cola set estado = 'subiendo', tomado_en = now(), intentos = intentos + 1 where id = r.id;
    v_salida := v_salida || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'bucket', r.bucket, 'ruta', r.ruta, 'drive_file_id', r.drive_file_id, 'destino', v));
  end loop;
  return v_salida;
end;
$$;

-- p_estado: subido | error | omitido (el archivo ya no está en Storage).
create or replace function public.marcar_drive(p_id uuid, p_estado text, p_file_id text, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.drive_cola
     set estado = case when p_estado in ('subido', 'error', 'omitido') then p_estado else 'error' end,
         drive_file_id = coalesce(p_file_id, drive_file_id),
         subido_en = case when p_estado = 'subido' then now() else subido_en end,
         ultimo_error = case when p_estado = 'subido' then null else left(p_error, 1000) end,
         siguiente_intento = case when p_estado = 'error' then now() + intentos * interval '10 minutes' else siguiente_intento end
   where id = p_id;
$$;

-- Copiar a Drive los archivos que ya existían (se corre una vez, desde el editor SQL).
create or replace function public.drive_encolar_existentes()
returns integer
language sql
security definer
set search_path = public
as $$
  with nuevos as (
    insert into public.drive_cola (bucket, ruta)
    select o.bucket_id, o.name from storage.objects o
     where o.name not like '%.emptyFolderPlaceholder' and not coalesce(o.is_delete_marker, false)
    on conflict (bucket, ruta) do nothing
    returning 1)
  select count(*)::integer from nuevos;
$$;

revoke all on function public._drive_limpio(text) from public, anon, authenticated;
revoke all on function public._drive_resultado(uuid, text[], text) from public, anon, authenticated;
revoke all on function public._drive_carpeta_contrato(uuid) from public, anon, authenticated;
revoke all on function public._drive_destino(text, text) from public, anon, authenticated;
revoke all on function public._drive_encolar_objeto() from public, anon, authenticated;
revoke all on function public.tomar_drive(integer) from public, anon, authenticated;
revoke all on function public.marcar_drive(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.drive_encolar_existentes() from public, anon, authenticated;
grant execute on function public.tomar_drive(integer) to service_role;
grant execute on function public.marcar_drive(uuid, text, text, text) to service_role;
grant all on public.drive_carpetas to service_role;
grant select on public.ajustes_drive to service_role;

-- 6. pg_cron: cada minuto, solo si está activa y hay algo por subir ------------------

select cron.schedule('subir-drive', '* * * * *', $cron$
  select net.http_post(
           url := a.url_funcion,
           headers := '{"Content-Type": "application/json"}'::jsonb,
           body := '{}'::jsonb,
           timeout_milliseconds := 60000)
    from public.ajustes_drive a
   where a.id and a.activo and a.url_funcion is not null and a.unidad_id is not null
     and exists (select 1 from public.drive_cola c
                  where c.estado in ('pendiente', 'error') and c.intentos < 5 and c.siguiente_intento <= now());
$cron$);

commit;
