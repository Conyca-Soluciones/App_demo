-- Contratos generales (Contratos › Contratos › Contratos generales).
--
-- Un contrato general (como el "Contrato General" de Sinco) no se amarra a
-- ítems del presupuesto: valor global, fechas de inicio y terminación, forma de
-- pago, retenciones (garantías, anticipo, FIC), referencia, descripción y
-- observaciones. Decisiones del usuario (2026-10-15):
--   * Va en la MISMA tabla contratos con clase = 'general' (los de antes son
--     'grupo') y sigue el MISMO camino: el director lo elabora -> Jurídica lo
--     pre-aprueba (Pre aprobación de contratos) -> Subgerencia lo aprueba
--     (Aprobación de contratos). Al aprobarse recibe su número CJ.
--   * No hay minuta larga: el documento es la hoja del contrato (PDF con el
--     formato de Sinco), que la app arma con los datos de la base.
--   * Las actas de los contratos generales se hacen después: por ahora no
--     aparecen en Actas por grupos (buscar_*_para_acta filtran clase 'grupo').
-- Documentos: los mismos del tipo de contrato que en por grupos.
-- Permisos: pestaña contratos.contratos (ver) y acción solicitar_contratos
-- (elaborar), como por grupos. La pestaña se da a los roles que ya tienen la de
-- por grupos.
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- columnas
alter table public.contratos
  add column if not exists clase text not null default 'grupo',
  add column if not exists referencia text,
  add column if not exists retencion_garantia_pct numeric(5,2) not null default 0,
  add column if not exists retencion_anticipo_pct numeric(5,2) not null default 0,
  add column if not exists retencion_fic_pct numeric(5,2) not null default 0;

alter table public.contratos drop constraint if exists contratos_clase_check;
alter table public.contratos add constraint contratos_clase_check check (clase in ('grupo', 'general'));
alter table public.contratos drop constraint if exists contratos_retenciones_check;
alter table public.contratos add constraint contratos_retenciones_check check (
  retencion_garantia_pct between 0 and 100 and retencion_anticipo_pct between 0 and 100 and retencion_fic_pct between 0 and 100
);
create index if not exists idx_contratos_proyecto_clase on public.contratos (proyecto_id, clase);

-- La descripción de un contrato general no tiene que empezar por un verbo
-- (la de por grupos sí: es el objeto de la minuta).
alter table public.contratos drop constraint if exists contratos_objeto_check;
alter table public.contratos add constraint contratos_objeto_check
  check (clase = 'general' or objeto ~* '^\s*[a-záéíóúñü]+(ar|er|ir)\M');

-- ---------------------------------------------------------------- guardar
-- Crear o corregir (p_existente) un contrato general. Mismo patrón que
-- _guardar_solicitud_contrato: todo en una transacción, archivos verificados
-- en Storage, notificación a Jurídica e historial.
create or replace function public._guardar_contrato_general(p_id uuid, p_datos jsonb, p_documentos jsonb, p_existente boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text := p_datos->>'tipo';
  v_proyecto uuid := (p_datos->>'proyecto_id')::uuid;
  v_valor numeric := nullif(p_datos->>'valor', '')::numeric;
  v_inicio date := nullif(p_datos->>'fecha_inicio', '')::date;
  v_fin date := nullif(p_datos->>'fecha_fin', '')::date;
  v_descripcion text := nullif(trim(p_datos->>'objeto'), '');
  v_forma_pago text := nullif(trim(p_datos->>'forma_pago'), '');
  v_correo text := lower(trim(coalesce(p_datos->>'correo_notificacion', '')));
  v_garantia numeric := coalesce(nullif(p_datos->>'retencion_garantia_pct', '')::numeric, 0);
  v_ret_anticipo numeric := coalesce(nullif(p_datos->>'retencion_anticipo_pct', '')::numeric, 0);
  v_fic numeric := coalesce(nullif(p_datos->>'retencion_fic_pct', '')::numeric, 0);
  v_obligatorios text[];
  v_permitidos text[];
  v_faltan text[];
  v_numero bigint;
  v_actual record;
  d jsonb;
begin
  if not public.tiene_accion(auth.uid(), 'solicitar_contratos') then
    raise exception 'No tienes permiso para elaborar contratos.';
  end if;
  if p_id is null or v_proyecto is null then
    raise exception 'Faltan datos del contrato.';
  end if;
  if not public.usuario_puede_ver_proyecto(auth.uid(), v_proyecto) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;

  if p_existente then
    select id, numero, estado, proyecto_id, clase into v_actual from contratos where id = p_id for update;
    if not found or v_actual.clase <> 'general' then
      raise exception 'El contrato no existe.';
    end if;
    if v_actual.estado <> 'devuelta' then
      raise exception 'Solo se puede corregir un contrato devuelto (este está en otro estado; actualiza la página).';
    end if;
    if v_actual.proyecto_id <> v_proyecto then
      raise exception 'El contrato es de otro proyecto.';
    end if;
    delete from contrato_documentos where contrato_id = p_id;
  end if;

  if not exists (select 1 from contratistas where id = (p_datos->>'contratista_id')::uuid) then
    raise exception 'El contratista no existe.';
  end if;
  select obligatorios, permitidos into v_obligatorios, v_permitidos from public.documentos_tipo_contrato(v_tipo);
  if v_obligatorios is null then
    raise exception 'Tipo de contrato no válido.';
  end if;
  if v_valor is null or v_valor <= 0 then
    raise exception 'Escribe el valor del contrato.';
  end if;
  if v_inicio is null or v_fin is null then
    raise exception 'Escribe las fechas de inicio y de terminación.';
  end if;
  if v_fin < v_inicio then
    raise exception 'La fecha de terminación es anterior a la de inicio.';
  end if;
  if v_descripcion is null or length(v_descripcion) < 5 then
    raise exception 'Escribe la descripción del contrato.';
  end if;
  if v_forma_pago is null then
    raise exception 'Escribe la forma de pago.';
  end if;
  if v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Escribe un correo de notificación válido.';
  end if;
  if v_garantia not between 0 and 100 or v_ret_anticipo not between 0 and 100 or v_fic not between 0 and 100 then
    raise exception 'Los porcentajes de retención van entre 0 y 100.';
  end if;

  if jsonb_typeof(p_documentos) is distinct from 'array' then
    raise exception 'Faltan los documentos.';
  end if;
  select array_agg(r) into v_faltan
  from unnest(v_obligatorios) r
  where not exists (select 1 from jsonb_array_elements(p_documentos) e where e->>'tipo' = r);
  if v_faltan is not null then
    raise exception 'Faltan documentos obligatorios: %.', array_to_string(v_faltan, ', ');
  end if;
  if (select count(distinct e->>'tipo') from jsonb_array_elements(p_documentos) e) <> jsonb_array_length(p_documentos) then
    raise exception 'Hay un documento repetido.';
  end if;
  for d in select * from jsonb_array_elements(p_documentos) loop
    if not (d->>'tipo' = any (v_permitidos)) then
      raise exception 'El documento "%" no aplica para este tipo de contrato.', d->>'tipo';
    end if;
    if left(d->>'ruta', 37) is distinct from p_id::text || '/' then
      raise exception 'La ruta del documento no corresponde a este contrato.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'contratos' and o.name = d->>'ruta') then
      raise exception 'No se encontró el archivo de "%". Vuelve a adjuntarlo.', d->>'tipo';
    end if;
  end loop;

  if p_existente then
    update contratos set
      contratista_id = (p_datos->>'contratista_id')::uuid,
      tipo = v_tipo,
      estado = 'pre_aprobacion',
      objeto = v_descripcion,
      valor = round(v_valor, 2),
      forma_pago = v_forma_pago,
      fecha_inicio = v_inicio,
      fecha_fin = v_fin,
      correo_notificacion = v_correo,
      observaciones = nullif(trim(p_datos->>'observaciones'), ''),
      referencia = nullif(trim(p_datos->>'referencia'), ''),
      retencion_garantia_pct = round(v_garantia, 2),
      retencion_anticipo_pct = round(v_ret_anticipo, 2),
      retencion_fic_pct = round(v_fic, 2),
      enviado_at = now()
    where id = p_id;
    v_numero := v_actual.numero;
  else
    insert into contratos (
      id, clase, proyecto_id, contratista_id, tipo, objeto, valor, anexo_tipo, tiene_anticipo,
      forma_pago, plazo_tipo, fecha_inicio, fecha_fin, correo_notificacion, observaciones,
      referencia, retencion_garantia_pct, retencion_anticipo_pct, retencion_fic_pct
    ) values (
      p_id, 'general', v_proyecto, (p_datos->>'contratista_id')::uuid, v_tipo, v_descripcion, round(v_valor, 2), 'valor_global', false,
      v_forma_pago, 'fechas', v_inicio, v_fin, v_correo, nullif(trim(p_datos->>'observaciones'), ''),
      nullif(trim(p_datos->>'referencia'), ''), round(v_garantia, 2), round(v_ret_anticipo, 2), round(v_fic, 2)
    )
    returning numero into v_numero;
  end if;

  insert into contrato_documentos (contrato_id, tipo, ruta, nombre_archivo, tamano, mime)
  select p_id, e->>'tipo', e->>'ruta', e->>'nombre_archivo', (e->>'tamano')::bigint, e->>'mime'
  from jsonb_array_elements(p_documentos) e;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('contrato', p_id, case when p_existente then 'reenviada' else 'creada' end, auth.uid(),
          jsonb_build_object('valor', round(v_valor, 2), 'clase', 'general'));

  perform public._notificar_aprobadores_contrato(
    p_id,
    case when p_existente then 'Contrato general corregido' else 'Nuevo contrato general' end,
    'Contrato general N° ' || v_numero || ' por revisar en pre-aprobación.'
  );

  return v_numero;
end;
$$;
revoke all on function public._guardar_contrato_general(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;

create or replace function public.crear_contrato_general(p_id uuid, p_datos jsonb, p_documentos jsonb)
returns bigint
language sql
security definer
set search_path = public
as $$
  select public._guardar_contrato_general(p_id, p_datos, p_documentos, false)
$$;
revoke all on function public.crear_contrato_general(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.crear_contrato_general(uuid, jsonb, jsonb) to authenticated;

create or replace function public.reenviar_contrato_general(p_id uuid, p_datos jsonb, p_documentos jsonb)
returns bigint
language sql
security definer
set search_path = public
as $$
  select public._guardar_contrato_general(p_id, p_datos, p_documentos, true)
$$;
revoke all on function public.reenviar_contrato_general(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.reenviar_contrato_general(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- permisos
-- La pestaña Contratos generales, a los roles que ya tienen Contratos por grupos.
insert into public.rol_permisos (rol_id, permiso)
select rp.rol_id, 'tab.contratos.contratos'
from public.rol_permisos rp
where rp.permiso = 'tab.contratos.solicitar'
on conflict do nothing;

-- ---------------------------------------------------------------- actas
-- Las actas de contratos generales se hacen después: Actas por grupos solo
-- busca contratos por grupos.
create or replace function public.buscar_contratistas_para_acta(p_texto text)
returns table(contratista_id uuid, nombre text, documento text, contratos integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.cortes') then
    raise exception 'No tienes permiso para ver actas.';
  end if;
  if v_texto is null then
    return;
  end if;

  return query
  select k.id, k.nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
         count(*)::int
  from contratistas k
  join contratos c on c.contratista_id = k.id
  where c.estado = 'aprobada' and c.minuta_estado = 'aprobada' and c.clase = 'grupo'
    and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (v_texto = '_' or k.nombre ilike '%' || v_texto || '%' or k.numero_documento ilike '%' || v_texto || '%')
  group by k.id, k.nombre, k.tipo_documento, k.numero_documento, k.digito_verificacion
  order by k.nombre
  limit 50;
end;
$$;

create or replace function public.buscar_contratos_para_acta(p_texto text default null, p_contratista_id uuid default null)
returns table(contrato_id uuid, numero_contrato text, numero bigint, tipo text, objeto text, valor numeric,
              proyecto_codigo text, proyecto_nombre text, contratista_id uuid, contratista_nombre text,
              contratista_documento text, actas integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.cortes') then
    raise exception 'No tienes permiso para ver actas.';
  end if;
  if p_contratista_id is null and v_texto is null then
    return;
  end if;

  return query
  select c.id, c.numero_contrato, c.numero, c.tipo, c.objeto, c.valor,
         p.codigo, p.nombre, k.id, k.nombre,
         k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
         (select count(*)::int from actas a where a.contrato_id = c.id)
  from contratos c
  join contratistas k on k.id = c.contratista_id
  join proyectos p on p.id = c.proyecto_id
  where c.estado = 'aprobada' and c.minuta_estado = 'aprobada' and c.clase = 'grupo'
    and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id)
    and (p_contratista_id is null or c.contratista_id = p_contratista_id)
    and (
      v_texto is null or v_texto = '_'
      or c.numero_contrato ilike '%' || v_texto || '%'
      or c.objeto ilike '%' || v_texto || '%'
      or k.nombre ilike '%' || v_texto || '%'
      or k.numero_documento ilike '%' || v_texto || '%'
    )
  order by c.numero desc
  limit 50;
end;
$$;
