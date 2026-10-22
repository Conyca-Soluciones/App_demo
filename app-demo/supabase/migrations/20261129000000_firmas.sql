-- Firmas electrónicas, fase 1 (2026-10-21).
--
-- * Cada usuario registra SU firma (dibujada en pantalla o foto con el fondo
--   limpio): firmas_usuario, una por usuario, PNG en data URL (pocos KB). Solo
--   la lee su dueño; se escribe con guardar_mi_firma / borrar_mi_firma.
-- * Al aprobar un documento se COPIA la firma de cada firmante en
--   documento_firmas (nombre, cargo = rol, imagen, fecha y hora, código). Si
--   después alguien cambia su firma, los documentos ya firmados no cambian.
--     - Acta de obra (se aprueba con su pago en A&F, _aprobar_acta): "elaboró"
--       (quien la hizo) y "aprobó" (quien aprobó). No exige firma: quien no
--       la tenga sale solo con su nombre (no traba los pagos).
--     - Acta de aprobación de póliza: "jurídica" (quien la aprueba). SÍ exige
--       firma: sin ella no se aprueba la póliza.
-- * El PDF del documento firmado se congela la primera vez que se genera
--   (servidor, con la service role): bucket privado documentos_firmados +
--   documentos_firmados (ruta y SHA-256). Desde ahí siempre sale ese mismo
--   archivo y verificar_documento dice si un PDF es el original.
-- * El contratista firma en papel: copia escaneada como soporte del acta
--   aprobada (tipo 'firmada_contratista', subir_acta_firmada_contratista).
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- firma de cada usuario
create table if not exists public.firmas_usuario (
  perfil_id uuid primary key references public.perfiles(id) on delete cascade,
  imagen text not null check (imagen like 'data:image/png;base64,%' and length(imagen) <= 300000),
  actualizada_at timestamptz not null default now()
);
alter table public.firmas_usuario enable row level security;
revoke insert, update, delete on public.firmas_usuario from authenticated;
drop policy if exists firmas_usuario_select on public.firmas_usuario;
create policy firmas_usuario_select on public.firmas_usuario for select to authenticated
  using (perfil_id = (select auth.uid()));

create or replace function public.guardar_mi_firma(p_imagen text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Inicia sesión para guardar tu firma.';
  end if;
  if p_imagen is null or p_imagen not like 'data:image/png;base64,%' or length(p_imagen) > 300000
     or length(p_imagen) < 200 then
    raise exception 'La firma no es válida: dibújala o sube la foto otra vez.';
  end if;
  insert into firmas_usuario (perfil_id, imagen, actualizada_at) values (v_uid, p_imagen, v_at)
  on conflict (perfil_id) do update set imagen = excluded.imagen, actualizada_at = excluded.actualizada_at;
  return v_at;
end;
$$;
revoke all on function public.guardar_mi_firma(text) from public, anon;
grant execute on function public.guardar_mi_firma(text) to authenticated;

create or replace function public.borrar_mi_firma()
returns void
language sql
security definer
set search_path = public
as $$
  delete from firmas_usuario where perfil_id = auth.uid();
$$;
revoke all on function public.borrar_mi_firma() from public, anon;
grant execute on function public.borrar_mi_firma() to authenticated;

-- ---------------------------------------------------------------- firmas de cada documento
create table if not exists public.documento_firmas (
  id uuid primary key default gen_random_uuid(),
  entidad text not null check (entidad in ('acta', 'poliza')),
  entidad_id uuid not null,
  papel text not null check (papel in ('elaboro', 'aprobo', 'juridica')),
  perfil_id uuid references public.perfiles(id) on delete set null,
  nombre text not null,
  cargo text,
  imagen text, -- null = el firmante no tenía firma registrada (sale solo el nombre)
  codigo text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  firmado_at timestamptz not null default now(),
  unique (entidad, entidad_id, papel)
);
create index if not exists idx_documento_firmas_perfil on public.documento_firmas (perfil_id);
alter table public.documento_firmas enable row level security;
revoke insert, update, delete on public.documento_firmas from authenticated;
-- Sin políticas: se lee con firmas_de_documento / verificar_documento.

create or replace function public._firmar_documento(p_entidad text, p_id uuid, p_papel text, p_perfil uuid, p_exigir boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_cargo text;
  v_imagen text;
begin
  if p_perfil is null then
    return;
  end if;
  select p.nombre, r.nombre, f.imagen into v_nombre, v_cargo, v_imagen
    from perfiles p
    left join roles r on r.id = p.rol_id
    left join firmas_usuario f on f.perfil_id = p.id
   where p.id = p_perfil;
  if p_exigir and v_imagen is null then
    raise exception 'Para aprobar necesitas registrar tu firma: haz clic en tu nombre (arriba a la derecha) › Mi firma.';
  end if;
  insert into documento_firmas (entidad, entidad_id, papel, perfil_id, nombre, cargo, imagen, firmado_at)
  values (p_entidad, p_id, p_papel, p_perfil, coalesce(v_nombre, 'Usuario'), v_cargo, v_imagen, now())
  on conflict (entidad, entidad_id, papel) do update
    set perfil_id = excluded.perfil_id, nombre = excluded.nombre, cargo = excluded.cargo,
        imagen = excluded.imagen, firmado_at = excluded.firmado_at,
        codigo = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
end;
$$;
revoke all on function public._firmar_documento(text, uuid, text, uuid, boolean) from public, anon, authenticated;

-- Acta aprobada (por su pago en A&F, o sola si el neto no es positivo).
create or replace function public._firmar_acta_aprobada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._firmar_documento('acta', new.id, 'elaboro', new.creado_por, false);
  perform public._firmar_documento('acta', new.id, 'aprobo', coalesce(new.resuelto_por, auth.uid()), false);
  return null;
end;
$$;
revoke all on function public._firmar_acta_aprobada() from public, anon, authenticated;
drop trigger if exists trg_firmar_acta_aprobada on public.actas;
create trigger trg_firmar_acta_aprobada
  after update of estado on public.actas
  for each row when (new.estado = 'aprobada' and old.estado is distinct from 'aprobada')
  execute function public._firmar_acta_aprobada();

-- Póliza aprobada por Jurídica: firma el acta de aprobación (obligatoria).
create or replace function public._firmar_poliza_aprobada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._firmar_documento('poliza', new.id, 'juridica', coalesce(new.resuelta_por, auth.uid()), true);
  return null;
end;
$$;
revoke all on function public._firmar_poliza_aprobada() from public, anon, authenticated;
drop trigger if exists trg_firmar_poliza_aprobada on public.contrato_polizas;
create trigger trg_firmar_poliza_aprobada
  after update of estado on public.contrato_polizas
  for each row when (new.estado = 'aprobada' and old.estado is distinct from 'aprobada')
  execute function public._firmar_poliza_aprobada();

-- ---------------------------------------------------------------- PDF congelado
-- Lo escribe solo el servidor (service role) con lo que la base devuelve: nadie
-- puede registrar un PDF hecho por él.
create table if not exists public.documentos_firmados (
  entidad text not null check (entidad in ('acta', 'poliza')),
  entidad_id uuid not null,
  ruta text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  tamano bigint,
  created_at timestamptz not null default now(),
  primary key (entidad, entidad_id)
);
create index if not exists idx_documentos_firmados_sha on public.documentos_firmados (sha256);
alter table public.documentos_firmados enable row level security;
revoke insert, update, delete on public.documentos_firmados from authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos_firmados', 'documentos_firmados', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
-- Sin políticas para authenticated: solo la service role lee y escribe.

-- ¿Puede el usuario ver este documento?
create or replace function public._puede_ver_documento(p_entidad text, p_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select case p_entidad
    when 'acta' then exists (select 1 from actas a join contratos c on c.id = a.contrato_id
                              where a.id = p_id and public.puede_ver_actas(c.proyecto_id))
    when 'poliza' then public._puede_ver_polizas(auth.uid())
                       and exists (select 1 from contrato_polizas o join contratos c on c.id = o.contrato_id
                                    where o.id = p_id and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id))
    else false end;
$$;
revoke all on function public._puede_ver_documento(text, uuid) from public, anon, authenticated;

-- Firmas y PDF congelado de un documento (lo que el PDF necesita, en una llamada).
create or replace function public.firmas_de_documento(p_entidad text, p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public._puede_ver_documento(p_entidad, p_id) then
    raise exception 'El documento no existe o no tienes acceso.';
  end if;
  return jsonb_build_object(
    'firmas', coalesce((
      select jsonb_agg(jsonb_build_object('papel', f.papel, 'nombre', f.nombre, 'cargo', f.cargo, 'imagen', f.imagen,
                                          'codigo', f.codigo, 'firmado_at', f.firmado_at) order by f.firmado_at)
        from documento_firmas f where f.entidad = p_entidad and f.entidad_id = p_id), '[]'::jsonb),
    'congelado', (select jsonb_build_object('ruta', d.ruta, 'sha256', d.sha256, 'created_at', d.created_at)
                    from documentos_firmados d where d.entidad = p_entidad and d.entidad_id = p_id));
end;
$$;
revoke all on function public.firmas_de_documento(text, uuid) from public, anon;
grant execute on function public.firmas_de_documento(text, uuid) to authenticated;

-- Verificar: por la huella SHA-256 del archivo o por el código impreso en la
-- firma. Devuelve qué documento es y quién lo firmó (no su contenido).
create or replace function public.verificar_documento(p_sha256 text default null, p_codigo text default null)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_entidad text;
  v_id uuid;
  v_original boolean := false;
  v_titulo text;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para verificar documentos.';
  end if;
  if p_sha256 is not null then
    select d.entidad, d.entidad_id into v_entidad, v_id from documentos_firmados d where d.sha256 = lower(p_sha256);
    v_original := found;
  elsif p_codigo is not null then
    select f.entidad, f.entidad_id into v_entidad, v_id
      from documento_firmas f where f.codigo = upper(regexp_replace(p_codigo, '[^A-Za-z0-9]', '', 'g'));
  end if;
  if v_id is null then
    return null;
  end if;

  if v_entidad = 'acta' then
    select case a.tipo when 'final' then 'Acta final' when 'liquidacion' then 'Acta de liquidación' else 'Acta parcial' end
           || ' N° ' || a.numero || ' · contrato ' || coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero)
           || ' · ' || k.nombre
      into v_titulo
      from actas a join contratos c on c.id = a.contrato_id join contratistas k on k.id = c.contratista_id
     where a.id = v_id;
  else
    select 'Acta de aprobación de póliza · contrato ' || coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero)
           || ' · ' || k.nombre
      into v_titulo
      from contrato_polizas o join contratos c on c.id = o.contrato_id join contratistas k on k.id = c.contratista_id
     where o.id = v_id;
  end if;

  return jsonb_build_object(
    'entidad', v_entidad, 'titulo', v_titulo, 'archivo_original', v_original,
    'congelado_at', (select d.created_at from documentos_firmados d where d.entidad = v_entidad and d.entidad_id = v_id),
    'firmas', coalesce((
      select jsonb_agg(jsonb_build_object('papel', f.papel, 'nombre', f.nombre, 'cargo', f.cargo,
                                          'codigo', f.codigo, 'firmado_at', f.firmado_at,
                                          'con_imagen', f.imagen is not null) order by f.firmado_at)
        from documento_firmas f where f.entidad = v_entidad and f.entidad_id = v_id), '[]'::jsonb));
end;
$$;
revoke all on function public.verificar_documento(text, text) from public, anon;
grant execute on function public.verificar_documento(text, text) to authenticated;

-- ---------------------------------------------------------------- copia firmada por el contratista
alter table public.acta_soportes drop constraint if exists acta_soportes_tipo_check;
alter table public.acta_soportes add constraint acta_soportes_tipo_check
  check (tipo in ('factura', 'memoria', 'foto', 'otro', 'firmada_contratista'));

-- Acta APROBADA: la copia impresa que firmó el contratista, escaneada. Una por
-- acta: subir otra reemplaza la anterior (devuelve su ruta para borrar el archivo).
create or replace function public.subir_acta_firmada_contratista(p_acta_id uuid, p_soporte jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_anterior text;
begin
  if not public.tiene_accion(auth.uid(), 'elaborar_actas') then
    raise exception 'No tienes permiso para subir la copia firmada.';
  end if;
  select a.id, a.estado, c.proyecto_id into v
    from actas a join contratos c on c.id = a.contrato_id where a.id = p_acta_id for update of a;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El acta no existe o no tienes acceso.';
  end if;
  if v.estado <> 'aprobada' then
    raise exception 'La copia firmada por el contratista se sube cuando el acta está aprobada.';
  end if;
  if coalesce(p_soporte->>'mime', '') not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Sube la copia en PDF, JPG o PNG.';
  end if;

  delete from acta_soportes s where s.acta_id = p_acta_id and s.tipo = 'firmada_contratista'
  returning s.ruta into v_anterior;
  perform public._agregar_soportes_acta(p_acta_id, jsonb_build_array(p_soporte || jsonb_build_object('tipo', 'firmada_contratista')));

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('acta', p_acta_id, 'firmada_contratista', auth.uid(),
          jsonb_build_object('nombre_archivo', p_soporte->>'nombre_archivo', 'reemplaza', v_anterior is not null));
  return jsonb_build_object('ruta_anterior', v_anterior);
end;
$$;
revoke all on function public.subir_acta_firmada_contratista(uuid, jsonb) from public, anon;
grant execute on function public.subir_acta_firmada_contratista(uuid, jsonb) to authenticated;
