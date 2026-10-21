-- Representantes legales de las empresas (2026-10-21, firmas fase 2).
-- Decisiones del usuario:
--   * Cada empresa tiene un representante legal (principal) y un suplente. Sus
--     datos (nombre y documento) se registran en Admin › Empresas, donde se
--     crean las empresas (solo Administrador: guardar_representantes_empresa).
--   * La firma la pone Subgerencia (acción aprobar_minutas) en Contratos ›
--     Firmas de representantes (guardar_firma_representante): la dibuja o la
--     sube; si el representante usa la app, se enlaza a su usuario y firma con
--     su "Mi firma".
--   * La firma se pone en el contrato cuando Subgerencia aprueba la minuta:
--     firma el representante cuya cédula está en la minuta (se busca entre los
--     activos de la empresa del proyecto), así el texto y la firma siempre
--     coinciden. Si la empresa no tiene representantes registrados, la minuta
--     se aprueba como antes (sin firma). Si los tiene y la minuta trae otro, o
--     el representante no tiene firma, no deja aprobar (dice qué falta).
--   * Por ahora solo el contrato (no otrosí ni liquidación).
-- Requiere 20261129000000_firmas y 20261130100000_firmas_ordenes_compra.
-- Se puede correr más de una vez.

create table if not exists public.empresa_representantes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('principal', 'suplente')),
  nombre text not null check (length(btrim(nombre)) between 3 and 200),
  tipo_documento text not null default 'CC' check (tipo_documento in ('CC', 'CE', 'PPT', 'PA')),
  numero_documento text not null check (numero_documento ~ '^[0-9]{4,15}$'),
  expedida_en text,
  perfil_id uuid references public.perfiles(id) on delete set null, -- si usa la app: firma con su "Mi firma"
  imagen_firma text check (imagen_firma is null or (imagen_firma like 'data:image/png;base64,%' and length(imagen_firma) <= 300000)),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id)
);
create index if not exists idx_empresa_representantes_empresa on public.empresa_representantes (empresa_id) where activo;
create index if not exists idx_empresa_representantes_perfil on public.empresa_representantes (perfil_id);
create index if not exists idx_empresa_representantes_actualizado_por on public.empresa_representantes (actualizado_por);
-- Un principal y un suplente activos por empresa; la misma persona una vez.
create unique index if not exists uq_empresa_representante_principal
  on public.empresa_representantes (empresa_id) where activo and tipo = 'principal';
create unique index if not exists uq_empresa_representante_suplente
  on public.empresa_representantes (empresa_id) where activo and tipo = 'suplente';
create unique index if not exists uq_empresa_representante_documento
  on public.empresa_representantes (empresa_id, numero_documento) where activo;
alter table public.empresa_representantes enable row level security;
revoke insert, update, delete on public.empresa_representantes from authenticated;
-- Sin políticas: se lee y escribe con las funciones de abajo (la firma no se expone).

insert into public.rol_permisos (rol_id, permiso)
select distinct rol_id, 'tab.contratos.representantes' from public.rol_permisos
 where permiso = 'tab.contratos.aprobar_minutas'
on conflict do nothing;

alter table public.documento_firmas drop constraint if exists documento_firmas_entidad_check;
alter table public.documento_firmas add constraint documento_firmas_entidad_check
  check (entidad in ('acta', 'poliza', 'orden_compra', 'contrato'));
alter table public.documento_firmas drop constraint if exists documento_firmas_papel_check;
alter table public.documento_firmas add constraint documento_firmas_papel_check
  check (papel in ('elaboro', 'aprobo', 'juridica', 'representante_legal'));
alter table public.documentos_firmados drop constraint if exists documentos_firmados_entidad_check;
alter table public.documentos_firmados add constraint documentos_firmados_entidad_check
  check (entidad in ('acta', 'poliza', 'orden_compra', 'contrato'));

-- ¿Ve el contrato de este proyecto? Misma regla que la política contratos_select
-- (pestañas de contratos o Control del proyecto + el proyecto).
create or replace function public._puede_ver_contrato_rl(p_proyecto_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select (public.tiene_pestana(auth.uid(), 'contratos.solicitar')
          or public.tiene_pestana(auth.uid(), 'contratos.preaprobacion')
          or public.tiene_pestana(auth.uid(), 'contratos.contratos')
          or public.tiene_pestana(auth.uid(), 'contratos.aprobar_minutas')
          or public.tiene_pestana(auth.uid(), 'admin.visualizacion'))
     and public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id);
$$;
revoke all on function public._puede_ver_contrato_rl(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- gestión
create or replace function public._fila_representante(r public.empresa_representantes, p_con_imagen boolean)
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id, 'empresa_id', r.empresa_id, 'tipo', r.tipo, 'nombre', r.nombre,
    'tipo_documento', r.tipo_documento, 'numero_documento', r.numero_documento, 'expedida_en', r.expedida_en,
    'perfil_id', r.perfil_id, 'perfil_nombre', (select p.nombre from perfiles p where p.id = r.perfil_id),
    'firma_de_usuario', exists (select 1 from firmas_usuario f where f.perfil_id = r.perfil_id),
    'tiene_imagen', r.imagen_firma is not null,
    'imagen_firma', case when p_con_imagen then r.imagen_firma end,
    'activo', r.activo, 'actualizado_at', r.actualizado_at);
$$;
revoke all on function public._fila_representante(public.empresa_representantes, boolean) from public, anon, authenticated;

-- Todas las empresas con sus representantes (activos e inactivos), con la
-- firma: Admin › Empresas y Contratos › Firmas de representantes.
create or replace function public.listar_representantes_legales()
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if not (public.tiene_accion(auth.uid(), 'aprobar_minutas') or public.es_admin(auth.uid())) then
    raise exception 'No tienes permiso para ver los representantes legales.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'razon_social', e.razon_social, 'nit', e.nit,
             'representantes', coalesce((
               select jsonb_agg(public._fila_representante(r, true)
                                order by r.activo desc, r.tipo, r.nombre)
                 from empresa_representantes r where r.empresa_id = e.id), '[]'::jsonb))
           order by e.razon_social)
      from empresas e), '[]'::jsonb);
end;
$$;
revoke all on function public.listar_representantes_legales() from public, anon;
grant execute on function public.listar_representantes_legales() to authenticated;

-- Admin › Empresas: el principal y el suplente de una empresa. Cada uno es
-- {nombre, tipo_documento, numero_documento, expedida_en} o null / vacío
-- (= la empresa queda sin él). Con el mismo documento se corrigen los datos y
-- se conserva la firma; con otro, el anterior queda inactivo (los contratos
-- que firmó no cambian) y entra uno nuevo sin firma (o vuelve uno anterior de
-- la empresa con ese documento, con su firma).
create or replace function public._guardar_representante_empresa(p_empresa_id uuid, p_tipo text, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_doc text := regexp_replace(coalesce(p->>'numero_documento', ''), '[^0-9]', '', 'g');
  v_nombre text := btrim(coalesce(p->>'nombre', ''));
  v_tipo_doc text := coalesce(nullif(p->>'tipo_documento', ''), 'CC');
  v_expedida text := nullif(btrim(coalesce(p->>'expedida_en', '')), '');
  v_anterior uuid;
  v_titulo text := case when p_tipo = 'principal' then 'del representante legal' else 'del suplente' end;
begin
  if v_nombre = '' and v_doc = '' then
    return; -- sin él (guardar_representantes_empresa ya dejó inactivo al anterior)
  end if;
  if length(v_nombre) < 3 then
    raise exception 'Escribe el nombre %.', v_titulo;
  end if;
  if v_doc !~ '^[0-9]{4,15}$' then
    raise exception 'El documento % debe tener solo números (4 a 15).', v_titulo;
  end if;
  if v_tipo_doc not in ('CC', 'CE', 'PPT', 'PA') then
    raise exception 'Tipo de documento no válido.';
  end if;

  -- El mismo de antes: se corrigen sus datos (conserva la firma).
  update empresa_representantes
     set nombre = v_nombre, tipo_documento = v_tipo_doc, expedida_en = v_expedida,
         actualizado_at = now(), actualizado_por = v_uid
   where empresa_id = p_empresa_id and activo and tipo = p_tipo and numero_documento = v_doc;
  if found then
    return;
  end if;
  -- ¿Ya fue representante de la empresa con ese documento? Vuelve con su firma.
  select id into v_anterior from empresa_representantes
   where empresa_id = p_empresa_id and numero_documento = v_doc and not activo
   order by actualizado_at desc limit 1;
  if v_anterior is not null then
    update empresa_representantes
       set tipo = p_tipo, nombre = v_nombre, tipo_documento = v_tipo_doc, expedida_en = v_expedida, activo = true,
           actualizado_at = now(), actualizado_por = v_uid
     where id = v_anterior;
  else
    insert into empresa_representantes (empresa_id, tipo, nombre, tipo_documento, numero_documento, expedida_en, actualizado_por)
    values (p_empresa_id, p_tipo, v_nombre, v_tipo_doc, v_doc, v_expedida, v_uid);
  end if;
end;
$$;
revoke all on function public._guardar_representante_empresa(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.guardar_representantes_empresa(p_empresa_id uuid, p_principal jsonb, p_suplente jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.es_admin(auth.uid()) then
    raise exception 'Solo el Administrador registra los representantes legales.';
  end if;
  if not exists (select 1 from empresas where id = p_empresa_id) then
    raise exception 'La empresa no existe.';
  end if;
  if nullif(regexp_replace(coalesce(p_principal->>'numero_documento', ''), '[^0-9]', '', 'g'), '')
     = nullif(regexp_replace(coalesce(p_suplente->>'numero_documento', ''), '[^0-9]', '', 'g'), '') then
    raise exception 'El representante legal y el suplente no pueden ser la misma persona.';
  end if;
  -- Primero quedan inactivos los que cambian de lugar o se van (así un
  -- intercambio principal <-> suplente no choca con los índices únicos y cada
  -- uno vuelve con su firma).
  update empresa_representantes r
     set activo = false, actualizado_at = now(), actualizado_por = auth.uid()
   where r.empresa_id = p_empresa_id and r.activo
     and r.numero_documento is distinct from regexp_replace(coalesce(
           (case when r.tipo = 'principal' then p_principal else p_suplente end)->>'numero_documento', ''), '[^0-9]', '', 'g');
  perform public._guardar_representante_empresa(p_empresa_id, 'suplente', coalesce(p_suplente, '{}'::jsonb));
  perform public._guardar_representante_empresa(p_empresa_id, 'principal', coalesce(p_principal, '{}'::jsonb));
exception
  when unique_violation then
    raise exception 'El representante legal y el suplente no pueden ser la misma persona.';
end;
$$;
revoke all on function public.guardar_representantes_empresa(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.guardar_representantes_empresa(uuid, jsonb, jsonb) to authenticated;

-- Contratos › Firmas de representantes (Subgerencia): la firma de un
-- representante activo y, si usa la app, su usuario. Cada clave solo cambia si
-- viene: imagen_firma (null = quitarla) y perfil_id (null = no usa la app).
create or replace function public.guardar_firma_representante(p_id uuid, p_datos jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_minutas') then
    raise exception 'No tienes permiso para poner la firma de los representantes legales.';
  end if;
  if p_datos ? 'imagen_firma' and p_datos->>'imagen_firma' is not null
     and (p_datos->>'imagen_firma' not like 'data:image/png;base64,%' or length(p_datos->>'imagen_firma') > 300000) then
    raise exception 'La firma no es válida.';
  end if;
  update empresa_representantes
     set imagen_firma = case when p_datos ? 'imagen_firma' then p_datos->>'imagen_firma' else imagen_firma end,
         perfil_id = case when p_datos ? 'perfil_id' then nullif(p_datos->>'perfil_id', '')::uuid else perfil_id end,
         actualizado_at = now(), actualizado_por = auth.uid()
   where id = p_id and activo;
  if not found then
    raise exception 'El representante no existe o ya no está activo (actualiza la página).';
  end if;
end;
$$;
revoke all on function public.guardar_firma_representante(uuid, jsonb) from public, anon;
grant execute on function public.guardar_firma_representante(uuid, jsonb) to authenticated;

-- Versiones anteriores de este archivo (nunca corridas en producción).
drop function if exists public.guardar_representante_legal(uuid, uuid, jsonb);
drop function if exists public.desactivar_representante_legal(uuid);

-- ---------------------------------------------------------------- representante de un contrato
-- Representantes activos de la empresa del proyecto del contrato (sin la
-- imagen de la firma): para llenar la minuta (Jurídica) y ver quién firmará
-- (Subgerencia).
create or replace function public.representantes_de_contrato(p_contrato_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_empresa uuid;
begin
  select p.empresa_id into v_empresa
    from contratos c join proyectos p on p.id = c.proyecto_id
   where c.id = p_contrato_id and public._puede_ver_contrato_rl(c.proyecto_id);
  if not found then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  return coalesce((
    select jsonb_agg(public._fila_representante(r, false) order by r.tipo, r.nombre)
      from empresa_representantes r where r.empresa_id = v_empresa and r.activo), '[]'::jsonb);
end;
$$;
revoke all on function public.representantes_de_contrato(uuid) from public, anon;
grant execute on function public.representantes_de_contrato(uuid) to authenticated;

-- Quién firma como representante legal según la minuta: estado 'ok' (con
-- representante_id e imagen), 'sin_registro' (la empresa no tiene
-- representantes: se aprueba sin firma), 'no_coincide' o 'sin_firma'.
create or replace function public._representante_que_firma(p_contrato_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  c record;
  v_cedula text;
  v_nombre text;
  r record;
  v_imagen text;
begin
  select co.id, co.clase, co.tipo, co.minuta_datos, p.empresa_id, e.razon_social into c
    from contratos co join proyectos p on p.id = co.proyecto_id left join empresas e on e.id = p.empresa_id
   where co.id = p_contrato_id;
  if not found or c.clase = 'general' or c.empresa_id is null
     or not exists (select 1 from empresa_representantes x where x.empresa_id = c.empresa_id and x.activo) then
    return jsonb_build_object('estado', 'sin_registro');
  end if;
  -- Arrendamiento: la empresa es el ARRENDATARIO.
  v_cedula := regexp_replace(coalesce(c.minuta_datos->>(case when c.tipo = 'arrendamiento' then 'arrendatarioCedula'
                                                             else 'contratanteRepresentanteCedula' end), ''), '[^0-9]', '', 'g');
  v_nombre := c.minuta_datos->>(case when c.tipo = 'arrendamiento' then 'arrendatarioRepresentante' else 'contratanteRepresentante' end);
  select x.* into r from empresa_representantes x
   where x.empresa_id = c.empresa_id and x.activo and x.numero_documento = v_cedula
   order by x.tipo = 'principal' desc limit 1;
  if not found then
    return jsonb_build_object('estado', 'no_coincide', 'empresa', c.razon_social,
                              'minuta_nombre', v_nombre, 'minuta_documento', nullif(v_cedula, ''));
  end if;
  select f.imagen into v_imagen from firmas_usuario f where f.perfil_id = r.perfil_id;
  v_imagen := coalesce(v_imagen, r.imagen_firma);
  return jsonb_build_object('estado', case when v_imagen is null then 'sin_firma' else 'ok' end,
                            'representante_id', r.id, 'nombre', r.nombre, 'tipo', r.tipo,
                            'perfil_id', r.perfil_id, 'empresa', c.razon_social, 'imagen', v_imagen);
end;
$$;
revoke all on function public._representante_que_firma(uuid) from public, anon, authenticated;

-- Para la pantalla de Aprobación de contratos (sin la imagen).
create or replace function public.representante_que_firma(p_contrato_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if not exists (select 1 from contratos c where c.id = p_contrato_id and public._puede_ver_contrato_rl(c.proyecto_id)) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  return public._representante_que_firma(p_contrato_id) - 'imagen';
end;
$$;
revoke all on function public.representante_que_firma(uuid) from public, anon;
grant execute on function public.representante_que_firma(uuid) to authenticated;

-- ---------------------------------------------------------------- al aprobar la minuta
create or replace function public._firmar_representante_contrato()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb := public._representante_que_firma(new.id);
begin
  if v->>'estado' = 'sin_registro' then
    return null;
  elsif v->>'estado' = 'no_coincide' then
    raise exception 'El representante legal de la minuta (%) no está registrado como representante de %. Regístralo en Admin › Empresas o devuelve la minuta a Jurídica para corregirlo.',
      coalesce(nullif(concat_ws(', C.C. ', v->>'minuta_nombre', v->>'minuta_documento'), ''), 'sin datos'), v->>'empresa';
  elsif v->>'estado' = 'sin_firma' then
    raise exception 'Falta la firma de %, representante legal de %: ponla en Contratos › Firmas de representantes.',
      v->>'nombre', v->>'empresa';
  end if;
  insert into documento_firmas (entidad, entidad_id, papel, perfil_id, nombre, cargo, imagen, firmado_at)
  values ('contrato', new.id, 'representante_legal', nullif(v->>'perfil_id', '')::uuid, v->>'nombre',
          case when v->>'tipo' = 'suplente' then 'Representante legal suplente' else 'Representante legal' end,
          v->>'imagen', now())
  on conflict (entidad, entidad_id, papel) do update
    set perfil_id = excluded.perfil_id, nombre = excluded.nombre, cargo = excluded.cargo, imagen = excluded.imagen,
        firmado_at = excluded.firmado_at, codigo = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('contrato', new.id, 'firma_representante', auth.uid(),
          jsonb_build_object('representante', v->>'nombre', 'tipo', v->>'tipo'));
  return null;
end;
$$;
revoke all on function public._firmar_representante_contrato() from public, anon, authenticated;
drop trigger if exists trg_firmar_representante_contrato on public.contratos;
create trigger trg_firmar_representante_contrato
  after update of minuta_estado on public.contratos
  for each row when (new.minuta_estado = 'aprobada' and old.minuta_estado is distinct from 'aprobada')
  execute function public._firmar_representante_contrato();

-- ---------------------------------------------------------------- ver y verificar
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
    when 'orden_compra' then exists (select 1 from ordenes_compra o
                                      where o.id = p_id and public.usuario_puede_ver_proyecto(auth.uid(), o.proyecto_id))
    -- Contratos: quien ve el contrato, o quien lo abre desde otrosí / pólizas.
    when 'contrato' then exists (select 1 from contratos c
                                  where c.id = p_id
                                    and (public._puede_ver_contrato_rl(c.proyecto_id)
                                         or (public._puede_ver_otrosis(auth.uid())
                                             and public.usuario_puede_ver_proyecto(auth.uid(), c.proyecto_id))))
    else false end;
$$;
revoke all on function public._puede_ver_documento(text, uuid) from public, anon, authenticated;

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
  elsif v_entidad = 'contrato' then
    select 'Contrato ' || coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero) || ' · ' || k.nombre
      into v_titulo
      from contratos c join contratistas k on k.id = c.contratista_id
     where c.id = v_id;
  elsif v_entidad = 'orden_compra' then
    select 'Orden de compra N° ' || o.numero || coalesce(' · ' || pv.nombre, '')
      into v_titulo
      from ordenes_compra o left join proveedores pv on pv.unique_id = o.proveedor_id
     where o.id = v_id;
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
