-- Reversa de 20270101007100_documentos_contratista.sql: crear y editar
-- contratista vuelven a pedir / aceptar la certificación bancaria del
-- contratista, y se quitan las funciones de documentos sueltos y la política
-- para sobrescribir archivos. Los documentos ya guardados se quedan.

begin;
set local lock_timeout = '10s';

drop policy if exists contratistas_archivos_update on storage.objects;
drop function if exists public.certificaciones_contratista(uuid);
drop function if exists public.quitar_documento_contratista(uuid, text);
drop function if exists public.guardar_documento_contratista(uuid, jsonb);
drop function if exists public._documentos_contratista(text, boolean);

-- Versiones de 20261222000000_contratistas_tercero.sql.
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

commit;
