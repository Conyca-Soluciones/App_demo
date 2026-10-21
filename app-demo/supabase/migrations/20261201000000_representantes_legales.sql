-- Representantes legales de las empresas (2026-10-21, firmas fase 2).
-- Decisiones del usuario:
--   * Cada empresa tiene un representante legal principal y puede tener
--     suplentes. Los registra Subgerencia (acción aprobar_minutas, pestaña
--     Contratos › Representantes legales).
--   * Algunos usan la app (se enlazan a su usuario y firma con su "Mi firma");
--     de los que no, Subgerencia sube la firma.
--   * Su firma la pone la aprobación de Subgerencia sobre la minuta: el
--     representante que firma es el de la minuta (se busca por su cédula entre
--     los activos de la empresa del proyecto). Así el texto y la firma siempre
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
-- Un solo principal activo por empresa; la misma persona una vez por empresa.
create unique index if not exists uq_empresa_representante_principal
  on public.empresa_representantes (empresa_id) where activo and tipo = 'principal';
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

-- ---------------------------------------------------------------- gestión (Subgerencia)
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

-- Todas las empresas con sus representantes (activos e inactivos), con la firma.
create or replace function public.listar_representantes_legales()
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_minutas') then
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

-- Crear (p_id null) o editar. imagen_firma solo cambia si viene la clave
-- (null = quitarla). Un principal nuevo deja inactivo al anterior.
create or replace function public.guardar_representante_legal(p_id uuid, p_empresa_id uuid, p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid := p_id;
  v_tipo text := p_datos->>'tipo';
  v_doc text := regexp_replace(coalesce(p_datos->>'numero_documento', ''), '[^0-9]', '', 'g');
  v_perfil uuid := nullif(p_datos->>'perfil_id', '')::uuid;
  v_empresa uuid := p_empresa_id;
begin
  if not public.tiene_accion(v_uid, 'aprobar_minutas') then
    raise exception 'No tienes permiso para registrar representantes legales.';
  end if;
  if v_tipo not in ('principal', 'suplente') then
    raise exception 'Escoge si es el representante principal o un suplente.';
  end if;
  if length(btrim(coalesce(p_datos->>'nombre', ''))) < 3 then
    raise exception 'Escribe el nombre del representante.';
  end if;
  if v_doc !~ '^[0-9]{4,15}$' then
    raise exception 'El número de documento debe tener solo números (4 a 15).';
  end if;
  if p_datos ? 'imagen_firma' and p_datos->>'imagen_firma' is not null
     and (p_datos->>'imagen_firma' not like 'data:image/png;base64,%' or length(p_datos->>'imagen_firma') > 300000) then
    raise exception 'La firma no es válida.';
  end if;

  if v_id is not null then
    select empresa_id into v_empresa from empresa_representantes where id = v_id for update;
    if not found then
      raise exception 'El representante no existe.';
    end if;
  elsif not exists (select 1 from empresas where id = v_empresa) then
    raise exception 'La empresa no existe.';
  end if;

  if v_tipo = 'principal' then
    update empresa_representantes set activo = false, actualizado_at = now(), actualizado_por = v_uid
     where empresa_id = v_empresa and activo and tipo = 'principal' and id is distinct from v_id;
  end if;

  if v_id is null then
    insert into empresa_representantes (empresa_id, tipo, nombre, tipo_documento, numero_documento, expedida_en,
                                        perfil_id, imagen_firma, actualizado_por)
    values (v_empresa, v_tipo, btrim(p_datos->>'nombre'), coalesce(nullif(p_datos->>'tipo_documento', ''), 'CC'), v_doc,
            nullif(btrim(coalesce(p_datos->>'expedida_en', '')), ''), v_perfil, p_datos->>'imagen_firma', v_uid)
    returning id into v_id;
  else
    update empresa_representantes
       set tipo = v_tipo, nombre = btrim(p_datos->>'nombre'),
           tipo_documento = coalesce(nullif(p_datos->>'tipo_documento', ''), 'CC'), numero_documento = v_doc,
           expedida_en = nullif(btrim(coalesce(p_datos->>'expedida_en', '')), ''), perfil_id = v_perfil,
           imagen_firma = case when p_datos ? 'imagen_firma' then p_datos->>'imagen_firma' else imagen_firma end,
           activo = true, actualizado_at = now(), actualizado_por = v_uid
     where id = v_id;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception 'Ya hay un representante activo con ese documento en la empresa.';
end;
$$;
revoke all on function public.guardar_representante_legal(uuid, uuid, jsonb) from public, anon;
grant execute on function public.guardar_representante_legal(uuid, uuid, jsonb) to authenticated;

create or replace function public.desactivar_representante_legal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tiene_accion(auth.uid(), 'aprobar_minutas') then
    raise exception 'No tienes permiso para cambiar representantes legales.';
  end if;
  update empresa_representantes set activo = false, actualizado_at = now(), actualizado_por = auth.uid()
   where id = p_id;
end;
$$;
revoke all on function public.desactivar_representante_legal(uuid) from public, anon;
grant execute on function public.desactivar_representante_legal(uuid) to authenticated;

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
    raise exception 'El representante legal de la minuta (%) no está registrado como representante de %. Regístralo en Contratos › Representantes legales o devuelve la minuta a Jurídica para corregirlo.',
      coalesce(nullif(concat_ws(', C.C. ', v->>'minuta_nombre', v->>'minuta_documento'), ''), 'sin datos'), v->>'empresa';
  elsif v->>'estado' = 'sin_firma' then
    raise exception 'Falta la firma de %, representante legal de %: súbela en Contratos › Representantes legales.',
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
