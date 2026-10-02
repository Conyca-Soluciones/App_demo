-- Solicitud de contratos (Contratos › Solicitud de contratos).
--
-- El director de obra arma la solicitud para el proyecto actual: tipo de
-- contrato, contratista (sus datos salen de `contratistas`), objeto, valor,
-- forma de pago, plazo, obligaciones, entregables, anexo y los DOCUMENTOS
-- ESPECÍFICOS del tipo de contrato (los generales ya están en el contratista).
-- Al mandarla queda en estado 'pre_aprobacion', donde Jurídica hará la minuta
-- (pantalla "Elaboración de contratos", pendiente).
--
-- Igual que contratistas: crear_solicitud_contrato guarda todo en una sola
-- transacción y verifica que cada archivo exista en Storage (bucket privado
-- `contratos`, ruta `<contrato_id>/<tipo>.<ext>`).

-- ---------------------------------------------------------------- tablas
create table if not exists public.contratos (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity unique,
  proyecto_id uuid not null references public.proyectos(id),
  contratista_id uuid not null references public.contratistas(id),
  tipo text not null check (tipo in (
    'mano_obra', 'obra', 'arrendamiento', 'alquiler_vehiculo', 'prestacion_servicios', 'suministro_instalacion'
  )),
  -- Por ahora solo existe la pre-aprobación; los estados siguientes (devuelta,
  -- en elaboración, firmado...) se agregan con su pantalla.
  estado text not null default 'pre_aprobacion' check (estado in ('pre_aprobacion')),
  -- Empieza por un verbo en infinitivo ("Desarrollar...", "Ejecutar...").
  objeto text not null check (objeto ~* '^\s*[a-záéíóúñü]+(ar|er|ir)\M'),
  valor numeric(18, 2) not null check (valor > 0),
  anexo_tipo text not null check (anexo_tipo in ('valor_global', 'valores_unitarios')),
  tiene_anticipo boolean not null default false,
  anticipo_porcentaje numeric(5, 2) check (anticipo_porcentaje > 0 and anticipo_porcentaje <= 100),
  forma_pago text not null check (length(trim(forma_pago)) > 0),
  plazo_tipo text not null check (plazo_tipo in ('fechas', 'duracion')),
  fecha_inicio date,
  fecha_fin date,
  duracion_cantidad integer check (duracion_cantidad > 0),
  duracion_unidad text check (duracion_unidad in ('dias', 'meses')),
  correo_notificacion text not null check (correo_notificacion ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  observaciones text,
  solicitado_por uuid references public.perfiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  enviado_at timestamptz not null default now(),
  constraint contratos_anticipo check (
    (tiene_anticipo and anticipo_porcentaje is not null) or (not tiene_anticipo and anticipo_porcentaje is null)
  ),
  constraint contratos_plazo check (
    (plazo_tipo = 'fechas' and fecha_inicio is not null and fecha_fin is not null and fecha_fin >= fecha_inicio
       and duracion_cantidad is null and duracion_unidad is null)
    or (plazo_tipo = 'duracion' and duracion_cantidad is not null and duracion_unidad is not null
       and fecha_fin is null)
  )
);
create index if not exists idx_contratos_proyecto_created on public.contratos (proyecto_id, created_at desc);
create index if not exists idx_contratos_contratista on public.contratos (contratista_id);
create index if not exists idx_contratos_solicitado_por on public.contratos (solicitado_por);
create index if not exists idx_contratos_estado on public.contratos (estado);

create table if not exists public.contrato_obligaciones (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  orden integer not null,
  texto text not null check (length(trim(texto)) > 0),
  unique (contrato_id, orden)
);

create table if not exists public.contrato_entregables (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  orden integer not null,
  texto text not null check (length(trim(texto)) > 0),
  unique (contrato_id, orden)
);

-- Anexo de valores unitarios (si anexo_tipo = 'valores_unitarios').
create table if not exists public.contrato_anexo_items (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  orden integer not null,
  actividad text not null check (length(trim(actividad)) > 0),
  unidad text not null check (length(trim(unidad)) > 0),
  cantidad numeric(18, 4) not null check (cantidad > 0),
  valor_unitario numeric(18, 2) not null check (valor_unitario > 0),
  unique (contrato_id, orden)
);

create table if not exists public.contrato_documentos (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  tipo text not null check (tipo in (
    'planilla_seguridad_social', 'certificado_alturas', 'certificado_competencia_laboral',
    'cronograma_actividades', 'cotizacion_aprobada', 'polizas', 'relacion_personal',
    'certificado_tradicion_libertad', 'autorizacion_propietario',
    'tarjeta_propiedad', 'revision_tecnicomecanica', 'soat', 'licencia_conduccion',
    'tarjeta_profesional', 'certificado_eps', 'cotizacion'
  )),
  ruta text not null unique,
  nombre_archivo text not null,
  tamano bigint not null check (tamano > 0),
  mime text not null,
  subido_por uuid references public.perfiles(id) default auth.uid(),
  subido_at timestamptz not null default now(),
  unique (contrato_id, tipo)
);
create index if not exists idx_contrato_documentos_subido_por on public.contrato_documentos (subido_por);

-- ---------------------------------------------------------------- RLS
-- Ver: quien tenga la pestaña de solicitud o la de elaboración (Jurídica), y
-- solo de los proyectos que puede ver.
create or replace function public.puede_ver_contrato(p_proyecto_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.tiene_pestana(auth.uid(), 'contratos.solicitar')
    or public.tiene_pestana(auth.uid(), 'contratos.contratos')
  ) and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id)
$$;
revoke all on function public.puede_ver_contrato(uuid) from public, anon;
grant execute on function public.puede_ver_contrato(uuid) to authenticated, service_role;

alter table public.contratos enable row level security;
alter table public.contrato_obligaciones enable row level security;
alter table public.contrato_entregables enable row level security;
alter table public.contrato_anexo_items enable row level security;
alter table public.contrato_documentos enable row level security;

drop policy if exists contratos_select on public.contratos;
create policy contratos_select on public.contratos for select to authenticated
  using (public.puede_ver_contrato(proyecto_id));

drop policy if exists contrato_obligaciones_select on public.contrato_obligaciones;
create policy contrato_obligaciones_select on public.contrato_obligaciones for select to authenticated
  using (exists (select 1 from public.contratos c where c.id = contrato_id and public.puede_ver_contrato(c.proyecto_id)));

drop policy if exists contrato_entregables_select on public.contrato_entregables;
create policy contrato_entregables_select on public.contrato_entregables for select to authenticated
  using (exists (select 1 from public.contratos c where c.id = contrato_id and public.puede_ver_contrato(c.proyecto_id)));

drop policy if exists contrato_anexo_items_select on public.contrato_anexo_items;
create policy contrato_anexo_items_select on public.contrato_anexo_items for select to authenticated
  using (exists (select 1 from public.contratos c where c.id = contrato_id and public.puede_ver_contrato(c.proyecto_id)));

drop policy if exists contrato_documentos_select on public.contrato_documentos;
create policy contrato_documentos_select on public.contrato_documentos for select to authenticated
  using (exists (select 1 from public.contratos c where c.id = contrato_id and public.puede_ver_contrato(c.proyecto_id)));
-- Sin INSERT/UPDATE/DELETE: se crea solo con crear_solicitud_contrato.

-- Quien solicita contratos necesita leer el directorio de contratistas para
-- elegir uno (aunque no tenga la pestaña Contratistas).
drop policy if exists contratistas_select on public.contratistas;
create policy contratistas_select on public.contratistas for select to authenticated
  using (
    public.tiene_pestana((select auth.uid()), 'contratos.contratistas')
    or public.tiene_accion((select auth.uid()), 'gestionar_contratistas')
    or public.tiene_accion((select auth.uid()), 'solicitar_contratos')
  );
drop policy if exists contratista_documentos_select on public.contratista_documentos;
create policy contratista_documentos_select on public.contratista_documentos for select to authenticated
  using (
    public.tiene_pestana((select auth.uid()), 'contratos.contratistas')
    or public.tiene_accion((select auth.uid()), 'gestionar_contratistas')
    or public.tiene_accion((select auth.uid()), 'solicitar_contratos')
  );

-- ---------------------------------------------------------------- Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos', 'contratos', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Ver un archivo: el del contrato (carpeta = id del contrato) que el usuario puede ver.
drop policy if exists contratos_archivos_select on storage.objects;
create policy contratos_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratos'
    and exists (
      select 1 from public.contratos c
      where c.id::text = (storage.foldername(name))[1] and public.puede_ver_contrato(c.proyecto_id)
    )
  );

drop policy if exists contratos_archivos_insert on storage.objects;
create policy contratos_archivos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contratos'
    and public.tiene_accion((select auth.uid()), 'solicitar_contratos')
  );

-- Borrar: solo archivos que todavía no son documento de ningún contrato
-- (limpieza cuando la solicitud falla después de subir).
drop policy if exists contratos_archivos_delete on storage.objects;
create policy contratos_archivos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'contratos'
    and public.tiene_accion((select auth.uid()), 'solicitar_contratos')
    and not exists (select 1 from public.contrato_documentos d where d.ruta = name)
  );

-- ---------------------------------------------------------------- crear
-- Documentos específicos por tipo de contrato: obligatorios / "si aplica".
-- (Misma tabla que DOCUMENTOS_POR_TIPO en lib/contratos.ts.)
create or replace function public.documentos_tipo_contrato(p_tipo text, out obligatorios text[], out permitidos text[])
language sql
immutable
set search_path = public
as $$
  select o, o || s
  from (values
    ('mano_obra', array['planilla_seguridad_social'], array['certificado_alturas', 'certificado_competencia_laboral']),
    ('obra', array['cronograma_actividades', 'cotizacion_aprobada'], array['polizas', 'relacion_personal']),
    ('arrendamiento', array['certificado_tradicion_libertad'], array['autorizacion_propietario']),
    ('alquiler_vehiculo', array['tarjeta_propiedad', 'revision_tecnicomecanica', 'soat', 'licencia_conduccion'], array[]::text[]),
    ('prestacion_servicios', array['certificado_eps', 'cotizacion'], array['tarjeta_profesional']),
    ('suministro_instalacion', array['planilla_seguridad_social', 'tarjeta_profesional'], array['certificado_alturas'])
  ) as t(tipo, o, s)
  where t.tipo = p_tipo
$$;

create or replace function public.crear_solicitud_contrato(
  p_id uuid, p_datos jsonb, p_obligaciones jsonb, p_entregables jsonb, p_items jsonb, p_documentos jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := p_datos->>'tipo';
  v_proyecto uuid := (p_datos->>'proyecto_id')::uuid;
  v_valor numeric := (p_datos->>'valor')::numeric;
  v_anexo text := p_datos->>'anexo_tipo';
  v_obligatorios text[];
  v_permitidos text[];
  v_faltan text[];
  v_suma numeric;
  v_numero bigint;
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para solicitar contratos.';
  end if;
  if p_id is null or v_proyecto is null then
    raise exception 'Faltan datos de la solicitud.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), v_proyecto) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;
  if not exists (select 1 from contratistas where id = (p_datos->>'contratista_id')::uuid) then
    raise exception 'El contratista no existe.';
  end if;

  select obligatorios, permitidos into v_obligatorios, v_permitidos from public.documentos_tipo_contrato(v_tipo);
  if v_obligatorios is null then
    raise exception 'Tipo de contrato no válido.';
  end if;

  -- Anexo de valores unitarios: debe tener líneas; el valor es su suma.
  if v_anexo = 'valores_unitarios' then
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
      raise exception 'El anexo de valores unitarios necesita al menos una actividad.';
    end if;
    -- El valor es la suma del anexo, calculada aquí (no se confía en la suma
    -- del navegador: redondea distinto en medios centavos).
    select round(sum(round((e->>'cantidad')::numeric * (e->>'valor_unitario')::numeric, 2)), 2)
      into v_suma from jsonb_array_elements(p_items) e;
    v_valor := v_suma;
  elsif jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    raise exception 'Un contrato a valor global no lleva tabla de valores unitarios.';
  end if;

  -- Documentos del tipo de contrato.
  if jsonb_typeof(p_documentos) is distinct from 'array' then
    raise exception 'Faltan los documentos.';
  end if;
  select array_agg(r) into v_faltan
  from unnest(v_obligatorios) r
  where not exists (select 1 from jsonb_array_elements(p_documentos) e where e->>'tipo' = r);
  if v_faltan is not null then
    raise exception 'Faltan documentos obligatorios: %.', array_to_string(v_faltan, ', ');
  end if;
  for d in select * from jsonb_array_elements(p_documentos) loop
    if not (d->>'tipo' = any (v_permitidos)) then
      raise exception 'El documento "%" no aplica para este tipo de contrato.', d->>'tipo';
    end if;
    if left(d->>'ruta', 37) is distinct from p_id::text || '/' then
      raise exception 'La ruta del documento no corresponde a esta solicitud.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'contratos' and o.name = d->>'ruta') then
      raise exception 'No se encontró el archivo de "%". Vuelve a adjuntarlo.', d->>'tipo';
    end if;
  end loop;

  insert into contratos (
    id, proyecto_id, contratista_id, tipo, objeto, valor, anexo_tipo, tiene_anticipo, anticipo_porcentaje,
    forma_pago, plazo_tipo, fecha_inicio, fecha_fin, duracion_cantidad, duracion_unidad,
    correo_notificacion, observaciones
  ) values (
    p_id, v_proyecto, (p_datos->>'contratista_id')::uuid, v_tipo, trim(p_datos->>'objeto'), v_valor, v_anexo,
    coalesce((p_datos->>'tiene_anticipo')::boolean, false), nullif(p_datos->>'anticipo_porcentaje', '')::numeric,
    trim(p_datos->>'forma_pago'), p_datos->>'plazo_tipo',
    nullif(p_datos->>'fecha_inicio', '')::date, nullif(p_datos->>'fecha_fin', '')::date,
    nullif(p_datos->>'duracion_cantidad', '')::integer, nullif(p_datos->>'duracion_unidad', ''),
    lower(trim(p_datos->>'correo_notificacion')), nullif(trim(p_datos->>'observaciones'), '')
  )
  returning numero into v_numero;

  insert into contrato_obligaciones (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_obligaciones, '[]')) with ordinality as t(v, ord);

  insert into contrato_entregables (contrato_id, orden, texto)
  select p_id, t.ord, trim(t.v #>> '{}')
  from jsonb_array_elements(coalesce(p_entregables, '[]')) with ordinality as t(v, ord);

  insert into contrato_anexo_items (contrato_id, orden, actividad, unidad, cantidad, valor_unitario)
  select p_id, t.ord, trim(t.v->>'actividad'), trim(t.v->>'unidad'), (t.v->>'cantidad')::numeric, (t.v->>'valor_unitario')::numeric
  from jsonb_array_elements(coalesce(p_items, '[]')) with ordinality as t(v, ord);

  insert into contrato_documentos (contrato_id, tipo, ruta, nombre_archivo, tamano, mime)
  select p_id, e->>'tipo', e->>'ruta', e->>'nombre_archivo', (e->>'tamano')::bigint, e->>'mime'
  from jsonb_array_elements(p_documentos) e;

  return v_numero;
end;
$$;
revoke all on function public.crear_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.crear_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- roles
-- Solicitan: Director de obra. Ven la pestaña también Gerencia, Legal y
-- Líder Legal (los que ya ven "Elaboración de contratos").
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
from public.roles r
cross join (values ('tab.contratos.solicitar'), ('accion.solicitar_contratos')) as p(permiso)
where r.clave = 'director_obra'
on conflict do nothing;

insert into public.rol_permisos (rol_id, permiso)
select rol_id, 'tab.contratos.solicitar'
from public.rol_permisos
where permiso = 'tab.contratos.contratos'
on conflict do nothing;
