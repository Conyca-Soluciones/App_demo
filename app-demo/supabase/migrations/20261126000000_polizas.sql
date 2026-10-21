-- ---------------------------------------------------------------------------
-- Pólizas de los contratos (2026-10-21, pedido del usuario).
--   * Todo contrato que Subgerencia aprueba (minuta aprobada) queda con
--     contratos.poliza_estado = 'pendiente' y se avisa (campanita) al director
--     que pidió el contrato. contratos.estado / minuta_estado no cambian.
--   * El ingeniero (pestaña contratos.polizas) busca el contrato y sube el
--     archivo de la póliza: 'recibida'. Jurídica (pestaña
--     contratos.aprobar_polizas + acción aprobar_contratos) la ve con el
--     contrato y el contratista y la aprueba ('aprobada') o la devuelve con
--     motivo (vuelve a 'pendiente' y se sube otra).
--   * Sin póliza aprobada no se hacen actas (contrato_para_acta /
--     _guardar_acta).
--   * Solo el archivo (PDF, JPG o PNG, 10 MB), sin número ni vigencia
--     (decisión del usuario). Cada subida queda en contrato_polizas (historial).
--   * Los contratos ya aprobados y sin liquidar quedan pendientes y se avisa.
-- Requiere 20261123000000 (contrato_para_acta y _guardar_acta de esa versión).
-- ---------------------------------------------------------------------------

alter table public.contratos add column if not exists poliza_estado text;
alter table public.contratos drop constraint if exists contratos_poliza_estado_check;
alter table public.contratos add constraint contratos_poliza_estado_check
  check (poliza_estado is null or poliza_estado in ('pendiente', 'recibida', 'aprobada'));

create table if not exists public.contrato_polizas (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  proyecto_id uuid not null references public.proyectos(id),
  ruta text not null unique,
  nombre_archivo text not null,
  tamano bigint not null,
  mime text not null,
  estado text not null default 'por_revisar' check (estado in ('por_revisar', 'aprobada', 'devuelta')),
  motivo text,
  subida_por uuid references public.perfiles(id),
  created_at timestamptz not null default now(),
  resuelta_por uuid references public.perfiles(id),
  resuelta_at timestamptz
);
create index if not exists idx_contrato_polizas_contrato on public.contrato_polizas (contrato_id, created_at desc);
create index if not exists idx_contrato_polizas_estado on public.contrato_polizas (estado, created_at);
-- Una sola póliza por revisar por contrato.
create unique index if not exists contrato_polizas_una_por_revisar
  on public.contrato_polizas (contrato_id) where estado = 'por_revisar';

-- ---------------------------------------------------------------- permisos
insert into public.rol_permisos (rol_id, permiso)
select distinct rol_id, 'tab.contratos.polizas' from public.rol_permisos
 where permiso in ('tab.contratos.cortes', 'tab.contratos.solicitar')
on conflict do nothing;
insert into public.rol_permisos (rol_id, permiso)
select distinct rol_id, 'tab.contratos.aprobar_polizas' from public.rol_permisos
 where permiso = 'tab.contratos.preaprobacion'
on conflict do nothing;

-- Quien tiene una pestaña de pólizas también ve los otrosí y el PDF del
-- contrato (para la vista previa en Aprobación de pólizas).
create or replace function public._puede_ver_otrosis(p_uid uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select public.tiene_pestana(p_uid, 'contratos.solicitar_otrosi')
      or public.tiene_pestana(p_uid, 'contratos.aprobar_otrosi')
      or public.tiene_pestana(p_uid, 'contratos.solicitar')
      or public.tiene_pestana(p_uid, 'contratos.contratos')
      or public.tiene_pestana(p_uid, 'contratos.preaprobacion')
      or public.tiene_pestana(p_uid, 'contratos.aprobar_minutas')
      or public.tiene_pestana(p_uid, 'contratos.cortes')
      or public.tiene_pestana(p_uid, 'contratos.aprobar_actas')
      or public.tiene_pestana(p_uid, 'admin.visualizacion')
      or public.tiene_pestana(p_uid, 'contratos.polizas')
      or public.tiene_pestana(p_uid, 'contratos.aprobar_polizas')
$$;

-- Ver pólizas: las pestañas de pólizas y las que ya ven contratos.
create or replace function public._puede_ver_polizas(p_uid uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select public._puede_ver_otrosis(p_uid)
$$;
revoke all on function public._puede_ver_polizas(uuid) from public, anon;
grant execute on function public._puede_ver_polizas(uuid) to authenticated;

alter table public.contrato_polizas enable row level security;
drop policy if exists contrato_polizas_select on public.contrato_polizas;
create policy contrato_polizas_select on public.contrato_polizas for select to authenticated
  using (
    (select public._puede_ver_polizas((select auth.uid())))
    and proyecto_id in (select public.proyectos_visibles((select auth.uid())))
  );
-- Sin insert/update/delete: todo pasa por las funciones de abajo.

-- ---------------------------------------------------------------- archivos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('polizas', 'polizas', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿La ruta ya es una póliza registrada? (sin pasar por la RLS de la tabla).
create or replace function public._ruta_poliza_registrada(p_ruta text)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (select 1 from contrato_polizas where ruta = p_ruta)
$$;
revoke all on function public._ruta_poliza_registrada(text) from public, anon;
grant execute on function public._ruta_poliza_registrada(text) to authenticated;

-- Ruta: <contrato_id>/<marca>.<ext>. Leer = poder ver esa póliza (RLS de la
-- tabla); subir = pestaña Pólizas; borrar = solo archivos que todavía no son
-- póliza de nadie (limpieza si falla el registro).
drop policy if exists polizas_archivos_select on storage.objects;
create policy polizas_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'polizas' and exists (select 1 from public.contrato_polizas p where p.ruta = objects.name));
drop policy if exists polizas_archivos_insert on storage.objects;
create policy polizas_archivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'polizas' and (select public.tiene_pestana((select auth.uid()), 'contratos.polizas')));
drop policy if exists polizas_archivos_delete on storage.objects;
create policy polizas_archivos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'polizas'
    and (select public.tiene_pestana((select auth.uid()), 'contratos.polizas'))
    and not public._ruta_poliza_registrada(objects.name)
  );

-- ---------------------------------------------------------------- avisos
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo = any (array[
    'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
    'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar',
    'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada',
    'minuta_por_revisar', 'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido',
    'contrato_vencido_juridica', 'insumo_rechazado', 'otrosi_por_revisar', 'otrosi_por_aprobar',
    'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado', 'otrosi_devuelto_subgerencia',
    'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta'])) not valid;

-- ---------------------------------------------------------------- estado al aprobar
-- Subgerencia aprueba la minuta -> póliza pendiente.
create or replace function public._poliza_al_aprobar_minuta()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.minuta_estado = 'aprobada' and old.minuta_estado is distinct from 'aprobada'
     and new.estado = 'aprobada' and new.poliza_estado is null and new.liquidado_at is null then
    new.poliza_estado := 'pendiente';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_poliza_al_aprobar_minuta on public.contratos;
create trigger trg_poliza_al_aprobar_minuta
  before update of minuta_estado on public.contratos
  for each row execute function public._poliza_al_aprobar_minuta();

-- La primera vez que queda pendiente, aviso al director que pidió el contrato
-- (las devoluciones avisan desde resolver_poliza, con el motivo).
create or replace function public._avisar_poliza_pendiente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.poliza_estado = 'pendiente' and old.poliza_estado is null and new.solicitado_por is not null then
    insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
    values (new.solicitado_por, 'poliza_pendiente', 'contrato', new.id, 'Póliza pendiente',
            'El contrato ' || coalesce(new.numero_contrato, 'N° ' || new.numero)
              || ' está aprobado: falta subir su póliza (Contratos › Pólizas).');
  end if;
  return null;
end;
$$;
drop trigger if exists trg_avisar_poliza_pendiente on public.contratos;
create trigger trg_avisar_poliza_pendiente
  after update on public.contratos
  for each row when (new.poliza_estado is distinct from old.poliza_estado)
  execute function public._avisar_poliza_pendiente();

-- ---------------------------------------------------------------- lectura
-- Datos del contrato y del contratista que muestran las dos pantallas.
create or replace function public._fila_contrato_poliza(p_contrato_id uuid)
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'numero', c.numero, 'numero_contrato', coalesce(c.numero_contrato, 'Solicitud N° ' || c.numero),
    'clase', c.clase, 'tipo', c.tipo, 'tipo_detalle', c.tipo_detalle, 'objeto', c.objeto,
    'valor', public._valor_contrato(c.id), 'fecha_inicio', c.fecha_inicio,
    'fecha_fin', public._fecha_fin_contrato(c.id), 'poliza_estado', c.poliza_estado,
    'aprobado_at', c.minuta_resuelta_at, 'solicitado_por_nombre', sp.nombre,
    'proyecto_id', c.proyecto_id, 'proyecto_codigo', p.codigo, 'proyecto_nombre', p.nombre,
    'contratista', jsonb_build_object(
      'id', k.id, 'nombre', k.nombre, 'tipo_persona', k.tipo_persona,
      'documento', k.tipo_documento || ' ' || k.numero_documento || coalesce('-' || k.digito_verificacion, ''),
      'representante_nombre', k.representante_nombre,
      'representante_documento', nullif(trim(coalesce(k.representante_tipo_documento, '') || ' '
                                      || coalesce(k.representante_numero_documento, '')), ''),
      'direccion', k.direccion, 'telefono', k.telefono, 'correo', k.correo, 'ciudad', k.ciudad)
  )
  from contratos c
  join proyectos p on p.id = c.proyecto_id
  join contratistas k on k.id = c.contratista_id
  left join perfiles sp on sp.id = c.solicitado_por
  where c.id = p_contrato_id
$$;
revoke all on function public._fila_contrato_poliza(uuid) from public, anon, authenticated;

create or replace function public._fila_poliza(p_id uuid)
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', o.id, 'contrato_id', o.contrato_id, 'estado', o.estado, 'motivo', o.motivo,
    'ruta', o.ruta, 'nombre_archivo', o.nombre_archivo, 'tamano', o.tamano, 'mime', o.mime,
    'subida_por_nombre', sp.nombre, 'created_at', o.created_at,
    'resuelta_por_nombre', rp.nombre, 'resuelta_at', o.resuelta_at)
  from contrato_polizas o
  left join perfiles sp on sp.id = o.subida_por
  left join perfiles rp on rp.id = o.resuelta_por
  where o.id = p_id
$$;
revoke all on function public._fila_poliza(uuid) from public, anon, authenticated;

-- Buscar (igual que Actas por grupos, pero también contratos generales).
create or replace function public.buscar_contratistas_para_poliza(p_texto text)
returns table(contratista_id uuid, nombre text, documento text, contratos integer)
language plpgsql
stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.polizas') then
    raise exception 'No tienes permiso para ver pólizas.';
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
  where c.poliza_estado is not null
    and c.proyecto_id in (select public.proyectos_visibles(auth.uid()))
    and (v_texto = '_' or k.nombre ilike '%' || v_texto || '%' or k.numero_documento ilike '%' || v_texto || '%')
  group by k.id, k.nombre, k.tipo_documento, k.numero_documento, k.digito_verificacion
  order by k.nombre
  limit 50;
end;
$$;
revoke all on function public.buscar_contratistas_para_poliza(text) from public, anon;
grant execute on function public.buscar_contratistas_para_poliza(text) to authenticated;

create or replace function public.buscar_contratos_para_poliza(p_texto text default null, p_contratista_id uuid default null)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_texto text := nullif(trim(coalesce(p_texto, '')), '');
begin
  if not public.tiene_pestana(auth.uid(), 'contratos.polizas') then
    raise exception 'No tienes permiso para ver pólizas.';
  end if;
  if p_contratista_id is null and v_texto is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(public._fila_contrato_poliza(x.id) order by x.numero desc)
    from (
      select c.id, c.numero
      from contratos c
      join contratistas k on k.id = c.contratista_id
      where c.poliza_estado is not null
        and c.proyecto_id in (select public.proyectos_visibles(auth.uid()))
        and (p_contratista_id is null or c.contratista_id = p_contratista_id)
        and (v_texto is null or v_texto = '_'
             or c.numero_contrato ilike '%' || v_texto || '%'
             or c.objeto ilike '%' || v_texto || '%'
             or k.nombre ilike '%' || v_texto || '%'
             or k.numero_documento ilike '%' || v_texto || '%')
      order by c.numero desc
      limit 50
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.buscar_contratos_para_poliza(text, uuid) from public, anon;
grant execute on function public.buscar_contratos_para_poliza(text, uuid) to authenticated;

-- El contrato con sus pólizas (la más reciente primero).
create or replace function public.polizas_de_contrato(p_contrato_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public._puede_ver_polizas(v_uid)
     or not exists (select 1 from contratos c where c.id = p_contrato_id
                     and c.proyecto_id in (select public.proyectos_visibles(v_uid))) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  return jsonb_build_object(
    'contrato', public._fila_contrato_poliza(p_contrato_id),
    'polizas', coalesce((select jsonb_agg(public._fila_poliza(o.id) order by o.created_at desc, o.id)
                           from contrato_polizas o where o.contrato_id = p_contrato_id), '[]'::jsonb));
end;
$$;
revoke all on function public.polizas_de_contrato(uuid) from public, anon;
grant execute on function public.polizas_de_contrato(uuid) to authenticated;

-- Aprobación de pólizas: lista por estado (por defecto, por revisar).
create or replace function public.listar_polizas_aprobacion(p_estados text[] default null)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.tiene_pestana(v_uid, 'contratos.aprobar_polizas') then
    raise exception 'No tienes permiso para ver la aprobación de pólizas.';
  end if;
  return coalesce((
    select jsonb_agg(public._fila_poliza(x.id) || jsonb_build_object('contrato', public._fila_contrato_poliza(x.contrato_id))
                     order by x.created_at, x.id)
    from (
      select o.id, o.contrato_id, o.created_at
      from contrato_polizas o
      where o.proyecto_id in (select public.proyectos_visibles(v_uid))
        and (p_estados is null or o.estado = any (p_estados))
      order by o.created_at, o.id
      limit 1000
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.listar_polizas_aprobacion(text[]) from public, anon;
grant execute on function public.listar_polizas_aprobacion(text[]) to authenticated;

create or replace function public.detalle_poliza(p_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contrato uuid;
begin
  select o.contrato_id into v_contrato from contrato_polizas o
   where o.id = p_id and o.proyecto_id in (select public.proyectos_visibles(v_uid));
  if v_contrato is null or not public._puede_ver_polizas(v_uid) then
    raise exception 'La póliza no existe o no tienes acceso.';
  end if;
  return public._fila_poliza(p_id) || jsonb_build_object('contrato', public._fila_contrato_poliza(v_contrato));
end;
$$;
revoke all on function public.detalle_poliza(uuid) from public, anon;
grant execute on function public.detalle_poliza(uuid) to authenticated;

-- ---------------------------------------------------------------- subir
-- El navegador sube el archivo a polizas/<contrato_id>/... y luego llama esto.
create or replace function public.subir_poliza(p_contrato_id uuid, p_ruta text, p_nombre_archivo text, p_tamano bigint, p_mime text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c record;
  v_id uuid;
begin
  if not public.tiene_pestana(v_uid, 'contratos.polizas') then
    raise exception 'No tienes permiso para subir pólizas.';
  end if;
  select id, proyecto_id, numero, numero_contrato, poliza_estado into c
    from contratos where id = p_contrato_id for update;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, c.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  if c.poliza_estado is null then
    raise exception 'Este contrato no tiene póliza pendiente (no está aprobado por Subgerencia o ya se liquidó).';
  end if;
  if c.poliza_estado = 'recibida' then
    raise exception 'La póliza de este contrato ya se subió y está en revisión de Jurídica (actualiza la página).';
  end if;
  if c.poliza_estado = 'aprobada' then
    raise exception 'La póliza de este contrato ya está aprobada.';
  end if;
  if p_ruta is null or split_part(p_ruta, '/', 1) <> p_contrato_id::text then
    raise exception 'El archivo no es de este contrato.';
  end if;
  if p_mime is null or p_mime not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'La póliza tiene que ser PDF, JPG o PNG.';
  end if;
  if p_tamano is null or p_tamano <= 0 or p_tamano > 10485760 then
    raise exception 'El archivo no puede pasar de 10 MB.';
  end if;
  if nullif(trim(coalesce(p_nombre_archivo, '')), '') is null or length(p_nombre_archivo) > 300 then
    raise exception 'El nombre del archivo no es válido.';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'polizas' and o.name = p_ruta) then
    raise exception 'No se encontró el archivo de la póliza. Vuelve a adjuntarlo.';
  end if;

  insert into contrato_polizas (contrato_id, proyecto_id, ruta, nombre_archivo, tamano, mime, subida_por)
  values (p_contrato_id, c.proyecto_id, p_ruta, trim(p_nombre_archivo), p_tamano, p_mime, v_uid)
  returning id into v_id;
  update contratos set poliza_estado = 'recibida' where id = p_contrato_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('contrato', p_contrato_id, 'poliza_subida', v_uid, jsonb_build_object('poliza_id', v_id, 'archivo', trim(p_nombre_archivo)));

  -- A Jurídica (quien la aprueba y ve el proyecto), menos Administradores.
  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select pf.id, 'poliza_por_revisar', 'contrato', p_contrato_id, 'Póliza por revisar',
         'Póliza del contrato ' || coalesce(c.numero_contrato, 'N° ' || c.numero) || ' por revisar.'
    from perfiles pf
    left join roles r on r.id = pf.rol_id
   where pf.id is distinct from v_uid
     and r.clave is distinct from 'administrador'
     and public.tiene_pestana(pf.id, 'contratos.aprobar_polizas')
     and public.tiene_accion(pf.id, 'aprobar_contratos')
     and public.usuario_puede_ver_proyecto(pf.id, c.proyecto_id);
  return v_id;
end;
$$;
revoke all on function public.subir_poliza(uuid, text, text, bigint, text) from public, anon;
grant execute on function public.subir_poliza(uuid, text, text, bigint, text) to authenticated;

-- ---------------------------------------------------------------- resolver
create or replace function public.resolver_poliza(p_id uuid, p_accion text, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_contrato text;
begin
  if not (public.tiene_pestana(v_uid, 'contratos.aprobar_polizas') and public.tiene_accion(v_uid, 'aprobar_contratos')) then
    raise exception 'No tienes permiso para aprobar pólizas.';
  end if;
  if p_accion not in ('aprobar', 'devolver') then
    raise exception 'Acción no válida.';
  end if;
  if p_accion = 'devolver' and v_motivo is null then
    raise exception 'Escribe el motivo de la devolución.';
  end if;
  if length(coalesce(v_motivo, '')) > 2000 then
    raise exception 'El motivo es muy largo (máximo 2.000 caracteres).';
  end if;

  select x.*, c.numero_contrato, c.numero as contrato_numero, c.solicitado_por into o
    from contrato_polizas x join contratos c on c.id = x.contrato_id
   where x.id = p_id
   for update of x, c;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, o.proyecto_id) then
    raise exception 'La póliza no existe o no tienes acceso.';
  end if;
  if o.estado <> 'por_revisar' then
    raise exception 'Esta póliza ya se revisó (actualiza la página).';
  end if;
  v_contrato := coalesce(o.numero_contrato, 'N° ' || o.contrato_numero);

  update contrato_polizas
     set estado = case when p_accion = 'aprobar' then 'aprobada' else 'devuelta' end,
         motivo = v_motivo, resuelta_por = v_uid, resuelta_at = now()
   where id = p_id;
  update contratos
     set poliza_estado = case when p_accion = 'aprobar' then 'aprobada' else 'pendiente' end
   where id = o.contrato_id;

  insert into historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('contrato', o.contrato_id, case when p_accion = 'aprobar' then 'poliza_aprobada' else 'poliza_devuelta' end,
          v_uid, v_motivo, jsonb_build_object('poliza_id', p_id, 'archivo', o.nombre_archivo));

  insert into notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select distinct u, case when p_accion = 'aprobar' then 'poliza_aprobada' else 'poliza_devuelta' end,
         'contrato', o.contrato_id,
         case when p_accion = 'aprobar' then 'Póliza aprobada' else 'Póliza devuelta' end,
         case when p_accion = 'aprobar'
              then 'La póliza del contrato ' || v_contrato || ' fue aprobada: ya se pueden hacer actas.'
              else 'La póliza del contrato ' || v_contrato || ' fue devuelta: súbela otra vez. Motivo: ' || v_motivo end
    from unnest(array[o.subida_por, o.solicitado_por]) u
   where u is not null and u is distinct from v_uid;
end;
$$;
revoke all on function public.resolver_poliza(uuid, text, text) from public, anon;
grant execute on function public.resolver_poliza(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- actas
create or replace function public.contrato_para_acta(p_contrato_id uuid, p_excluir_acta uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v record;
  v_fin date;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_ret numeric;
  v_valor numeric;
begin
  select c.* into v from contratos c where c.id = p_contrato_id;
  if not found or not public.puede_ver_actas(v.proyecto_id) then
    raise exception 'El contrato no existe o no tienes acceso.';
  end if;
  v_fin := public._fecha_fin_contrato(p_contrato_id);
  v_ret := public._retencion_porcentaje_contrato(p_contrato_id);
  v_valor := public._valor_contrato(p_contrato_id);

  return jsonb_build_object(
    -- Tope de las actas: el valor vigente (otrosí aprobado). El anticipo es % del inicial.
    'valor', v_valor,
    'valor_inicial', v.valor,
    'anexo_tipo', v.anexo_tipo,
    'anticipo_porcentaje', case when v.tiene_anticipo then v.anticipo_porcentaje end,
    'retencion_porcentaje', v_ret,
    'fecha_fin', v_fin,
    'vencido', v_fin is not null and v_fin < v_hoy,
    'liquidado', v.liquidado_at is not null,
    'listo_para_actas', v.estado = 'aprobada' and v.minuta_estado = 'aprobada',
    -- Pólizas (20261126000000): sin póliza aprobada por Jurídica no hay actas.
    'poliza_estado', v.poliza_estado,
    -- Ya hay un acta final (por aprobar o aprobada) distinta de la que se edita.
    'tiene_final', exists (select 1 from actas a where a.contrato_id = v.id and a.tipo = 'final'
                             and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'tiene_liquidacion', exists (select 1 from actas a where a.contrato_id = v.id and a.tipo = 'liquidacion'
                                   and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'actas_por_aprobar', (select count(*) from actas a where a.contrato_id = v.id and a.estado = 'pendiente'
                            and a.tipo <> 'liquidacion' and a.id is distinct from p_excluir_acta),
    'bruto_otras', (select coalesce(sum(a.valor_bruto), 0) from actas a where a.contrato_id = v.id
                      and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    -- Valor global: si el valor cambió, lo cobrado como % del valor vigente.
    'avance_otras', (select case when v_valor = v.valor then coalesce(sum(a.porcentaje_avance), 0)
                                 else coalesce(round(sum(a.valor_bruto) * 100 / nullif(v_valor, 0), 4), 0) end
                       from actas a where a.contrato_id = v.id
                       and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    'amortizado_otras', (select coalesce(sum(a.amortizacion), 0) from actas a where a.contrato_id = v.id
                           and a.tipo <> 'liquidacion' and a.estado <> 'rechazada' and a.id is distinct from p_excluir_acta),
    -- Para la liquidación: solo lo APROBADO.
    'amortizado_aprobado', (select coalesce(sum(a.amortizacion), 0) from actas a where a.contrato_id = v.id
                              and a.tipo <> 'liquidacion' and a.estado = 'aprobada'),
    'retenido_aprobado', (select coalesce(sum(a.retencion), 0) from actas a where a.contrato_id = v.id
                            and a.tipo <> 'liquidacion' and a.estado = 'aprobada'),
    'actividades', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'orden', i.orden, 'actividad', i.actividad, 'unidad', i.unidad,
               'cantidad', i.cantidad, 'valor_unitario', i.valor_unitario,
               'acumulado', coalesce((
                 select sum(x.cantidad) from acta_actividades x join actas a on a.id = x.acta_id
                 where x.contrato_anexo_item_id = i.id and a.estado <> 'rechazada'
                   and a.id is distinct from p_excluir_acta), 0)
             ) order by i.orden, i.id)
      from contrato_anexo_items i where i.contrato_id = v.id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public._guardar_acta(p_acta_id uuid, p_contrato_id uuid, p_datos jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c record;
  v_info jsonb;
  v_tipo text := coalesce(p_datos->>'tipo', 'parcial');
  v_desde date;
  v_hasta date;
  v_bruto numeric := 0;
  v_avance numeric;
  v_amort numeric := 0;
  v_ret numeric := 0;
  v_dev numeric := 0;
  v_otros numeric := 0;
  v_anticipo_pct numeric;
  v_ret_pct numeric;
  v_anticipo_total numeric := 0;
  v_orden integer := 0;
  v_item record;
  v_cant numeric;
  v_valor numeric;
  v_valor_vig numeric;
  d jsonb;
begin
  select * into c from contratos where id = p_contrato_id;
  v_info := public.contrato_para_acta(p_contrato_id, p_acta_id);
  -- Tope: el valor vigente (otrosí aprobado); el anticipo sigue con c.valor.
  v_valor_vig := (v_info->>'valor')::numeric;

  if v_tipo not in ('parcial', 'final', 'liquidacion') then
    raise exception 'Tipo de acta no válido.';
  end if;
  if not (v_info->>'listo_para_actas')::boolean then
    raise exception 'Solo se hacen actas de contratos con la minuta aprobada por Subgerencia.';
  end if;
  if (v_info->>'poliza_estado') is distinct from 'aprobada' then
    raise exception 'La póliza del contrato todavía no está aprobada por Jurídica: no se pueden hacer actas.';
  end if;
  if (v_info->>'liquidado')::boolean then
    raise exception 'El contrato ya está liquidado: no recibe más actas.';
  end if;

  begin
    v_desde := nullif(p_datos->>'periodo_desde', '')::date;
    v_hasta := nullif(p_datos->>'periodo_hasta', '')::date;
  exception when others then
    raise exception 'Las fechas del período no son válidas.';
  end;
  if v_desde is not null and v_hasta is not null and v_hasta < v_desde then
    raise exception 'El período termina antes de empezar.';
  end if;

  v_anticipo_pct := nullif(v_info->>'anticipo_porcentaje', '')::numeric;
  v_ret_pct := nullif(v_info->>'retencion_porcentaje', '')::numeric;
  if v_anticipo_pct is not null then
    v_anticipo_total := round(c.valor * v_anticipo_pct / 100, 2);
  end if;

  if v_tipo = 'liquidacion' then
    if (v_info->>'tiene_liquidacion')::boolean then
      raise exception 'Este contrato ya tiene un acta de liquidación.';
    end if;
    if (v_info->>'actas_por_aprobar')::int > 0 then
      raise exception 'Hay actas por aprobar: apruébalas o recházalas antes de liquidar.';
    end if;
    -- Devuelve la retención y descuenta el anticipo que falte por amortizar.
    v_dev := (v_info->>'retenido_aprobado')::numeric;
    v_amort := greatest(v_anticipo_total - (v_info->>'amortizado_aprobado')::numeric, 0);
  else
    if (v_info->>'vencido')::boolean then
      raise exception 'El contrato venció el %: no recibe actas de avance (solo la de liquidación).',
        to_char((v_info->>'fecha_fin')::date, 'DD/MM/YYYY');
    end if;
    if (v_info->>'tiene_final')::boolean then
      raise exception 'El contrato ya tiene acta final: no recibe más actas de avance (sigue la de liquidación).';
    end if;

    if c.anexo_tipo = 'valores_unitarios' then
      if jsonb_typeof(coalesce(p_datos->'actividades', 'null')) is distinct from 'array' then
        raise exception 'Escribe la cantidad ejecutada de al menos una actividad.';
      end if;
      if (select count(distinct e->>'anexo_item_id') from jsonb_array_elements(p_datos->'actividades') e)
         <> jsonb_array_length(p_datos->'actividades') then
        raise exception 'Hay una actividad repetida.';
      end if;
      for d in select * from jsonb_array_elements(p_datos->'actividades') loop
        begin
          v_cant := (d->>'cantidad')::numeric;
        exception when others then
          raise exception 'Una cantidad no es un número.';
        end;
        continue when v_cant is null or v_cant = 0;
        if v_cant < 0 then
          raise exception 'Las cantidades no pueden ser negativas.';
        end if;
        select i.id, i.orden, i.actividad, i.unidad, i.cantidad, i.valor_unitario into v_item
          from contrato_anexo_items i
         where i.id = (d->>'anexo_item_id')::uuid and i.contrato_id = p_contrato_id;
        if not found then
          raise exception 'Una actividad no es de este contrato.';
        end if;
        -- Acumulado de la actividad en las demás actas no rechazadas (índice por actividad).
        if (select coalesce(sum(x.cantidad), 0) from acta_actividades x join actas o on o.id = x.acta_id
             where x.contrato_anexo_item_id = v_item.id and o.estado <> 'rechazada' and o.id <> p_acta_id)
           + v_cant > v_item.cantidad then
          raise exception 'La actividad "%" pasa de la cantidad contratada (% %).',
            v_item.actividad, trim(to_char(v_item.cantidad, 'FM999999999990.####')), v_item.unidad;
        end if;
        v_orden := v_orden + 1;
        v_valor := round(v_cant * v_item.valor_unitario, 2);
        v_bruto := v_bruto + v_valor;
        insert into acta_actividades (acta_id, contrato_anexo_item_id, orden, actividad, unidad, cantidad, valor_unitario, valor)
        values (p_acta_id, v_item.id, v_item.orden, v_item.actividad, v_item.unidad, v_cant, v_item.valor_unitario, v_valor);
      end loop;
      if v_orden = 0 then
        raise exception 'Escribe la cantidad ejecutada de al menos una actividad.';
      end if;
    else
      -- Valor global: % de avance de esta acta.
      begin
        v_avance := (p_datos->>'porcentaje_avance')::numeric;
      exception when others then
        raise exception 'El porcentaje de avance no es un número.';
      end;
      if v_avance is null or v_avance <= 0 then
        raise exception 'Escribe el porcentaje de avance de esta acta.';
      end if;
      if (v_info->>'avance_otras')::numeric + v_avance > 100 then
        raise exception 'El avance acumulado pasaría del 100 %% (ya va en % %%).',
          trim(to_char((v_info->>'avance_otras')::numeric, 'FM990.##'));
      end if;
      v_bruto := round(v_valor_vig * v_avance / 100, 2);
    end if;

    if v_bruto > v_valor_vig - (v_info->>'bruto_otras')::numeric then
      raise exception 'El acta suma % y el saldo del contrato es %. Las actas no pueden superar el valor del contrato.',
        public._pesos_texto(v_bruto), public._pesos_texto(greatest(v_valor_vig - (v_info->>'bruto_otras')::numeric, 0));
    end if;

    -- Amortización: % del anticipo sobre el bruto, sin pasar de lo que falte;
    -- la final amortiza todo lo que falte (sin pasar del bruto).
    if v_anticipo_total > 0 then
      v_amort := least(
        case when v_tipo = 'final' then v_anticipo_total else round(v_bruto * v_anticipo_pct / 100, 2) end,
        greatest(v_anticipo_total - (v_info->>'amortizado_otras')::numeric, 0),
        v_bruto);
    end if;
    if v_ret_pct is not null then
      v_ret := round(v_bruto * v_ret_pct / 100, 2);
    end if;
  end if;

  -- Otros descuentos (retefuente, ICA...).
  v_orden := 0;
  if jsonb_typeof(coalesce(p_datos->'descuentos', '[]')) = 'array' then
    for d in select * from jsonb_array_elements(coalesce(p_datos->'descuentos', '[]')) loop
      continue when nullif(trim(coalesce(d->>'concepto', '')), '') is null and coalesce((d->>'valor')::numeric, 0) = 0;
      if nullif(trim(coalesce(d->>'concepto', '')), '') is null then
        raise exception 'Escribe el concepto de cada descuento.';
      end if;
      begin
        v_valor := round((d->>'valor')::numeric, 2);
      exception when others then
        raise exception 'El valor del descuento "%" no es un número.', d->>'concepto';
      end;
      if v_valor is null or v_valor <= 0 then
        raise exception 'El descuento "%" debe ser mayor que cero.', d->>'concepto';
      end if;
      v_orden := v_orden + 1;
      v_otros := v_otros + v_valor;
      insert into acta_descuentos (acta_id, orden, concepto, valor) values (p_acta_id, v_orden, trim(d->>'concepto'), v_valor);
    end loop;
  end if;

  if v_tipo <> 'liquidacion' and v_bruto - v_amort - v_ret - v_otros < 0 then
    raise exception 'Los descuentos (%) pasan del valor del acta (%).',
      public._pesos_texto(v_amort + v_ret + v_otros), public._pesos_texto(v_bruto);
  end if;

  update actas set
    tipo = v_tipo,
    periodo_desde = v_desde,
    periodo_hasta = v_hasta,
    observaciones = nullif(trim(coalesce(p_datos->>'observaciones', '')), ''),
    porcentaje_avance = case when v_tipo <> 'liquidacion' and c.anexo_tipo <> 'valores_unitarios' then v_avance end,
    valor_bruto = v_bruto,
    total = v_bruto,
    amortizacion = v_amort,
    retencion = v_ret,
    devolucion_retencion = v_dev,
    otros_descuentos = v_otros,
    neto = v_bruto + v_dev - v_amort - v_ret - v_otros,
    anticipo_porcentaje = v_anticipo_pct,
    retencion_porcentaje = v_ret_pct
  where id = p_acta_id;
end;
$function$;

-- ---------------------------------------------------------------- contratos ya aprobados
-- Sin liquidar: quedan pendientes (el disparador avisa a cada director).
update public.contratos
   set poliza_estado = 'pendiente'
 where estado = 'aprobada' and minuta_estado = 'aprobada' and liquidado_at is null and poliza_estado is null;
