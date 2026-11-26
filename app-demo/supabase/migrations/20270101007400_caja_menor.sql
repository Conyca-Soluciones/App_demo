-- ===========================================================================
-- Caja menor (procedimiento GF-PR-001 v2), decisiones del usuario 2026-11-26.
--
-- Alcance: solo gastos y reembolso. Financiera crea la caja (responsable,
-- monto, tercero y cuenta a donde se reembolsa, grupo empresarial y proyecto);
-- el desembolso inicial va por fuera. El responsable sube su LEGALIZACIÓN con
-- todos los gastos (pantalla o Excel) y el soporte de cada uno:
--   por_revisar (Financiera revisa los soportes)
--   -> por_aprobar (Líder Financiera da el okay)
--   -> en_gerencia (la app crea sola el cuadro de pago: requisiciones_admin
--      tipo 'caja_menor', un ítem = el reembolso al responsable; Gerencia lo
--      aprueba en Aprobación de pagos como cualquier cuadro)
--   -> aprobada (Gerencia aprobó el pago; sigue por consolidado y dispersor).
-- Cualquiera de los tres puede devolver (siempre al responsable, que corrige y
-- vuelve a empezar por Financiera). Las reglas del procedimiento (70 %, corte
-- del 27, tope) solo avisan: nada se bloquea.
--
-- Va antes que el código. Reversa: supabase/reversa/20270101007400_caja_menor.sql
-- ===========================================================================
begin;

-- 1. Tipo del cuadro de pagos --------------------------------------------------
-- 'cuadro' = el de siempre; 'caja_menor' = reembolso de una caja menor (lo crea
-- la app). Después vendrán otros tipos (reembolso, ...).
alter table public.requisiciones_admin
  add column if not exists tipo text not null default 'cuadro';
alter table public.requisiciones_admin drop constraint if exists requisiciones_admin_tipo_check;
alter table public.requisiciones_admin
  add constraint requisiciones_admin_tipo_check check (tipo in ('cuadro', 'caja_menor'));

-- El soporte del reembolso es la relación de gastos (PDF que genera la app).
alter table public.requisicion_admin_items drop constraint if exists requisicion_admin_items_soporte_check;
alter table public.requisicion_admin_items add constraint requisicion_admin_items_soporte_check check (
  (soporte_ruta is null and soporte_tipo is null)
  or (soporte_ruta is not null and soporte_tipo in ('factura', 'cuenta_cobro', 'relacion_caja_menor')
      and btrim(coalesce(soporte_nombre, '')) <> ''));

-- 2. Tablas ---------------------------------------------------------------------
create table if not exists public.cajas_menores (
  id uuid primary key default gen_random_uuid(),
  numero integer generated always as identity unique,
  responsable_id uuid not null references public.perfiles(id),
  tercero_id uuid not null references public.terceros(id),
  cuenta_tercero_id uuid not null references public.terceros_cuentas(id),
  empresa_id uuid not null references public.empresas(id),
  proyecto_id uuid not null references public.proyectos(id),
  monto numeric(16, 2) not null check (monto > 0),
  descripcion text,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  creada_por uuid not null references public.perfiles(id),
  creada_en timestamptz not null default now(),
  cerrada_por uuid references public.perfiles(id),
  cerrada_en timestamptz,
  motivo_cierre text
);
-- Un responsable no maneja más de una caja menor (numeral 5.2).
create unique index if not exists cajas_menores_una_abierta
  on public.cajas_menores (responsable_id) where estado = 'abierta';
create index if not exists cajas_menores_tercero_idx on public.cajas_menores (tercero_id);
create index if not exists cajas_menores_cuenta_idx on public.cajas_menores (cuenta_tercero_id);
create index if not exists cajas_menores_empresa_idx on public.cajas_menores (empresa_id);
create index if not exists cajas_menores_proyecto_idx on public.cajas_menores (proyecto_id);

create table if not exists public.caja_menor_legalizaciones (
  id uuid primary key default gen_random_uuid(),
  caja_id uuid not null references public.cajas_menores(id),
  -- Copia del responsable de la caja: la RLS no tiene que leer otra tabla.
  responsable_id uuid not null references public.perfiles(id),
  codigo text not null unique, -- CM-001-0001 (consecutivo del proyecto de la caja)
  estado text not null default 'por_revisar'
    check (estado in ('por_revisar', 'por_aprobar', 'en_gerencia', 'aprobada', 'devuelta', 'cancelada')),
  n_gastos smallint not null check (n_gastos between 1 and 200),
  valor_total numeric(16, 2) not null check (valor_total > 0),
  creada_en timestamptz not null default now(),
  enviada_en timestamptz not null default now(),
  revisada_por uuid references public.perfiles(id),
  revisada_en timestamptz,
  aprobada_por uuid references public.perfiles(id),
  aprobada_en timestamptz,
  devuelta_por uuid references public.perfiles(id),
  devuelta_en timestamptz,
  motivo_devolucion text,
  cancelada_en timestamptz,
  motivo_cancelacion text,
  requisicion_admin_id uuid references public.requisiciones_admin(id) on delete set null
);
-- Una legalización en curso por caja (la siguiente se manda cuando la anterior
-- ya pasó a Gerencia).
create unique index if not exists caja_menor_legalizaciones_una_en_curso
  on public.caja_menor_legalizaciones (caja_id) where estado in ('por_revisar', 'por_aprobar', 'devuelta');
create index if not exists caja_menor_legalizaciones_caja_idx on public.caja_menor_legalizaciones (caja_id, enviada_en desc);
create index if not exists caja_menor_legalizaciones_responsable_idx on public.caja_menor_legalizaciones (responsable_id);
create index if not exists caja_menor_legalizaciones_estado_idx on public.caja_menor_legalizaciones (estado, enviada_en);
create index if not exists caja_menor_legalizaciones_req_idx on public.caja_menor_legalizaciones (requisicion_admin_id);

create table if not exists public.caja_menor_gastos (
  id uuid primary key default gen_random_uuid(),
  legalizacion_id uuid not null references public.caja_menor_legalizaciones(id) on delete cascade,
  responsable_id uuid not null references public.perfiles(id),
  orden smallint not null check (orden between 1 and 200),
  fecha date not null,
  proyecto_id uuid not null references public.proyectos(id),
  solicitado_por uuid not null references public.perfiles(id),
  numero_factura text not null check (btrim(numero_factura) <> ''),
  documento text not null check (documento ~ '^[0-9]+(-[0-9])?$'),
  nombre text not null check (btrim(nombre) <> ''),
  concepto text not null check (btrim(concepto) <> ''),
  destino text not null check (btrim(destino) <> ''),
  valor numeric(16, 2) not null check (valor > 0),
  soporte_ruta text not null,
  soporte_nombre text not null,
  soporte_mime text,
  soporte_tamano bigint
);
create index if not exists caja_menor_gastos_legalizacion_idx on public.caja_menor_gastos (legalizacion_id, orden);
create index if not exists caja_menor_gastos_responsable_idx on public.caja_menor_gastos (responsable_id);
create index if not exists caja_menor_gastos_proyecto_idx on public.caja_menor_gastos (proyecto_id);
create index if not exists caja_menor_gastos_solicitado_idx on public.caja_menor_gastos (solicitado_por);
create index if not exists caja_menor_gastos_soporte_idx on public.caja_menor_gastos (soporte_ruta);

-- 3. Quién ve las cajas -----------------------------------------------------------
-- El responsable ve las suyas; además Financiera (gestionar), Líder Financiera
-- (aprobar), quien aprueba pagos (Gerencia ve los gastos desde el pago) y quien
-- ve algún consolidado (Contabilidad liquida el reembolso).
create or replace function public._ve_cajas_menores(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_admin(p_uid)
      or public.tiene_accion(p_uid, 'gestionar_cajas_menores')
      or public.tiene_accion(p_uid, 'aprobar_cajas_menores')
      or public.tiene_pestana(p_uid, 'ayf.aprobacion_pagos')
      or public._ve_algun_consolidado(p_uid)
$$;
revoke execute on function public._ve_cajas_menores(uuid) from public;
-- La usan las políticas: se evalúan con los permisos de quien consulta.
grant execute on function public._ve_cajas_menores(uuid) to authenticated;

alter table public.cajas_menores enable row level security;
alter table public.caja_menor_legalizaciones enable row level security;
alter table public.caja_menor_gastos enable row level security;

drop policy if exists cajas_menores_select on public.cajas_menores;
create policy cajas_menores_select on public.cajas_menores for select to authenticated
  using (responsable_id = (select auth.uid()) or (select public._ve_cajas_menores((select auth.uid()))));
drop policy if exists caja_menor_legalizaciones_select on public.caja_menor_legalizaciones;
create policy caja_menor_legalizaciones_select on public.caja_menor_legalizaciones for select to authenticated
  using (responsable_id = (select auth.uid()) or (select public._ve_cajas_menores((select auth.uid()))));
drop policy if exists caja_menor_gastos_select on public.caja_menor_gastos;
create policy caja_menor_gastos_select on public.caja_menor_gastos for select to authenticated
  using (responsable_id = (select auth.uid()) or (select public._ve_cajas_menores((select auth.uid()))));
-- Se escribe solo por las funciones de abajo (SECURITY DEFINER).

-- 4. Soportes de los gastos: bucket privado cajas_menores (<usuario>/<archivo>) ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cajas_menores', 'cajas_menores', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- Rutas de soportes que quien consulta puede ver (con la RLS de los gastos).
-- INVOKER y devuelve el conjunto: la política de Storage no expande el plan.
create or replace function public._rutas_cajas_menores_visibles()
returns setof text language plpgsql stable security invoker set search_path = public as $$
begin return query select g.soporte_ruta from public.caja_menor_gastos g; end $$;
revoke execute on function public._rutas_cajas_menores_visibles() from public;
grant execute on function public._rutas_cajas_menores_visibles() to authenticated;

drop policy if exists cajas_menores_archivos_insert on storage.objects;
create policy cajas_menores_archivos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cajas_menores' and (storage.foldername(name))[1] = ((select auth.uid()))::text);
drop policy if exists cajas_menores_archivos_select on storage.objects;
create policy cajas_menores_archivos_select on storage.objects for select to authenticated
  using (bucket_id = 'cajas_menores'
         and ((storage.foldername(name))[1] = ((select auth.uid()))::text
              or name in (select public._rutas_cajas_menores_visibles())));
drop policy if exists cajas_menores_archivos_delete on storage.objects;
create policy cajas_menores_archivos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cajas_menores'
         and (storage.foldername(name))[1] = ((select auth.uid()))::text
         and not exists (select 1 from public.caja_menor_gastos g where g.soporte_ruta = objects.name));

-- 5. Permisos: acciones, pestaña y rol Líder Financiera --------------------------
insert into public.roles (clave, nombre, es_sistema, orden)
select 'lider_financiera', 'Líder Financiera', true,
       coalesce((select orden from public.roles where clave = 'financiera'), 100) + 1
where not exists (select 1 from public.roles where clave = 'lider_financiera');

-- Líder Financiera = todo lo de Financiera (los permisos de hoy) ...
insert into public.rol_permisos (rol_id, permiso)
select (select id from public.roles where clave = 'lider_financiera'), rp.permiso
  from public.rol_permisos rp join public.roles r on r.id = rp.rol_id
 where r.clave = 'financiera'
on conflict do nothing;
-- ... más la caja menor. Financiera crea cajas y revisa soportes; Líder
-- Financiera además da el okay.
insert into public.rol_permisos (rol_id, permiso)
select r.id, p.permiso
  from public.roles r
  cross join (values ('tab.ayf.cajas_menores'), ('accion.gestionar_cajas_menores')) as p(permiso)
 where r.clave in ('financiera', 'lider_financiera')
on conflict do nothing;
insert into public.rol_permisos (rol_id, permiso)
select r.id, 'accion.aprobar_cajas_menores' from public.roles r where r.clave = 'lider_financiera'
on conflict do nothing;

-- 6. Avisos e historial: tipos nuevos (se agregan a la lista viva) ----------------
-- Lee la lista del CHECK vivo (sirve con ARRAY['a'::text, ...] y con '{a,b}'::text[])
-- y le agrega los tipos nuevos: no se pierde ninguno que otra migración haya puesto.
do $$
declare
  v_def text;
  v_lista text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'notificaciones_tipo_check';
  select array_agg(distinct m[1]) into v_lista
    from regexp_matches(substring(v_def from 'ANY \((.*)\)'), '([a-z][a-z0-9_]*)', 'g') as m where m[1] <> 'text';
  if coalesce(array_length(v_lista, 1), 0) < 2 then raise exception 'No se pudo leer el CHECK: %', v_def; end if;
  v_lista := array(select distinct unnest(v_lista || array['caja_menor_por_revisar', 'caja_menor_por_aprobar',
                    'caja_menor_devuelta', 'caja_menor_en_gerencia', 'caja_menor_aprobada']) order by 1);
  alter table public.notificaciones drop constraint notificaciones_tipo_check;
  execute format('alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo = any (%L::text[])) not valid', v_lista);

  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'notificaciones_entidad_tipo_check';
  select array_agg(distinct m[1]) into v_lista
    from regexp_matches(substring(v_def from 'ANY \((.*)\)'), '([a-z][a-z0-9_]*)', 'g') as m where m[1] <> 'text';
  if coalesce(array_length(v_lista, 1), 0) < 2 then raise exception 'No se pudo leer el CHECK: %', v_def; end if;
  v_lista := array(select distinct unnest(v_lista || array['caja_menor']) order by 1);
  alter table public.notificaciones drop constraint notificaciones_entidad_tipo_check;
  execute format('alter table public.notificaciones add constraint notificaciones_entidad_tipo_check check (entidad_tipo = any (%L::text[])) not valid', v_lista);

  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'historial_eventos_entidad_tipo_check';
  select array_agg(distinct m[1]) into v_lista
    from regexp_matches(substring(v_def from 'ANY \((.*)\)'), '([a-z][a-z0-9_]*)', 'g') as m where m[1] <> 'text';
  if coalesce(array_length(v_lista, 1), 0) < 2 then raise exception 'No se pudo leer el CHECK: %', v_def; end if;
  v_lista := array(select distinct unnest(v_lista || array['caja_menor']) order by 1);
  alter table public.historial_eventos drop constraint historial_eventos_entidad_tipo_check;
  execute format('alter table public.historial_eventos add constraint historial_eventos_entidad_tipo_check check (entidad_tipo = any (%L::text[]))', v_lista);
end;
$$;

-- 7. Ayudas internas ----------------------------------------------------------------
-- Quienes tienen una acción por su rol (sin contar al Administrador, como los demás avisos).
create or replace function public._usuarios_con_accion_caja(p_accion text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.perfiles p
    join public.rol_permisos rp on rp.rol_id = p.rol_id and rp.permiso = 'accion.' || p_accion
$$;
revoke execute on function public._usuarios_con_accion_caja(text) from public;

create or replace function public._avisar_caja_menor(p_usuarios uuid[], p_tipo text, p_legalizacion uuid,
                                                     p_titulo text, p_mensaje text)
returns void language sql security definer set search_path = public as $$
  insert into public.notificaciones (usuario_id, tipo, entidad_tipo, entidad_id, titulo, mensaje)
  select distinct u, p_tipo, 'caja_menor', p_legalizacion, p_titulo, p_mensaje
    from unnest(p_usuarios) as u
   where u is not null and u is distinct from auth.uid()
$$;
revoke execute on function public._avisar_caja_menor(uuid[], text, uuid, text, text) from public;

create or replace function public._evento_caja_menor(p_legalizacion uuid, p_evento text, p_motivo text, p_datos jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, motivo, datos)
  values ('caja_menor', p_legalizacion, p_evento, auth.uid(), nullif(btrim(coalesce(p_motivo, '')), ''), p_datos)
$$;
revoke execute on function public._evento_caja_menor(uuid, text, text, jsonb) from public;

create or replace function public._enmascarar_cuenta(p_numero text)
returns text language sql immutable set search_path = public as $$
  select case when p_numero is null then null
              else repeat('•', greatest(length(p_numero) - 4, 0)) || right(p_numero, 4) end
$$;
revoke execute on function public._enmascarar_cuenta(text) from public;

-- 8. Cajas (Financiera) ---------------------------------------------------------------
create or replace function public.guardar_caja_menor(p_id uuid, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_resp uuid := nullif(p_datos ->> 'responsable_id', '')::uuid;
  v_tercero uuid := nullif(p_datos ->> 'tercero_id', '')::uuid;
  v_cuenta uuid := nullif(p_datos ->> 'cuenta_tercero_id', '')::uuid;
  v_empresa uuid := nullif(p_datos ->> 'empresa_id', '')::uuid;
  v_proyecto uuid := nullif(p_datos ->> 'proyecto_id', '')::uuid;
  v_monto numeric;
  v_desc text := nullif(btrim(coalesce(p_datos ->> 'descripcion', '')), '');
  v_actual record;
begin
  if not (public.es_admin(auth.uid()) or public.tiene_accion(auth.uid(), 'gestionar_cajas_menores')) then
    raise exception 'No autorizado -- no tienes permiso para crear o editar cajas menores.';
  end if;
  if v_resp is null or not exists (select 1 from public.perfiles where id = v_resp) then
    raise exception 'Elige el responsable de la caja.';
  end if;
  if v_tercero is null or not exists (select 1 from public.terceros where id = v_tercero) then
    raise exception 'Elige el tercero a quien se reembolsa (tiene que estar en Terceros).';
  end if;
  if v_cuenta is null or not exists (select 1 from public.terceros_cuentas c
                                      where c.id = v_cuenta and c.tercero_id = v_tercero and c.estado <> 'INACTIVO') then
    raise exception 'Elige una cuenta del tercero (registrada en Terceros y no inactiva).';
  end if;
  if v_empresa is null or not exists (select 1 from public.empresas where id = v_empresa) then
    raise exception 'Elige el grupo empresarial.';
  end if;
  if v_proyecto is null or not exists (select 1 from public.proyectos where id = v_proyecto) then
    raise exception 'Elige el proyecto o área de la caja.';
  end if;
  begin
    v_monto := round((p_datos ->> 'monto')::numeric, 2);
  exception when others then
    v_monto := null;
  end;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto de la caja debe ser mayor que cero.';
  end if;

  if v_id is null then
    if exists (select 1 from public.cajas_menores where responsable_id = v_resp and estado = 'abierta') then
      raise exception 'Esa persona ya tiene una caja menor abierta: ciérrala antes de abrirle otra.';
    end if;
    insert into public.cajas_menores (responsable_id, tercero_id, cuenta_tercero_id, empresa_id, proyecto_id,
                                      monto, descripcion, creada_por)
    values (v_resp, v_tercero, v_cuenta, v_empresa, v_proyecto, v_monto, v_desc, auth.uid())
    returning id into v_id;
  else
    select * into v_actual from public.cajas_menores where id = v_id for update;
    if v_actual.id is null or v_actual.estado <> 'abierta' then
      raise exception 'La caja no existe o ya está cerrada.';
    end if;
    if v_actual.responsable_id <> v_resp then
      -- Procedimiento: si cambia el responsable, se cierra la caja y se abre otra.
      raise exception 'El responsable no se cambia: cierra esta caja y ábrele una nueva a la otra persona.';
    end if;
    update public.cajas_menores
       set tercero_id = v_tercero, cuenta_tercero_id = v_cuenta, empresa_id = v_empresa,
           proyecto_id = v_proyecto, monto = v_monto, descripcion = v_desc
     where id = v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.cerrar_caja_menor(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c record;
begin
  if not (public.es_admin(auth.uid()) or public.tiene_accion(auth.uid(), 'gestionar_cajas_menores')) then
    raise exception 'No autorizado -- no tienes permiso para cerrar cajas menores.';
  end if;
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'Escribe el motivo del cierre.';
  end if;
  select * into v_c from public.cajas_menores where id = p_id for update;
  if v_c.id is null or v_c.estado <> 'abierta' then
    raise exception 'La caja no existe o ya está cerrada.';
  end if;
  if exists (select 1 from public.caja_menor_legalizaciones l
              where l.caja_id = p_id and l.estado in ('por_revisar', 'por_aprobar', 'devuelta')) then
    raise exception 'La caja tiene una legalización en curso: termínala o que el responsable la cancele antes de cerrar.';
  end if;
  update public.cajas_menores
     set estado = 'cerrada', cerrada_por = auth.uid(), cerrada_en = now(), motivo_cierre = btrim(p_motivo)
   where id = p_id;
end;
$$;

-- Datos de una caja para las pantallas (cuenta enmascarada salvo A&F).
create or replace function public._caja_menor_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'numero', c.numero, 'estado', c.estado, 'monto', c.monto, 'descripcion', c.descripcion,
    'responsable_id', c.responsable_id, 'responsable_nombre', pr.nombre,
    'tercero_id', c.tercero_id, 'tercero_nombre', t.razon_social,
    'tercero_documento', t.tipo_documento || ' ' || t.numero_documento,
    'cuenta_tercero_id', c.cuenta_tercero_id,
    'cuenta_texto', concat_ws(' · ', b.nombre, initcap(k.tipo_cuenta),
                              case when public._ve_cajas_menores(auth.uid()) then k.numero_cuenta
                                   else public._enmascarar_cuenta(k.numero_cuenta) end),
    'cuenta_verificada', k.estado = 'ACTIVO',
    'empresa_id', c.empresa_id, 'empresa_nombre', e.razon_social,
    'proyecto_id', c.proyecto_id, 'proyecto_codigo', p.codigo, 'proyecto_nombre', p.nombre,
    'creada_en', c.creada_en, 'creada_por_nombre', cp.nombre,
    'cerrada_en', c.cerrada_en, 'motivo_cierre', c.motivo_cierre,
    'ultima_legalizacion', (select jsonb_build_object('id', l.id, 'codigo', l.codigo, 'estado', l.estado,
                                                      'enviada_en', l.enviada_en, 'valor_total', l.valor_total)
                              from public.caja_menor_legalizaciones l
                             where l.caja_id = c.id and l.estado <> 'cancelada'
                             order by l.enviada_en desc limit 1))
  from public.cajas_menores c
  join public.perfiles pr on pr.id = c.responsable_id
  join public.terceros t on t.id = c.tercero_id
  join public.terceros_cuentas k on k.id = c.cuenta_tercero_id
  left join public.bancos b on b.id = k.banco_id
  join public.empresas e on e.id = c.empresa_id
  join public.proyectos p on p.id = c.proyecto_id
  left join public.perfiles cp on cp.id = c.creada_por
  where c.id = p_id
$$;
revoke execute on function public._caja_menor_json(uuid) from public;

-- La caja abierta de quien consulta (null si no tiene).
create or replace function public.mi_caja_menor()
returns jsonb language sql stable security definer set search_path = public as $$
  select public._caja_menor_json(c.id) from public.cajas_menores c
   where c.responsable_id = auth.uid() and c.estado = 'abierta' limit 1
$$;

create or replace function public.listar_cajas_menores(p_incluir_cerradas boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public._ve_cajas_menores(auth.uid()) then
    raise exception 'No autorizado.';
  end if;
  return coalesce((select jsonb_agg(public._caja_menor_json(c.id) order by c.estado, c.creada_en desc)
                     from public.cajas_menores c
                    where p_incluir_cerradas or c.estado = 'abierta'), '[]'::jsonb);
end;
$$;

-- 9. Legalización (el responsable) ------------------------------------------------------
-- Valida y guarda los gastos de una legalización (reemplaza los que tenía).
create or replace function public._guardar_gastos_caja_menor(p_legalizacion uuid, p_responsable uuid, p_gastos jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_g jsonb;
  v_n integer := 0;
  v_total numeric := 0;
  v_fila text;
  v_fecha date;
  v_proyecto uuid;
  v_valor numeric;
  v_doc text;
  v_ruta text;
begin
  if p_gastos is null or jsonb_typeof(p_gastos) <> 'array' or jsonb_array_length(p_gastos) = 0 then
    raise exception 'Agrega al menos un gasto.';
  end if;
  if jsonb_array_length(p_gastos) > 200 then
    raise exception 'Una legalización tiene como máximo 200 gastos.';
  end if;
  delete from public.caja_menor_gastos where legalizacion_id = p_legalizacion;

  for v_g in select value from jsonb_array_elements(p_gastos)
  loop
    v_n := v_n + 1;
    v_fila := 'Gasto ' || v_n || ': ';
    begin
      v_fecha := (v_g ->> 'fecha')::date;
    exception when others then
      v_fecha := null;
    end;
    if v_fecha is null then
      raise exception '%escribe la fecha.', v_fila;
    end if;
    if v_fecha > (now() at time zone 'America/Bogota')::date then
      raise exception '%la fecha no puede ser futura.', v_fila;
    end if;
    v_proyecto := nullif(v_g ->> 'proyecto_id', '')::uuid;
    if v_proyecto is null or not exists (select 1 from public.proyectos p
                                          where p.id = v_proyecto
                                            and (p.funcionamiento or p.id in (select public.proyectos_visibles(auth.uid()))
                                                 or p.id = (select c.proyecto_id from public.cajas_menores c
                                                              join public.caja_menor_legalizaciones l on l.caja_id = c.id
                                                             where l.id = p_legalizacion))) then
      raise exception '%elige el proyecto.', v_fila;
    end if;
    if btrim(coalesce(v_g ->> 'numero_factura', '')) = '' then
      raise exception '%escribe el número de la factura o recibo.', v_fila;
    end if;
    v_doc := regexp_replace(btrim(coalesce(v_g ->> 'documento', '')), '[^0-9-]', '', 'g');
    v_doc := regexp_replace(regexp_replace(v_doc, '-+', '-', 'g'), '^-|-$', '', 'g');
    if v_doc !~ '^[0-9]+(-[0-9])?$' then
      raise exception '%el NIT o cédula solo lleva números (y el dígito de verificación después de un guion).', v_fila;
    end if;
    if btrim(coalesce(v_g ->> 'nombre', '')) = '' then
      raise exception '%escribe el nombre o razón social de quien vendió.', v_fila;
    end if;
    if btrim(coalesce(v_g ->> 'concepto', '')) = '' then
      raise exception '%escribe el concepto.', v_fila;
    end if;
    if btrim(coalesce(v_g ->> 'destino', '')) = '' then
      raise exception '%escribe el destino.', v_fila;
    end if;
    begin
      v_valor := round((v_g ->> 'valor')::numeric, 2);
    exception when others then
      v_valor := null;
    end;
    if v_valor is null or v_valor <= 0 then
      raise exception '%el valor debe ser mayor que cero.', v_fila;
    end if;
    v_ruta := nullif(btrim(coalesce(v_g -> 'soporte' ->> 'ruta', '')), '');
    if v_ruta is null or btrim(coalesce(v_g -> 'soporte' ->> 'nombre', '')) = '' then
      raise exception '%adjunta el soporte (factura, cuenta de cobro o recibo).', v_fila;
    end if;
    if split_part(v_ruta, '/', 1) <> p_responsable::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'cajas_menores' and o.name = v_ruta) then
      raise exception '%no se encontró el archivo del soporte: vuelve a adjuntarlo.', v_fila;
    end if;

    insert into public.caja_menor_gastos (legalizacion_id, responsable_id, orden, fecha, proyecto_id, solicitado_por,
                                          numero_factura, documento, nombre, concepto, destino, valor,
                                          soporte_ruta, soporte_nombre, soporte_mime, soporte_tamano)
    values (p_legalizacion, p_responsable, v_n, v_fecha, v_proyecto, p_responsable,
            btrim(v_g ->> 'numero_factura'), v_doc, btrim(v_g ->> 'nombre'), btrim(v_g ->> 'concepto'),
            btrim(v_g ->> 'destino'), v_valor, v_ruta, btrim(v_g -> 'soporte' ->> 'nombre'),
            nullif(v_g -> 'soporte' ->> 'mime', ''), nullif(v_g -> 'soporte' ->> 'tamano', '')::bigint);
    v_total := v_total + v_valor;
  end loop;

  update public.caja_menor_legalizaciones set n_gastos = v_n, valor_total = v_total where id = p_legalizacion;
  return v_total;
end;
$$;
revoke execute on function public._guardar_gastos_caja_menor(uuid, uuid, jsonb) from public;

-- Enviar (p_id null) o corregir y reenviar una devuelta (p_id). Vuelve a Financiera.
create or replace function public.enviar_legalizacion_caja_menor(p_id uuid, p_gastos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_caja record;
  v_l record;
  v_id uuid := p_id;
  v_total numeric;
begin
  if v_uid is null then
    raise exception 'Inicia sesión.';
  end if;
  if p_id is null then
    select * into v_caja from public.cajas_menores where responsable_id = v_uid and estado = 'abierta' for update;
    if v_caja.id is null then
      raise exception 'No tienes una caja menor abierta: pídela a Financiera.';
    end if;
    if exists (select 1 from public.caja_menor_legalizaciones l
                where l.caja_id = v_caja.id and l.estado in ('por_revisar', 'por_aprobar', 'devuelta')) then
      raise exception 'Ya tienes una legalización en curso: espera a que pase a Gerencia (o corrígela si te la devolvieron).';
    end if;
    insert into public.caja_menor_legalizaciones (caja_id, responsable_id, codigo, n_gastos, valor_total)
    values (v_caja.id, v_uid,
            'CM-' || public._numero_proyecto(v_caja.proyecto_id) || '-'
                  || public._con_ceros(public._siguiente_consecutivo(v_caja.proyecto_id, 'caja_menor'), 4),
            1, 1)
    returning id into v_id;
  else
    select * into v_l from public.caja_menor_legalizaciones where id = p_id for update;
    if v_l.id is null or v_l.responsable_id <> v_uid then
      raise exception 'La legalización no existe o no es tuya.';
    end if;
    if v_l.estado <> 'devuelta' then
      raise exception 'Solo se corrige una legalización devuelta.';
    end if;
    select * into v_caja from public.cajas_menores where id = v_l.caja_id;
    if v_caja.estado <> 'abierta' then
      raise exception 'La caja menor está cerrada.';
    end if;
  end if;

  v_total := public._guardar_gastos_caja_menor(v_id, v_uid, p_gastos);
  update public.caja_menor_legalizaciones
     set estado = 'por_revisar', enviada_en = now(),
         revisada_por = null, revisada_en = null, aprobada_por = null, aprobada_en = null
   where id = v_id;
  select * into v_l from public.caja_menor_legalizaciones where id = v_id;
  perform public._evento_caja_menor(v_id, case when p_id is null then 'enviada' else 'reenviada' end, null,
                                    jsonb_build_object('gastos', v_l.n_gastos, 'valor', v_l.valor_total));
  perform public._avisar_caja_menor(array(select public._usuarios_con_accion_caja('gestionar_cajas_menores')),
    'caja_menor_por_revisar', v_id, 'Caja menor ' || v_l.codigo || ' por revisar',
    (select nombre from public.perfiles where id = v_uid) || ' envió la legalización de su caja menor ('
      || v_l.n_gastos || ' gasto(s)). Revisa los soportes.');
  return v_id;
end;
$$;

create or replace function public.cancelar_legalizacion_caja_menor(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_l record;
begin
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'Escribe el motivo.';
  end if;
  select * into v_l from public.caja_menor_legalizaciones where id = p_id for update;
  if v_l.id is null or v_l.responsable_id <> auth.uid() then
    raise exception 'La legalización no existe o no es tuya.';
  end if;
  if v_l.estado not in ('por_revisar', 'devuelta') then
    raise exception 'Ya no se puede cancelar: Financiera ya la revisó.';
  end if;
  update public.caja_menor_legalizaciones
     set estado = 'cancelada', cancelada_en = now(), motivo_cancelacion = btrim(p_motivo)
   where id = p_id;
  perform public._evento_caja_menor(p_id, 'cancelada', p_motivo, null);
end;
$$;

-- 10. Revisión (Financiera) y okay (Líder Financiera) ------------------------------------
create or replace function public._devolver_legalizacion_caja_menor(p_l public.caja_menor_legalizaciones, p_motivo text, p_quien text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'Escribe el motivo de la devolución.';
  end if;
  update public.caja_menor_legalizaciones
     set estado = 'devuelta', devuelta_por = auth.uid(), devuelta_en = now(), motivo_devolucion = btrim(p_motivo)
   where id = p_l.id;
  perform public._evento_caja_menor(p_l.id, 'devuelta', p_motivo, jsonb_build_object('por', p_quien));
  perform public._avisar_caja_menor(array[p_l.responsable_id], 'caja_menor_devuelta', p_l.id,
    'Caja menor ' || p_l.codigo || ' devuelta',
    p_quien || ' la devolvió: ' || btrim(p_motivo) || '. Corrígela y envíala otra vez.');
end;
$$;
revoke execute on function public._devolver_legalizacion_caja_menor(public.caja_menor_legalizaciones, text, text) from public;

create or replace function public.revisar_legalizacion_caja_menor(p_id uuid, p_accion text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_l public.caja_menor_legalizaciones;
begin
  if not (public.es_admin(auth.uid()) or public.tiene_accion(auth.uid(), 'gestionar_cajas_menores')) then
    raise exception 'No autorizado -- no tienes permiso para revisar cajas menores.';
  end if;
  if p_accion not in ('aprobar', 'devolver') then
    raise exception 'Acción desconocida.';
  end if;
  select * into v_l from public.caja_menor_legalizaciones where id = p_id for update;
  if v_l.id is null or v_l.estado <> 'por_revisar' then
    raise exception 'La legalización no existe o ya no está por revisar.';
  end if;
  if p_accion = 'devolver' then
    perform public._devolver_legalizacion_caja_menor(v_l, p_motivo, 'Financiera');
    return;
  end if;
  update public.caja_menor_legalizaciones
     set estado = 'por_aprobar', revisada_por = auth.uid(), revisada_en = now()
   where id = p_id;
  perform public._evento_caja_menor(p_id, 'revisada', p_motivo, null);
  perform public._avisar_caja_menor(array(select public._usuarios_con_accion_caja('aprobar_cajas_menores')),
    'caja_menor_por_aprobar', p_id, 'Caja menor ' || v_l.codigo || ' por aprobar',
    'Financiera revisó los soportes de la caja menor de '
      || (select nombre from public.perfiles where id = v_l.responsable_id) || '. Falta tu okay.');
end;
$$;

-- Okay de Líder Financiera: crea el cuadro de pago para Gerencia. p_soporte es la
-- relación de gastos en PDF, ya subida por la app al bucket requisiciones_admin
-- (carpeta de quien aprueba).
create or replace function public.aprobar_legalizacion_caja_menor(p_id uuid, p_accion text, p_motivo text, p_soporte jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_l public.caja_menor_legalizaciones;
  v_c record;
  v_t record;
  v_req uuid;
  v_ruta text := nullif(btrim(coalesce(p_soporte ->> 'ruta', '')), '');
begin
  if not (public.es_admin(auth.uid()) or public.tiene_accion(auth.uid(), 'aprobar_cajas_menores')) then
    raise exception 'No autorizado -- no tienes permiso para aprobar cajas menores.';
  end if;
  if p_accion not in ('aprobar', 'devolver') then
    raise exception 'Acción desconocida.';
  end if;
  select * into v_l from public.caja_menor_legalizaciones where id = p_id for update;
  if v_l.id is null or v_l.estado <> 'por_aprobar' then
    raise exception 'La legalización no existe o ya no está por aprobar.';
  end if;
  if p_accion = 'devolver' then
    perform public._devolver_legalizacion_caja_menor(v_l, p_motivo, 'Líder Financiera');
    return null;
  end if;

  select * into v_c from public.cajas_menores where id = v_l.caja_id;
  select t.id, t.razon_social, t.tipo_documento, t.numero_documento, t.dv into v_t
    from public.terceros t where t.id = v_c.tercero_id;
  if not exists (select 1 from public.terceros_cuentas k
                  where k.id = v_c.cuenta_tercero_id and k.tercero_id = v_t.id and k.estado <> 'INACTIVO') then
    raise exception 'La cuenta de la caja está inactiva: Financiera debe cambiarla en Cajas menores antes de aprobar.';
  end if;
  if v_ruta is null or split_part(v_ruta, '/', 1) <> auth.uid()::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'requisiciones_admin' and o.name = v_ruta) then
    raise exception 'No se encontró la relación de gastos (PDF): vuelve a intentarlo.';
  end if;

  insert into public.requisiciones_admin (tipo, metodo, n_items, valor_total, creado_por, enviada_en)
  values ('caja_menor', 'transferencia', 1, v_l.valor_total, v_l.responsable_id, now())
  returning id into v_req;
  insert into public.requisicion_admin_items (
    requisicion_id, orden, metodo, empresa_id, tercero_factura_id, factura_nombre, factura_nit,
    titular_tercero_id, titular_nombre, titular_tipo_documento, titular_documento, cuenta_tercero_id,
    concepto, proyecto_id, valor, observaciones, soporte_ruta, soporte_nombre, soporte_mime, soporte_tamano,
    soporte_tipo, codigo, descuentos)
  values (
    v_req, 1, 'transferencia', v_c.empresa_id, v_t.id, v_t.razon_social,
    v_t.numero_documento || coalesce('-' || v_t.dv, ''),
    v_t.id, v_t.razon_social, v_t.tipo_documento, regexp_replace(v_t.numero_documento, '[^0-9]', '', 'g'),
    v_c.cuenta_tercero_id,
    'Reembolso caja menor ' || v_l.codigo, v_c.proyecto_id, v_l.valor_total,
    v_l.n_gastos || ' gasto(s) legalizados; revisó Financiera y aprobó Líder Financiera.',
    v_ruta, coalesce(nullif(btrim(p_soporte ->> 'nombre'), ''), 'Relación ' || v_l.codigo || '.pdf'),
    nullif(p_soporte ->> 'mime', ''), nullif(p_soporte ->> 'tamano', '')::bigint,
    'relacion_caja_menor', public._codigo_pago_admin(v_c.proyecto_id), 0);
  update public.requisiciones_admin set numero = nextval('public.requisiciones_admin_numero_seq') where id = v_req;
  perform public._crear_pagos_requisicion_admin(v_req);
  insert into public.historial_eventos (entidad_tipo, entidad_id, evento, usuario_id, datos)
  values ('requisicion_admin', v_req, 'creada', auth.uid(),
          jsonb_build_object('metodo', 'transferencia', 'items', 1, 'valor', v_l.valor_total, 'caja_menor', v_l.codigo));

  update public.caja_menor_legalizaciones
     set estado = 'en_gerencia', aprobada_por = auth.uid(), aprobada_en = now(), requisicion_admin_id = v_req
   where id = p_id;
  perform public._evento_caja_menor(p_id, 'aprobada_lider', p_motivo, jsonb_build_object('requisicion_admin_id', v_req));
  perform public._avisar_caja_menor(array[v_l.responsable_id], 'caja_menor_en_gerencia', p_id,
    'Caja menor ' || v_l.codigo || ' pasa a Gerencia',
    'Líder Financiera aprobó tu legalización: el reembolso pasa a Gerencia en Aprobación de pagos.');
  return v_req;
end;
$$;

-- Gerencia aprueba o rechaza el cuadro: la legalización lo sigue.
create or replace function public._caja_menor_sigue_cuadro()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_l record;
begin
  if new.tipo <> 'caja_menor' or new.estado is not distinct from old.estado then
    return new;
  end if;
  select * into v_l from public.caja_menor_legalizaciones
   where requisicion_admin_id = new.id and estado = 'en_gerencia' for update;
  if v_l.id is null then
    return new;
  end if;
  if new.estado = 'aprobada' then
    update public.caja_menor_legalizaciones set estado = 'aprobada' where id = v_l.id;
    perform public._evento_caja_menor(v_l.id, 'aprobada_gerencia', null, null);
    perform public._avisar_caja_menor(array[v_l.responsable_id], 'caja_menor_aprobada', v_l.id,
      'Reembolso de caja menor ' || v_l.codigo || ' aprobado',
      'Gerencia aprobó el pago del reembolso: pasa al consolidado para pagarse.');
  elsif new.estado in ('rechazada', 'cancelada') then
    update public.caja_menor_legalizaciones
       set estado = 'devuelta', devuelta_por = new.resuelta_por, devuelta_en = now(),
           motivo_devolucion = 'Gerencia rechazó el pago: ' || coalesce(new.motivo_rechazo, new.motivo_cancelacion, 'sin motivo')
     where id = v_l.id;
    perform public._evento_caja_menor(v_l.id, 'devuelta', 'Gerencia rechazó el pago: ' || coalesce(new.motivo_rechazo, ''),
                                      jsonb_build_object('por', 'Gerencia'));
    perform public._avisar_caja_menor(array[v_l.responsable_id], 'caja_menor_devuelta', v_l.id,
      'Caja menor ' || v_l.codigo || ' devuelta',
      'Gerencia rechazó el reembolso: ' || coalesce(new.motivo_rechazo, '') || '. Corrígela y envíala otra vez.');
  end if;
  return new;
end;
$$;
revoke execute on function public._caja_menor_sigue_cuadro() from public;
drop trigger if exists trg_caja_menor_sigue_cuadro on public.requisiciones_admin;
create trigger trg_caja_menor_sigue_cuadro after update of estado on public.requisiciones_admin
  for each row execute function public._caja_menor_sigue_cuadro();

-- 11. Lecturas para las pantallas --------------------------------------------------------
create or replace function public._legalizacion_caja_menor_fila(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'codigo', l.codigo, 'estado', l.estado, 'n_gastos', l.n_gastos, 'valor_total', l.valor_total,
    'caja_id', l.caja_id, 'caja_numero', c.numero, 'caja_monto', c.monto,
    'responsable_id', l.responsable_id, 'responsable_nombre', pr.nombre,
    'proyecto_codigo', p.codigo, 'proyecto_nombre', p.nombre, 'empresa_nombre', e.razon_social,
    'enviada_en', l.enviada_en, 'revisada_en', l.revisada_en, 'revisada_por_nombre', rv.nombre,
    'aprobada_en', l.aprobada_en, 'aprobada_por_nombre', ap.nombre,
    'devuelta_en', l.devuelta_en, 'devuelta_por_nombre', dv.nombre, 'motivo_devolucion', l.motivo_devolucion,
    'cancelada_en', l.cancelada_en, 'motivo_cancelacion', l.motivo_cancelacion,
    'requisicion_admin_id', l.requisicion_admin_id,
    'cuadro_numero', ra.numero, 'cuadro_estado', ra.estado,
    'cuadro_codigo', (select i.codigo from public.requisicion_admin_items i where i.requisicion_id = ra.id order by i.orden limit 1),
    'es_mia', l.responsable_id = auth.uid())
  from public.caja_menor_legalizaciones l
  join public.cajas_menores c on c.id = l.caja_id
  join public.perfiles pr on pr.id = l.responsable_id
  join public.proyectos p on p.id = c.proyecto_id
  join public.empresas e on e.id = c.empresa_id
  left join public.perfiles rv on rv.id = l.revisada_por
  left join public.perfiles ap on ap.id = l.aprobada_por
  left join public.perfiles dv on dv.id = l.devuelta_por
  left join public.requisiciones_admin ra on ra.id = l.requisicion_admin_id
  where l.id = p_id
$$;
revoke execute on function public._legalizacion_caja_menor_fila(uuid) from public;

-- p_solo_mias: las del responsable (Pagos administrativos); si no, todas (A&F).
create or replace function public.listar_legalizaciones_caja_menor(p_estado text, p_solo_mias boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if not p_solo_mias and not public._ve_cajas_menores(v_uid) then
    raise exception 'No autorizado.';
  end if;
  return coalesce((
    select jsonb_agg(public._legalizacion_caja_menor_fila(x.id) order by x.enviada_en desc)
      from (select l.id, l.enviada_en from public.caja_menor_legalizaciones l
             where (not p_solo_mias or l.responsable_id = v_uid)
               and (p_estado is null or p_estado = '' or l.estado = p_estado)
             order by l.enviada_en desc limit 500) x), '[]'::jsonb);
end;
$$;

create or replace function public.detalle_legalizacion_caja_menor(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_l record;
begin
  select * into v_l from public.caja_menor_legalizaciones where id = p_id;
  if v_l.id is null or (v_l.responsable_id is distinct from auth.uid() and not public._ve_cajas_menores(auth.uid())) then
    raise exception 'La legalización no existe o no tienes acceso.';
  end if;
  return public._legalizacion_caja_menor_fila(p_id) || jsonb_build_object(
    'gastos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'orden', g.orden, 'fecha', g.fecha, 'proyecto_id', g.proyecto_id,
               'proyecto_codigo', p.codigo, 'proyecto_nombre', p.nombre,
               'solicitado_por_nombre', sp.nombre, 'numero_factura', g.numero_factura,
               'documento', g.documento, 'nombre', g.nombre, 'concepto', g.concepto, 'destino', g.destino,
               'valor', g.valor,
               'soporte', jsonb_build_object('ruta', g.soporte_ruta, 'nombre', g.soporte_nombre,
                                             'mime', g.soporte_mime, 'tamano', g.soporte_tamano)
             ) order by g.orden)
        from public.caja_menor_gastos g
        join public.proyectos p on p.id = g.proyecto_id
        left join public.perfiles sp on sp.id = g.solicitado_por
       where g.legalizacion_id = p_id), '[]'::jsonb),
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object('evento', h.evento, 'fecha', h.created_at, 'usuario_nombre', u.nombre,
                                          'motivo', h.motivo, 'datos', h.datos) order by h.created_at)
        from public.historial_eventos h
        left join public.perfiles u on u.id = h.usuario_id
       where h.entidad_tipo = 'caja_menor' and h.entidad_id = p_id), '[]'::jsonb),
    'caja', public._caja_menor_json(v_l.caja_id));
end;
$$;

-- La legalización de un cuadro de caja menor (desde el detalle del pago).
create or replace function public.legalizacion_de_cuadro(p_requisicion_admin_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select l.id from public.caja_menor_legalizaciones l
   where l.requisicion_admin_id = p_requisicion_admin_id
     and (l.responsable_id = auth.uid() or public._ve_cajas_menores(auth.uid()))
   order by l.aprobada_en desc nulls last limit 1
$$;

-- Personas para elegir el responsable (Financiera).
create or replace function public.personas_caja_menor()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.es_admin(auth.uid()) or public.tiene_accion(auth.uid(), 'gestionar_cajas_menores')) then
    raise exception 'No autorizado.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre)
                     from public.perfiles p where btrim(coalesce(p.nombre, '')) <> ''), '[]'::jsonb);
end;
$$;

-- 12. Parches a funciones vivas (reemplazo de texto exacto) ------------------------------
do $$
declare
  v text;
  ancla text;
  procedure_cambia text;
begin
  -- El reembolso de una caja menor no se modifica ni se cancela como cuadro:
  -- se corrige desde Caja menor (Gerencia lo rechaza y vuelve al responsable).
  foreach procedure_cambia in array array['public.modificar_requisicion_admin(uuid, text, jsonb)',
                                          'public.cancelar_requisicion_admin(uuid, text)'] loop
    v := pg_get_functiondef(procedure_cambia::regprocedure);
    continue when position('caja_menor' in v) > 0; -- ya parchada
    ancla := E'    raise exception ''La requisición no existe o no la hiciste tú.'';\n  end if;\n';
    if (length(v) - length(replace(v, ancla, ''))) / length(ancla) <> 1 then
      raise exception '% cambió: no se encontró el control de quién la hizo.', procedure_cambia;
    end if;
    execute replace(v, ancla, ancla
      || E'  if v_r.tipo = ''caja_menor'' then\n'
      || E'    raise exception ''Este pago es el reembolso de una caja menor: se corrige desde Caja menor.'';\n'
      || E'  end if;\n');
  end loop;

  -- Detalle: tipo del cuadro y no editable si es de caja menor.
  v := pg_get_functiondef('public.detalle_requisicion_admin(uuid)'::regprocedure);
  ancla := $a$'editable', v_r.estado in ('por_aprobar', 'rechazada')$a$;
  if position('caja_menor_legalizacion_id' in v) > 0 then
    null; -- ya parchada
  elsif (length(v) - length(replace(v, ancla, ''))) / length(ancla) <> 1 then
    raise exception 'detalle_requisicion_admin cambió: no se encontró editable.';
  else
  v := replace(v, ancla, $a$'tipo', v_r.tipo,
    'caja_menor_legalizacion_id', (select l.id from public.caja_menor_legalizaciones l where l.requisicion_admin_id = v_r.id order by l.aprobada_en desc nulls last limit 1),
    'editable', v_r.tipo = 'cuadro' and v_r.estado in ('por_aprobar', 'rechazada')$a$);
  execute v;
  end if;

  -- Aprobar / rechazar el cuadro: el aviso de caja menor lo da su disparador.
  foreach procedure_cambia in array array['public.aprobar_requisicion_admin(uuid)',
                                          'public.rechazar_requisicion_admin(uuid, text)'] loop
    v := pg_get_functiondef(procedure_cambia::regprocedure);
    continue when position('v_r.tipo = ''cuadro''' in v) > 0; -- ya parchada
    ancla := E'  if v_r.creado_por is distinct from auth.uid() then\n';
    if (length(v) - length(replace(v, ancla, ''))) / length(ancla) <> 1 then
      raise exception '% cambió: no se encontró el aviso a quien la hizo.', procedure_cambia;
    end if;
    execute replace(v, ancla, E'  if v_r.creado_por is distinct from auth.uid() and v_r.tipo = ''cuadro'' then\n');
  end loop;

  -- Copia en Drive: los soportes de los gastos, en la carpeta del proyecto de la caja.
  v := pg_get_functiondef('public._drive_destino(text, text)'::regprocedure);
  ancla := E'  elsif p_bucket = ''sinco'' then\n';
  if position('cajas_menores' in v) > 0 then
    null; -- ya parchada
  elsif (length(v) - length(replace(v, ancla, ''))) / length(ancla) <> 1 then
    raise exception '_drive_destino cambió: no se encontró la rama de sinco.';
  else
  execute replace(v, ancla,
       E'  elsif p_bucket = ''cajas_menores'' then\n'
    || E'    select c.proyecto_id, l.codigo, l.enviada_en, g.orden, g.soporte_nombre into r\n'
    || E'      from public.caja_menor_gastos g\n'
    || E'      join public.caja_menor_legalizaciones l on l.id = g.legalizacion_id\n'
    || E'      join public.cajas_menores c on c.id = l.caja_id\n'
    || E'     where g.soporte_ruta = p_ruta order by l.enviada_en desc limit 1;\n'
    || E'    if found then\n'
    || E'      return public._drive_resultado(r.proyecto_id,\n'
    || E'        array[''Cajas menores'', public._drive_semana(r.enviada_en), r.codigo],\n'
    || E'        ''Gasto '' || lpad(r.orden::text, 2, ''0'') || '' - '' || coalesce(r.soporte_nombre, v_archivo));\n'
    || E'    end if;\n\n'
    || ancla);
  end if;

  -- Mis pendientes: revisar (Financiera), aprobar (Líder Financiera), devuelta y
  -- corte del 27 (responsable). Se agregan al final.
  v := pg_get_functiondef('public._pendientes_de(uuid)'::regprocedure);
  ancla := E'   group by c.id, c.numero, c.archivo, c.cargado_en, c.cargado_por;\n';
  if position('caja_menor_por_revisar' in v) > 0 then
    null; -- ya parchada
  elsif (length(v) - length(replace(v, ancla, ''))) / length(ancla) <> 1 then
    raise exception '_pendientes_de cambió: no se encontró el final (soportes de SINCO).';
  else
  execute replace(v, ancla,
       E'   group by c.id, c.numero, c.archivo, c.cargado_en, c.cargado_por\n\n'
    || E'  -- ------------------------------------------------ Caja menor (20270101007400)\n'
    || E'  union all\n'
    || E'  select ''caja_menor_por_revisar'', ''hacer'', l.id, k.proyecto_id,\n'
    || E'         ''Caja menor '' || l.codigo, concat_ws('' · '', pf.nombre, l.n_gastos || '' gasto(s)''),\n'
    || E'         l.valor_total, l.enviada_en, l.responsable_id, null::date, ''/ayf/cajas-menores?ver='' || l.id\n'
    || E'    from caja_menor_legalizaciones l\n'
    || E'    join cajas_menores k on k.id = l.caja_id\n'
    || E'    left join perfiles pf on pf.id = l.responsable_id\n'
    || E'   where l.estado = ''por_revisar'' and public.tiene_accion(p_uid, ''gestionar_cajas_menores'')\n'
    || E'  union all\n'
    || E'  select ''caja_menor_por_aprobar'', ''hacer'', l.id, k.proyecto_id,\n'
    || E'         ''Caja menor '' || l.codigo, concat_ws('' · '', pf.nombre, l.n_gastos || '' gasto(s)''),\n'
    || E'         l.valor_total, l.revisada_en, l.responsable_id, null::date, ''/ayf/cajas-menores?ver='' || l.id\n'
    || E'    from caja_menor_legalizaciones l\n'
    || E'    join cajas_menores k on k.id = l.caja_id\n'
    || E'    left join perfiles pf on pf.id = l.responsable_id\n'
    || E'   where l.estado = ''por_aprobar'' and public.tiene_accion(p_uid, ''aprobar_cajas_menores'')\n'
    || E'  union all\n'
    || E'  select ''mi_caja_menor_devuelta'', ''hacer'', l.id, k.proyecto_id,\n'
    || E'         ''Caja menor '' || l.codigo, coalesce(l.motivo_devolucion, ''Devuelta''),\n'
    || E'         l.valor_total, l.devuelta_en, l.devuelta_por, null::date, ''/ayf/pagos-administrativos?caja_menor='' || l.id\n'
    || E'    from caja_menor_legalizaciones l\n'
    || E'    join cajas_menores k on k.id = l.caja_id\n'
    || E'   where l.estado = ''devuelta'' and l.responsable_id = p_uid\n'
    || E'  union all\n'
    || E'  select ''caja_menor_corte'', ''hacer'', k.id, k.proyecto_id,\n'
    || E'         ''Caja menor N° '' || k.numero, ''Corte del 27: envía la legalización de los gastos del mes'',\n'
    || E'         null::numeric, null::timestamptz, null::uuid,\n'
    || E'         (date_trunc(''month'', v_hoy) + interval ''1 month - 1 day'')::date, ''/ayf/pagos-administrativos?caja_menor=nueva''\n'
    || E'    from cajas_menores k\n'
    || E'   where k.responsable_id = p_uid and k.estado = ''abierta'' and extract(day from v_hoy) >= 27\n'
    || E'     and not exists (select 1 from caja_menor_legalizaciones l\n'
    || E'                      where l.caja_id = k.id and l.estado <> ''cancelada''\n'
    || E'                        and (l.enviada_en at time zone ''America/Bogota'')::date >= date_trunc(''month'', v_hoy)::date + 26);\n');
  end if;
end;
$$;

-- 13. Permisos de ejecución -------------------------------------------------------------
revoke execute on function public.guardar_caja_menor(uuid, jsonb) from public;
revoke execute on function public.cerrar_caja_menor(uuid, text) from public;
revoke execute on function public.mi_caja_menor() from public;
revoke execute on function public.listar_cajas_menores(boolean) from public;
revoke execute on function public.enviar_legalizacion_caja_menor(uuid, jsonb) from public;
revoke execute on function public.cancelar_legalizacion_caja_menor(uuid, text) from public;
revoke execute on function public.revisar_legalizacion_caja_menor(uuid, text, text) from public;
revoke execute on function public.aprobar_legalizacion_caja_menor(uuid, text, text, jsonb) from public;
revoke execute on function public.listar_legalizaciones_caja_menor(text, boolean) from public;
revoke execute on function public.detalle_legalizacion_caja_menor(uuid) from public;
revoke execute on function public.legalizacion_de_cuadro(uuid) from public;
revoke execute on function public.personas_caja_menor() from public;
grant execute on function public.guardar_caja_menor(uuid, jsonb) to authenticated;
grant execute on function public.cerrar_caja_menor(uuid, text) to authenticated;
grant execute on function public.mi_caja_menor() to authenticated;
grant execute on function public.listar_cajas_menores(boolean) to authenticated;
grant execute on function public.enviar_legalizacion_caja_menor(uuid, jsonb) to authenticated;
grant execute on function public.cancelar_legalizacion_caja_menor(uuid, text) to authenticated;
grant execute on function public.revisar_legalizacion_caja_menor(uuid, text, text) to authenticated;
grant execute on function public.aprobar_legalizacion_caja_menor(uuid, text, text, jsonb) to authenticated;
grant execute on function public.listar_legalizaciones_caja_menor(text, boolean) to authenticated;
grant execute on function public.detalle_legalizacion_caja_menor(uuid) to authenticated;
grant execute on function public.legalizacion_de_cuadro(uuid) to authenticated;
grant execute on function public.personas_caja_menor() to authenticated;

commit;
