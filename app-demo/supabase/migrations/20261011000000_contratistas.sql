-- Contratistas (Contratos › Contratistas).
--
-- Directorio de personas naturales y jurídicas con las que se contrata, con los
-- DOCUMENTOS GENERALES que Jurídica exige para cualquier contrato (los que
-- dependen del tipo de contrato van con el contrato, más adelante):
--
--   Persona natural:  cédula, RUT, certificación bancaria, autorización de
--                     tratamiento de datos; hoja de vida si aplica (opcional).
--   Persona jurídica: cámara de comercio, RUT, cédula del representante legal,
--                     certificación bancaria, autorización de tratamiento de
--                     datos, consulta de oficial de cumplimiento.
--
-- Un contratista NO se puede crear sin sus datos y sus documentos obligatorios:
-- crear_contratista inserta todo en una sola transacción y verifica que cada
-- archivo exista en Storage.
--
-- Archivos: bucket PRIVADO `contratistas`, ruta `<contratista_id>/<tipo>-<n>.<ext>`.
-- El navegador sube el archivo con la sesión del usuario (las políticas de
-- storage.objects exigen el permiso) y después llama crear_contratista.

-- ---------------------------------------------------------------- permisos
-- Igual que tiene_accion, para pestañas (no existía): lo usan las políticas.
create or replace function public.tiene_pestana(p_usuario_id uuid, p_clave text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.rol_id is null then p.es_admin
      else r.clave = 'administrador'
        or exists (
          select 1 from public.rol_permisos rp
          where rp.rol_id = p.rol_id and rp.permiso = 'tab.' || p_clave
        )
    end
    from public.perfiles p
    left join public.roles r on r.id = p.rol_id
    where p.id = p_usuario_id
  ), false)
$$;
revoke all on function public.tiene_pestana(uuid, text) from public, anon;
grant execute on function public.tiene_pestana(uuid, text) to authenticated, service_role;

-- Dígito de verificación de un NIT (algoritmo de la DIAN, módulo 11).
create or replace function public.dv_nit(p_nit text)
returns smallint
language sql
immutable
as $$
  with d as (
    select substr(reverse(p_nit), i, 1)::int as digito,
           (array[3,7,13,17,19,23,29,37,41,43,47,53,59,67,71])[i] as peso
    from generate_series(1, length(p_nit)) i
  )
  select (case when s % 11 > 1 then 11 - s % 11 else s % 11 end)::smallint
  from (select sum(digito * peso) as s from d) t
$$;

-- ---------------------------------------------------------------- tablas
create table if not exists public.contratistas (
  id uuid primary key default gen_random_uuid(),
  tipo_persona text not null check (tipo_persona in ('natural', 'juridica')),
  tipo_documento text not null check (tipo_documento in ('CC', 'CE', 'PPT', 'PA', 'NIT')),
  numero_documento text not null check (numero_documento ~ '^[0-9A-Z]{3,20}$'),
  digito_verificacion smallint check (digito_verificacion between 0 and 9),
  nombre text not null check (length(trim(nombre)) >= 3),
  representante_nombre text,
  representante_tipo_documento text check (representante_tipo_documento in ('CC', 'CE', 'PPT', 'PA')),
  representante_numero_documento text check (representante_numero_documento ~ '^[0-9A-Z]{3,20}$'),
  correo text not null check (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefono text not null check (telefono ~ '^\+?[0-9]{7,15}$'),
  direccion text not null check (length(trim(direccion)) > 0),
  ciudad text not null check (length(trim(ciudad)) > 0),
  banco text not null check (length(trim(banco)) > 0),
  tipo_cuenta text not null check (tipo_cuenta in ('ahorros', 'corriente')),
  numero_cuenta text not null check (numero_cuenta ~ '^[0-9]{4,20}$'),
  created_by uuid references public.perfiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contratistas_documento_unico unique (tipo_documento, numero_documento),
  -- Jurídica = NIT con DV y representante legal. Natural = documento de persona.
  constraint contratistas_juridica_nit check (
    (tipo_persona = 'juridica') = (tipo_documento = 'NIT')
  ),
  constraint contratistas_nit_dv check (
    tipo_documento <> 'NIT'
    or (digito_verificacion is not null and numero_documento ~ '^[0-9]{5,15}$'
        and digito_verificacion = public.dv_nit(numero_documento))
  ),
  constraint contratistas_representante check (
    tipo_persona <> 'juridica'
    or (length(trim(coalesce(representante_nombre, ''))) >= 3
        and representante_tipo_documento is not null
        and representante_numero_documento is not null)
  )
);

create index if not exists idx_contratistas_nombre on public.contratistas (nombre);
create index if not exists idx_contratistas_created_by on public.contratistas (created_by);

create table if not exists public.contratista_documentos (
  id uuid primary key default gen_random_uuid(),
  contratista_id uuid not null references public.contratistas(id) on delete cascade,
  tipo text not null check (tipo in (
    'cedula', 'rut', 'certificacion_bancaria', 'hoja_vida', 'autorizacion_datos',
    'camara_comercio', 'cedula_representante', 'consulta_oficial_cumplimiento'
  )),
  ruta text not null unique,
  nombre_archivo text not null,
  tamano bigint not null check (tamano > 0),
  mime text not null,
  subido_por uuid references public.perfiles(id) default auth.uid(),
  subido_at timestamptz not null default now(),
  -- Un documento vigente por tipo (reemplazarlo será una acción aparte).
  constraint contratista_documentos_tipo_unico unique (contratista_id, tipo)
);
create index if not exists idx_contratista_documentos_subido_por on public.contratista_documentos (subido_por);

-- ---------------------------------------------------------------- RLS
alter table public.contratistas enable row level security;
alter table public.contratista_documentos enable row level security;

drop policy if exists contratistas_select on public.contratistas;
create policy contratistas_select on public.contratistas for select to authenticated
  using (
    public.tiene_pestana((select auth.uid()), 'contratos.contratistas')
    or public.tiene_accion((select auth.uid()), 'gestionar_contratistas')
  );

drop policy if exists contratista_documentos_select on public.contratista_documentos;
create policy contratista_documentos_select on public.contratista_documentos for select to authenticated
  using (
    public.tiene_pestana((select auth.uid()), 'contratos.contratistas')
    or public.tiene_accion((select auth.uid()), 'gestionar_contratistas')
  );
-- Sin políticas de INSERT/UPDATE/DELETE: se crea solo con crear_contratista.

-- ---------------------------------------------------------------- Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratistas', 'contratistas', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists contratistas_archivos_select on storage.objects;
create policy contratistas_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratistas'
    and (
      public.tiene_pestana((select auth.uid()), 'contratos.contratistas')
      or public.tiene_accion((select auth.uid()), 'gestionar_contratistas')
    )
  );

drop policy if exists contratistas_archivos_insert on storage.objects;
create policy contratistas_archivos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contratistas'
    and public.tiene_accion((select auth.uid()), 'gestionar_contratistas')
  );

-- Borrar: solo archivos que todavía no son documento de ningún contratista
-- (limpieza cuando la creación falla después de subir).
drop policy if exists contratistas_archivos_delete on storage.objects;
create policy contratistas_archivos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'contratistas'
    and public.tiene_accion((select auth.uid()), 'gestionar_contratistas')
    and not exists (select 1 from public.contratista_documentos d where d.ruta = name)
  );

-- ---------------------------------------------------------------- crear
-- p_datos: campos del contratista (mismos nombres de columna).
-- p_documentos: [{tipo, ruta, nombre_archivo, tamano, mime}, ...]
create or replace function public.crear_contratista(p_id uuid, p_datos jsonb, p_documentos jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo_persona text := p_datos->>'tipo_persona';
  v_requeridos text[];
  v_permitidos text[];
  v_faltan text[];
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_contratistas') then
    raise exception 'No tienes permiso para crear contratistas.';
  end if;
  if p_id is null then
    raise exception 'Falta el identificador del contratista.';
  end if;

  if v_tipo_persona = 'natural' then
    v_requeridos := array['cedula', 'rut', 'certificacion_bancaria', 'autorizacion_datos'];
    v_permitidos := v_requeridos || array['hoja_vida'];
  elsif v_tipo_persona = 'juridica' then
    v_requeridos := array['camara_comercio', 'rut', 'cedula_representante', 'certificacion_bancaria',
                          'autorizacion_datos', 'consulta_oficial_cumplimiento'];
    v_permitidos := v_requeridos;
  else
    raise exception 'Tipo de persona no válido.';
  end if;

  if jsonb_typeof(p_documentos) is distinct from 'array' then
    raise exception 'Faltan los documentos.';
  end if;

  select array_agg(r) into v_faltan
  from unnest(v_requeridos) r
  where not exists (select 1 from jsonb_array_elements(p_documentos) e where e->>'tipo' = r);
  if v_faltan is not null then
    raise exception 'Faltan documentos obligatorios: %.', array_to_string(v_faltan, ', ');
  end if;

  for d in select * from jsonb_array_elements(p_documentos) loop
    if not (d->>'tipo' = any (v_permitidos)) then
      raise exception 'El documento "%" no aplica para este tipo de persona.', d->>'tipo';
    end if;
    if left(d->>'ruta', 37) is distinct from p_id::text || '/' then
      raise exception 'La ruta del documento no corresponde a este contratista.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'contratistas' and o.name = d->>'ruta') then
      raise exception 'No se encontró el archivo de "%". Vuelve a adjuntarlo.', d->>'tipo';
    end if;
  end loop;

  insert into contratistas (
    id, tipo_persona, tipo_documento, numero_documento, digito_verificacion, nombre,
    representante_nombre, representante_tipo_documento, representante_numero_documento,
    correo, telefono, direccion, ciudad, banco, tipo_cuenta, numero_cuenta
  ) values (
    p_id, v_tipo_persona, p_datos->>'tipo_documento', p_datos->>'numero_documento',
    nullif(p_datos->>'digito_verificacion', '')::smallint, trim(p_datos->>'nombre'),
    case when v_tipo_persona = 'juridica' then nullif(trim(p_datos->>'representante_nombre'), '') end,
    case when v_tipo_persona = 'juridica' then nullif(p_datos->>'representante_tipo_documento', '') end,
    case when v_tipo_persona = 'juridica' then nullif(p_datos->>'representante_numero_documento', '') end,
    lower(trim(p_datos->>'correo')), p_datos->>'telefono', trim(p_datos->>'direccion'),
    trim(p_datos->>'ciudad'), trim(p_datos->>'banco'), p_datos->>'tipo_cuenta', p_datos->>'numero_cuenta'
  );

  insert into contratista_documentos (contratista_id, tipo, ruta, nombre_archivo, tamano, mime)
  select p_id, e->>'tipo', e->>'ruta', e->>'nombre_archivo', (e->>'tamano')::bigint, e->>'mime'
  from jsonb_array_elements(p_documentos) e;

  return p_id;
end;
$$;
revoke all on function public.crear_contratista(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.crear_contratista(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- roles
-- Por defecto: ven la pestaña quienes ya ven "Elaboración de contratos"
-- (Gerencia, Legal, Líder Legal); crean Legal y Líder Legal. El
-- Administrador siempre tiene todo. Se ajusta en Roles y permisos.
insert into public.rol_permisos (rol_id, permiso)
select rol_id, 'tab.contratos.contratistas'
from public.rol_permisos
where permiso = 'tab.contratos.contratos'
on conflict do nothing;

insert into public.rol_permisos (rol_id, permiso)
select id, 'accion.gestionar_contratistas'
from public.roles
where clave in ('legal', 'lider_legal')
on conflict do nothing;

-- search_path fijo (advertencia del asesor de seguridad de Supabase); también
-- para la función de 20261010100000_rendimiento_requisiciones.
alter function public.dv_nit(text) set search_path = public;
alter function public.insumos_presupuesto_por_ids(uuid, uuid[]) set search_path = public;
