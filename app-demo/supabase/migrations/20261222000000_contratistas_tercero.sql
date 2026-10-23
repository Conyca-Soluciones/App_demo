-- Contratistas enlazados al tercero (decisión del usuario, 2026-10-23; paso 2
-- de "Terceros: el centro de a quién se le paga", ver CLAUDE.md).
--
-- Antes: el contratista tenía su propio nombre, documento y cuenta bancaria, y
-- un disparador copiaba la cuenta a Terceros. Ahora:
-- - contratistas.tercero_id (obligatorio, único): Crear contratista busca el
--   tercero por documento o lo crea con el formulario de A&F (crear_tercero).
-- - La cuenta bancaria vive SOLO en Terceros (la verifica A&F). Se borran
--   banco, tipo_cuenta y numero_cuenta de contratistas, el disparador que los
--   copiaba, el que validaba el banco y datos_bancarios_contratistas.
--   La certificación bancaria sigue siendo un documento del contratista.
-- - Nombre, documento, DV y tipo de persona quedan en contratistas como COPIA
--   que se llena sola desde el tercero (contratistas_desde_tercero, al crear y
--   en cada cambio; y cuando A&F corrige el tercero). Nadie la edita a mano. Así
--   las ~24 funciones y las pantallas que leen contratistas.nombre /
--   numero_documento siguen igual; se pueden pasar a terceros poco a poco.
-- - Tipo de persona = jurídica si el tercero es NIT; si no, natural.
-- - El pago de un acta toma el tercero de contratistas.tercero_id (antes lo
--   buscaba comparando el documento como texto).
--
-- Los contratistas de prueba: se enlazan a su tercero por documento o se les
-- crea uno (sin cuenta: la de prueba se pierde con las columnas).

-- 1. tercero_id ----------------------------------------------------------------

alter table public.contratistas add column if not exists tercero_id uuid references public.terceros(id);
create unique index if not exists contratistas_tercero_unico on public.contratistas (tercero_id);
grant select (tercero_id) on public.contratistas to authenticated;

-- 2. Sin los disparadores bancarios (antes del backfill: no deben crear cuentas)

drop trigger if exists trg_contratista_a_tercero on public.contratistas;
drop trigger if exists trg_contratista_validar_banco on public.contratistas;
drop function if exists public._contratista_a_tercero();
drop function if exists public._contratista_validar_banco();
drop function if exists public.datos_bancarios_contratistas(uuid[]);

-- 3. Los contratistas que ya existen ------------------------------------------

insert into public.terceros (tipo_documento, numero_documento, dv, razon_social, observaciones)
select k.tipo_documento, k.numero_documento, k.digito_verificacion::text, k.nombre,
       'Creado desde Contratistas al enlazarlos con Terceros.'
  from public.contratistas k
 where k.tercero_id is null
   and not exists (select 1 from public.terceros t where t.numero_documento = k.numero_documento);

update public.contratistas k
   set tercero_id = t.id
  from public.terceros t
 where k.tercero_id is null and t.numero_documento = k.numero_documento;

alter table public.contratistas alter column tercero_id set not null;

-- 4. Identidad copiada del tercero ---------------------------------------------

create or replace function public._contratista_desde_tercero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  select tipo_documento, numero_documento, dv, razon_social into t
    from public.terceros where id = new.tercero_id;
  if not found then
    raise exception 'El tercero del contratista no existe.';
  end if;
  if t.tipo_documento not in ('CC', 'CE', 'PPT', 'PA', 'NIT') then
    raise exception 'Un contratista se identifica con CC, CE, PPT, PA o NIT; el tercero tiene %.', t.tipo_documento;
  end if;
  new.tipo_documento := t.tipo_documento;
  new.numero_documento := t.numero_documento;
  new.digito_verificacion := nullif(t.dv, '')::smallint;
  new.nombre := t.razon_social;
  new.tipo_persona := case when t.tipo_documento = 'NIT' then 'juridica' else 'natural' end;
  return new;
end;
$$;

drop trigger if exists contratistas_desde_tercero on public.contratistas;
create trigger contratistas_desde_tercero
  before insert or update on public.contratistas
  for each row execute function public._contratista_desde_tercero();

-- A&F corrige el tercero: la copia del contratista se actualiza (el
-- disparador de arriba vuelve a leer el tercero).
create or replace function public._tercero_a_contratista()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.tipo_documento, new.numero_documento, new.dv, new.razon_social)
     is distinct from (old.tipo_documento, old.numero_documento, old.dv, old.razon_social) then
    update public.contratistas set tercero_id = tercero_id where tercero_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_tercero_a_contratista on public.terceros;
create trigger trg_tercero_a_contratista
  after update on public.terceros
  for each row execute function public._tercero_a_contratista();

-- Los que ya existían quedan con la copia igual a su tercero.
update public.contratistas k
   set tercero_id = k.tercero_id
  from public.terceros t
 where t.id = k.tercero_id
   and (k.tipo_documento, k.numero_documento, k.digito_verificacion, k.nombre)
       is distinct from (t.tipo_documento, t.numero_documento, nullif(t.dv, '')::smallint, t.razon_social);

revoke all on function public._contratista_desde_tercero() from public, anon, authenticated;
revoke all on function public._tercero_a_contratista() from public, anon, authenticated;

-- 5. Sin datos bancarios en contratistas --------------------------------------

alter table public.contratistas
  drop column if exists banco,
  drop column if exists tipo_cuenta,
  drop column if exists numero_cuenta;

create or replace function public._historial_contratista()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cambios jsonb;
begin
  if public._renombrando_banco() then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform public._anotar_historial('contratista', new.id, 'creado',
      jsonb_build_object('nombre', new.nombre, 'documento', new.tipo_documento || ' ' || new.numero_documento));
    return null;
  end if;

  v_cambios := public._jsonb_cambios(to_jsonb(old), to_jsonb(new),
    array['id', 'created_by', 'created_at', 'updated_at', 'updated_by']);
  if v_cambios is not null then
    perform public._anotar_historial('contratista', new.id, 'editado', jsonb_build_object('cambios', v_cambios));
  end if;
  return null;
end;
$$;

-- 6. Crear y editar -------------------------------------------------------------

-- p_datos.tercero_id: el tercero ya existe (lo buscó o lo creó con
-- crear_tercero). Nombre, documento y tipo de persona salen de él.
create or replace function public.crear_contratista(p_id uuid, p_datos jsonb, p_documentos jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tercero uuid := nullif(p_datos ->> 'tercero_id', '')::uuid;
  v_tipo_doc text;
  v_tipo_persona text;
  v_requeridos text[];
  v_permitidos text[];
  v_faltan text[];
  v_ya text;
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_contratistas') then
    raise exception 'No tienes permiso para crear contratistas.';
  end if;
  if p_id is null then
    raise exception 'Falta el identificador del contratista.';
  end if;
  if v_tercero is null then
    raise exception 'Busca el tercero por su documento (o créalo) antes de crear el contratista.';
  end if;
  select tipo_documento into v_tipo_doc from public.terceros where id = v_tercero;
  if not found then
    raise exception 'El tercero no existe.';
  end if;
  select nombre into v_ya from public.contratistas where tercero_id = v_tercero;
  if found then
    raise exception 'Ese tercero ya está registrado como contratista (%).', v_ya;
  end if;
  v_tipo_persona := case when v_tipo_doc = 'NIT' then 'juridica' else 'natural' end;

  if v_tipo_persona = 'natural' then
    v_requeridos := array['cedula', 'rut', 'certificacion_bancaria', 'autorizacion_datos'];
    v_permitidos := v_requeridos || array['hoja_vida'];
  else
    v_requeridos := array['camara_comercio', 'rut', 'cedula_representante', 'certificacion_bancaria',
                          'autorizacion_datos', 'consulta_oficial_cumplimiento'];
    v_permitidos := v_requeridos;
  end if;

  if nullif(trim(p_datos ->> 'cedula_expedida_en'), '') is null then
    raise exception 'Escribe dónde se expidió la cédula.';
  end if;
  if jsonb_typeof(p_documentos) is distinct from 'array' then
    raise exception 'Faltan los documentos.';
  end if;

  select array_agg(r) into v_faltan
  from unnest(v_requeridos) r
  where not exists (select 1 from jsonb_array_elements(p_documentos) e where e ->> 'tipo' = r);
  if v_faltan is not null then
    raise exception 'Faltan documentos obligatorios: %.', array_to_string(v_faltan, ', ');
  end if;

  for d in select * from jsonb_array_elements(p_documentos) loop
    if not (d ->> 'tipo' = any (v_permitidos)) then
      raise exception 'El documento "%" no aplica para este tipo de persona.', d ->> 'tipo';
    end if;
    if left(d ->> 'ruta', 37) is distinct from p_id::text || '/' then
      raise exception 'La ruta del documento no corresponde a este contratista.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'contratistas' and o.name = d ->> 'ruta') then
      raise exception 'No se encontró el archivo de "%". Vuelve a adjuntarlo.', d ->> 'tipo';
    end if;
  end loop;

  -- Nombre, documento, DV y tipo de persona los pone contratistas_desde_tercero.
  insert into contratistas (
    id, tercero_id, tipo_persona, tipo_documento, numero_documento, nombre,
    representante_nombre, representante_tipo_documento, representante_numero_documento,
    cedula_expedida_en, correo, telefono, direccion, ciudad
  ) values (
    p_id, v_tercero, v_tipo_persona, v_tipo_doc, '0', '...',
    case when v_tipo_persona = 'juridica' then nullif(trim(p_datos ->> 'representante_nombre'), '') end,
    case when v_tipo_persona = 'juridica' then nullif(p_datos ->> 'representante_tipo_documento', '') end,
    case when v_tipo_persona = 'juridica' then nullif(p_datos ->> 'representante_numero_documento', '') end,
    trim(p_datos ->> 'cedula_expedida_en'),
    lower(trim(p_datos ->> 'correo')), p_datos ->> 'telefono', trim(p_datos ->> 'direccion'), trim(p_datos ->> 'ciudad')
  );

  insert into contratista_documentos (contratista_id, tipo, ruta, nombre_archivo, tamano, mime)
  select p_id, e ->> 'tipo', e ->> 'ruta', e ->> 'nombre_archivo', (e ->> 'tamano')::bigint, e ->> 'mime'
  from jsonb_array_elements(p_documentos) e;

  return p_id;
end;
$$;

-- El tercero (y con él nombre, documento y tipo de persona) no se cambia aquí:
-- eso lo corrige A&F en Terceros. Se editan representante, contacto y documentos.
create or replace function public.editar_contratista(p_id uuid, p_datos jsonb, p_documentos jsonb)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual record;
  v_permitidos text[];
  v_viejas text[] := '{}';
  v_vieja text;
  v_bancarios boolean := public.tiene_accion(auth.uid(), 'ver_datos_bancarios');
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_contratistas') then
    raise exception 'No tienes permiso para editar contratistas.';
  end if;

  select id, tipo_persona into v_actual from contratistas where id = p_id for update;
  if not found then
    raise exception 'El contratista no existe.';
  end if;
  if nullif(trim(p_datos ->> 'cedula_expedida_en'), '') is null then
    raise exception 'Escribe dónde se expidió la cédula.';
  end if;

  if v_actual.tipo_persona = 'natural' then
    v_permitidos := array['cedula', 'rut', 'certificacion_bancaria', 'autorizacion_datos', 'hoja_vida'];
  else
    v_permitidos := array['camara_comercio', 'rut', 'cedula_representante', 'certificacion_bancaria',
                          'autorizacion_datos', 'consulta_oficial_cumplimiento'];
  end if;
  -- La certificación bancaria solo la ve y la cambia quien tiene ver_datos_bancarios.
  if not v_bancarios then
    v_permitidos := array_remove(v_permitidos, 'certificacion_bancaria');
  end if;

  if jsonb_typeof(coalesce(p_documentos, '[]')) is distinct from 'array' then
    raise exception 'Los documentos no son válidos.';
  end if;
  if (select count(distinct e ->> 'tipo') from jsonb_array_elements(coalesce(p_documentos, '[]')) e)
     <> jsonb_array_length(coalesce(p_documentos, '[]')) then
    raise exception 'Hay un documento repetido.';
  end if;
  for d in select * from jsonb_array_elements(coalesce(p_documentos, '[]')) loop
    if not (d ->> 'tipo' = any (v_permitidos)) then
      raise exception 'El documento "%" no aplica para este tipo de persona.', d ->> 'tipo';
    end if;
    if left(d ->> 'ruta', 37) is distinct from p_id::text || '/' then
      raise exception 'La ruta del documento no corresponde a este contratista.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'contratistas' and o.name = d ->> 'ruta') then
      raise exception 'No se encontró el archivo de "%". Vuelve a adjuntarlo.', d ->> 'tipo';
    end if;
  end loop;

  update contratistas set
    representante_nombre = case when v_actual.tipo_persona = 'juridica' then nullif(trim(p_datos ->> 'representante_nombre'), '') end,
    representante_tipo_documento = case when v_actual.tipo_persona = 'juridica' then nullif(p_datos ->> 'representante_tipo_documento', '') end,
    representante_numero_documento = case when v_actual.tipo_persona = 'juridica' then nullif(p_datos ->> 'representante_numero_documento', '') end,
    cedula_expedida_en = trim(p_datos ->> 'cedula_expedida_en'),
    correo = lower(trim(p_datos ->> 'correo')),
    telefono = p_datos ->> 'telefono',
    direccion = trim(p_datos ->> 'direccion'),
    ciudad = trim(p_datos ->> 'ciudad'),
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_id;

  for d in select * from jsonb_array_elements(coalesce(p_documentos, '[]')) loop
    delete from contratista_documentos
    where contratista_id = p_id and tipo = d ->> 'tipo'
    returning ruta into v_vieja;
    if v_vieja is not null and v_vieja <> d ->> 'ruta' then
      v_viejas := v_viejas || v_vieja;
    end if;
    v_vieja := null;
    insert into contratista_documentos (contratista_id, tipo, ruta, nombre_archivo, tamano, mime)
    values (p_id, d ->> 'tipo', d ->> 'ruta', d ->> 'nombre_archivo', (d ->> 'tamano')::bigint, d ->> 'mime');
  end loop;

  return v_viejas;
end;
$$;

-- 7. Funciones vivas, parchadas -----------------------------------------------

do $$
declare
  -- función, texto a buscar, reemplazo, veces que debe aparecer
  v_cambios constant text[][] := array[
    ['guardar_banco',
     '    update public.contratistas set banco = v_nombre where banco = v_anterior;',
     '    -- Contratistas ya no guardan el banco: la cuenta vive en Terceros (20261222000000).',
     '1'],
    ['listar_bancos_admin',
     '''contratistas'', (select count(*) from public.contratistas k where k.banco = b.nombre)',
     '''contratistas'', (select count(*) from public.contratistas k join public.terceros_cuentas tc on tc.tercero_id = k.tercero_id where tc.banco_id = b.id)',
     '1'],
    ['certificacion_bancaria_tercero',
     'join public.contratistas k on k.numero_documento = t.numero_documento',
     'join public.contratistas k on k.tercero_id = t.id',
     '1'],
    ['_pago_de_acta',
     'k.numero_documento, k.nombre as contratista_nombre',
     'k.numero_documento, k.tercero_id as contratista_tercero_id, k.nombre as contratista_nombre',
     '1'],
    ['_pago_de_acta',
     'select t.id into v_tercero from terceros t where t.numero_documento = v.numero_documento limit 1;',
     'v_tercero := v.contratista_tercero_id;  -- contratistas.tercero_id (20261222000000)',
     '1']
  ];
  v_def text;
  v_n int;
  i int;
begin
  for i in 1 .. array_length(v_cambios, 1) loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_cambios[i][1];
    if v_def is null then
      raise exception 'No existe la función %.', v_cambios[i][1];
    end if;
    if position(v_cambios[i][3] in v_def) > 0 then
      continue;  -- ya aplicado
    end if;
    v_n := (length(v_def) - length(replace(v_def, v_cambios[i][2], ''))) / length(v_cambios[i][2]);
    if v_n <> v_cambios[i][4]::int then
      raise exception 'En % se esperaba encontrar % veces el texto % (veces: %): ¿cambió la función?',
        v_cambios[i][1], v_cambios[i][4], v_cambios[i][2], v_n;
    end if;
    execute replace(v_def, v_cambios[i][2], v_cambios[i][3]);
  end loop;
end $$;
