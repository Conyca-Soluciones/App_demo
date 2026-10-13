-- Editar contratistas (Contratos › Contratistas, 2026-10-14).
--
-- Quien tiene la acción gestionar_contratistas puede corregir los datos de un
-- contratista y reemplazar o agregar sus documentos generales. El tipo de
-- persona no cambia (natural y jurídica piden documentos distintos: si está
-- mal, se crea otro contratista).
--
-- Los archivos nuevos ya los subió el navegador a `contratistas/<id>/...`;
-- editar_contratista valida todo, actualiza los datos, cambia el documento de
-- cada tipo que llegue (uno vigente por tipo) y devuelve las rutas de los
-- archivos reemplazados: el navegador los borra después (la política de
-- borrado solo deja borrar archivos que ya no son documento de nadie).
-- Requiere 20261109000000_datos_minuta_solicitud.sql (cedula_expedida_en).
-- Se puede correr más de una vez.

alter table public.contratistas add column if not exists updated_by uuid references public.perfiles(id);
create index if not exists idx_contratistas_updated_by on public.contratistas (updated_by);

create or replace function public.editar_contratista(p_id uuid, p_datos jsonb, p_documentos jsonb)
 returns text[]
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_actual record;
  v_permitidos text[];
  v_viejas text[] := '{}';
  v_vieja text;
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'gestionar_contratistas') then
    raise exception 'No tienes permiso para editar contratistas.';
  end if;

  select id, tipo_persona into v_actual from contratistas where id = p_id for update;
  if not found then
    raise exception 'El contratista no existe.';
  end if;
  if p_datos->>'tipo_persona' is distinct from v_actual.tipo_persona then
    raise exception 'El tipo de persona no se puede cambiar.';
  end if;
  if nullif(trim(p_datos->>'cedula_expedida_en'), '') is null then
    raise exception 'Escribe dónde se expidió la cédula.';
  end if;

  if v_actual.tipo_persona = 'natural' then
    v_permitidos := array['cedula', 'rut', 'certificacion_bancaria', 'autorizacion_datos', 'hoja_vida'];
  else
    v_permitidos := array['camara_comercio', 'rut', 'cedula_representante', 'certificacion_bancaria',
                          'autorizacion_datos', 'consulta_oficial_cumplimiento'];
  end if;

  if jsonb_typeof(coalesce(p_documentos, '[]')) is distinct from 'array' then
    raise exception 'Los documentos no son válidos.';
  end if;
  if (select count(distinct e->>'tipo') from jsonb_array_elements(coalesce(p_documentos, '[]')) e)
     <> jsonb_array_length(coalesce(p_documentos, '[]')) then
    raise exception 'Hay un documento repetido.';
  end if;
  for d in select * from jsonb_array_elements(coalesce(p_documentos, '[]')) loop
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

  -- Los CHECK de la tabla validan el resto (NIT y DV, correo, teléfono,
  -- cuenta...); el documento repetido sale como 23505.
  update contratistas set
    tipo_documento = p_datos->>'tipo_documento',
    numero_documento = p_datos->>'numero_documento',
    digito_verificacion = nullif(p_datos->>'digito_verificacion', '')::smallint,
    nombre = trim(p_datos->>'nombre'),
    representante_nombre = case when v_actual.tipo_persona = 'juridica' then nullif(trim(p_datos->>'representante_nombre'), '') end,
    representante_tipo_documento = case when v_actual.tipo_persona = 'juridica' then nullif(p_datos->>'representante_tipo_documento', '') end,
    representante_numero_documento = case when v_actual.tipo_persona = 'juridica' then nullif(p_datos->>'representante_numero_documento', '') end,
    cedula_expedida_en = trim(p_datos->>'cedula_expedida_en'),
    correo = lower(trim(p_datos->>'correo')),
    telefono = p_datos->>'telefono',
    direccion = trim(p_datos->>'direccion'),
    ciudad = trim(p_datos->>'ciudad'),
    banco = trim(p_datos->>'banco'),
    tipo_cuenta = p_datos->>'tipo_cuenta',
    numero_cuenta = p_datos->>'numero_cuenta',
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_id;

  -- Un documento vigente por tipo: el nuevo reemplaza al anterior.
  for d in select * from jsonb_array_elements(coalesce(p_documentos, '[]')) loop
    delete from contratista_documentos
    where contratista_id = p_id and tipo = d->>'tipo'
    returning ruta into v_vieja;
    if v_vieja is not null and v_vieja <> d->>'ruta' then
      v_viejas := v_viejas || v_vieja;
    end if;
    v_vieja := null;
    insert into contratista_documentos (contratista_id, tipo, ruta, nombre_archivo, tamano, mime)
    values (p_id, d->>'tipo', d->>'ruta', d->>'nombre_archivo', (d->>'tamano')::bigint, d->>'mime');
  end loop;

  return v_viejas;
end;
$function$;

revoke all on function public.editar_contratista(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.editar_contratista(uuid, jsonb, jsonb) to authenticated;
