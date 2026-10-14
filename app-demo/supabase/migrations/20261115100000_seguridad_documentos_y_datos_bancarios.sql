-- Seguridad de contratos (decisiones del usuario, 2026-10-15; revisión técnica
-- S1 y S2).
--
-- S1. La pestaña Visualización (admin.visualizacion) deja ver los datos de los
--     contratos de sus proyectos en el Control del proyecto, pero NO sus
--     documentos: contrato_documentos y los archivos del bucket `contratos`
--     exigen ahora una pestaña de Contratos (solicitar, preaprobacion,
--     contratos o aprobar_minutas). Antes solo preguntaban si se veía el
--     contrato, y Visualización lo veía.
--
-- S2. Los datos bancarios de los contratistas (banco, tipo y número de cuenta,
--     y el documento "certificación bancaria") solo los ven los roles Director
--     de obra, Legal, Líder Legal y Gerencia (y el Administrador), con la
--     acción nueva `ver_datos_bancarios` (se puede dar a otros roles en la
--     matriz). Cómo:
--       * Nadie lee esas tres columnas directo de la tabla (permiso por
--         columna); quien tiene la acción las pide con
--         datos_bancarios_contratistas(ids).
--       * editar_contratista no cambia los datos bancarios si quien edita no
--         tiene la acción.
--       * El documento y el archivo de la certificación bancaria exigen la
--         acción.
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- S1
drop policy if exists contrato_documentos_select on public.contrato_documentos;
create policy contrato_documentos_select on public.contrato_documentos for select to authenticated
  using (
    exists (select 1 from public.contratos c where c.id = contrato_documentos.contrato_id)
    and (
      (select public.tiene_pestana((select auth.uid()), 'contratos.solicitar'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.contratos'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
    )
  );

drop policy if exists contratos_archivos_select on storage.objects;
create policy contratos_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratos'
    and exists (select 1 from public.contratos c where c.id::text = (storage.foldername(objects.name))[1])
    and (
      (select public.tiene_pestana((select auth.uid()), 'contratos.solicitar'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.contratos'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
    )
  );

-- ---------------------------------------------------------------- S2: acción
insert into public.rol_permisos (rol_id, permiso)
select r.id, 'accion.ver_datos_bancarios'
from public.roles r
where r.clave in ('director_obra', 'legal', 'lider_legal', 'gerencia')
on conflict do nothing;

-- ---------------------------------------------------------------- S2: lectura de los datos bancarios
-- (El permiso por columna va en 20261115200000_columnas_bancarias.sql, que se
-- aplica DESPUÉS de desplegar el código que ya no lee esas columnas.)
create or replace function public.datos_bancarios_contratistas(p_ids uuid[])
returns table(contratista_id uuid, banco text, tipo_cuenta text, numero_cuenta text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'ver_datos_bancarios') then
    return;
  end if;
  return query
  select k.id, k.banco::text, k.tipo_cuenta::text, k.numero_cuenta::text
  from public.contratistas k
  where k.id = any(p_ids);
end;
$$;
revoke all on function public.datos_bancarios_contratistas(uuid[]) from public, anon;
grant execute on function public.datos_bancarios_contratistas(uuid[]) to authenticated;

-- ---------------------------------------------------------------- S2: certificación bancaria
drop policy if exists contratista_documentos_select on public.contratista_documentos;
create policy contratista_documentos_select on public.contratista_documentos for select to authenticated
  using (
    (
      (select public.tiene_pestana((select auth.uid()), 'contratos.contratistas'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
      or (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
      or (select public.tiene_accion((select auth.uid()), 'solicitar_contratos'))
    )
    and (tipo <> 'certificacion_bancaria' or (select public.tiene_accion((select auth.uid()), 'ver_datos_bancarios')))
  );

drop policy if exists contratistas_archivos_select on storage.objects;
create policy contratistas_archivos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'contratistas'
    and (
      (select public.tiene_pestana((select auth.uid()), 'contratos.contratistas'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.preaprobacion'))
      or (select public.tiene_pestana((select auth.uid()), 'contratos.aprobar_minutas'))
      or (select public.tiene_accion((select auth.uid()), 'gestionar_contratistas'))
    )
    and (storage.filename(objects.name) not like 'certificacion_bancaria%'
         or (select public.tiene_accion((select auth.uid()), 'ver_datos_bancarios')))
  );

-- ---------------------------------------------------------------- S2: editar
-- Igual que la versión vigente (20261109100000_editar_contratista.sql), salvo
-- que sin la acción ver_datos_bancarios los datos bancarios no cambian.
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
  -- Sin la acción no se puede reemplazar la certificación bancaria.
  if not v_bancarios then
    v_permitidos := array_remove(v_permitidos, 'certificacion_bancaria');
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
    banco = case when v_bancarios then trim(p_datos->>'banco') else banco end,
    tipo_cuenta = case when v_bancarios then p_datos->>'tipo_cuenta' else tipo_cuenta end,
    numero_cuenta = case when v_bancarios then p_datos->>'numero_cuenta' else numero_cuenta end,
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
$$;
