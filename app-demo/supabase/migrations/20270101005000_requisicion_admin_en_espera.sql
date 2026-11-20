-- Requisición administrativa en espera de insumos nuevos (decisión del
-- usuario, 2026-11-20).
--
-- Antes, quien hacía una requisición administrativa y no encontraba un insumo
-- en el maestro lo pedía a Aprobación de insumos, pero no lo podía poner en la
-- requisición: cuando se lo aprobaban tenía que volver y hacerla otra vez.
-- Ahora el insumo nuevo va como una línea más (con su cantidad) y la
-- requisición se envía UNA vez:
-- - Se guarda "en espera" (requisiciones_admin_espera) con sus líneas del
--   maestro y sus insumos nuevos (requisiciones_admin_espera_nuevos, cada uno
--   con su solicitud de insumo, origen requisicion_administrativa).
-- - Cuando Aprobación de insumos aprueba el ÚLTIMO insumo nuevo, la base crea
--   la requisición de siempre (_crear_requisicion_administrativa, a nombre de
--   quien la pidió) con todas las líneas y pasa a Subgerencia. El número RQ se
--   da en ese momento. Si la fecha requerida ya pasó, se usa la de hoy.
-- - Si rechazan un insumo nuevo, se avisa a quien la pidió con el motivo: lo
--   cambia por uno del maestro o lo quita (resolver_insumo_rechazado_espera) y
--   la requisición sigue sola. También la puede cancelar.
-- - Si la requisición no se puede crear al final (p. ej. el proyecto ya no
--   tiene presupuesto), queda en "error" con el motivo y se avisa; se puede
--   reintentar o cancelar.
-- Avisos (campanita y correo): requisicion_espera_enviada,
-- insumo_requisicion_rechazado, requisicion_espera_error. Los avisos de
-- siempre de insumo aprobado/rechazado no salen para estas solicitudes.
--
-- Va ANTES del código. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  p_a := replace(p_a, E'\r\n', E'\n');
  p_b := replace(p_b, E'\r\n', E'\n');
  if position(p_a in d) = 0 then
    raise exception 'No se encontró el texto a reemplazar en %: %', p_fn, left(p_a, 80);
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

-- 1. Tablas ------------------------------------------------------------------
create table if not exists public.requisiciones_admin_espera (
  id uuid primary key default gen_random_uuid(),
  solicitado_por uuid not null references public.perfiles(id),
  proyecto_id uuid not null references public.proyectos(id),
  fecha_requerida date not null,
  urgente boolean not null default false,
  observaciones text,
  direccion_entrega text not null,
  -- líneas del maestro: [{insumo_id, cantidad}]
  lineas jsonb not null default '[]'::jsonb,
  estado text not null default 'esperando'
    constraint requisiciones_admin_espera_estado_check check (estado in ('esperando', 'enviada', 'cancelada', 'error')),
  error text,
  requisicion_id uuid references public.requisiciones(id) on delete set null,
  created_at timestamptz not null default now(),
  enviada_at timestamptz,
  cancelada_at timestamptz,
  motivo_cancelacion text
);
create index if not exists requisiciones_admin_espera_solicitado_idx
  on public.requisiciones_admin_espera (solicitado_por, created_at desc);

create table if not exists public.requisiciones_admin_espera_nuevos (
  id uuid primary key default gen_random_uuid(),
  espera_id uuid not null references public.requisiciones_admin_espera(id) on delete cascade,
  -- La solicitud se borra al resolverse: antes se guarda el insumo creado.
  solicitud_id uuid references public.solicitudes_insumos(id) on delete set null,
  descripcion text not null,
  unidad text,
  cantidad numeric not null
    constraint requisiciones_admin_espera_nuevos_cantidad_check check (cantidad > 0 and cantidad = trunc(cantidad)),
  estado text not null default 'esperando'
    constraint requisiciones_admin_espera_nuevos_estado_check check (estado in ('esperando', 'aprobado', 'rechazado')),
  insumo_id uuid references public.maestro_insumos(id),
  motivo_rechazo text,
  resuelto_at timestamptz
);
create index if not exists requisiciones_admin_espera_nuevos_espera_idx on public.requisiciones_admin_espera_nuevos (espera_id);
create index if not exists requisiciones_admin_espera_nuevos_solicitud_idx on public.requisiciones_admin_espera_nuevos (solicitud_id);

-- Solo por funciones (SECURITY DEFINER): sin políticas, nadie lee ni escribe directo.
alter table public.requisiciones_admin_espera enable row level security;
alter table public.requisiciones_admin_espera_nuevos enable row level security;
revoke all on public.requisiciones_admin_espera, public.requisiciones_admin_espera_nuevos from anon, authenticated;

-- 2. Crear la requisición a nombre de otra persona ---------------------------
-- La requisición en espera se crea cuando se aprueba el último insumo, en la
-- sesión de quien aprueba: app.requisicion_por dice a nombre de quién va (solo
-- lo pone _enviar_requisicion_espera, dentro de la misma transacción).
select pg_temp._parche('public._crear_requisicion_administrativa(uuid,jsonb,date,boolean,text,text)'::regprocedure,
  '  v_uid uuid := auth.uid();',
  '  v_uid uuid := coalesce(nullif(current_setting(''app.requisicion_por'', true), '''')::uuid, auth.uid());');
select pg_temp._parche('public._evento_requisicion(uuid,text,text,jsonb)'::regprocedure,
  'values (''requisicion'', p_id, p_evento, auth.uid(), p_motivo, p_datos)',
  'values (''requisicion'', p_id, p_evento,
          coalesce(nullif(current_setting(''app.requisicion_por'', true), '''')::uuid, auth.uid()), p_motivo, p_datos)');

-- 3. Avisos ------------------------------------------------------------------
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo = any (array[
  'contrato_tope_autorizado', 'contrato_sobre_tope', 'orden_compra_devuelta', 'cuadro_sinco_soportes',
  'acta_por_facturar', 'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
  'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar', 'contrato_aprobado',
  'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada', 'minuta_por_revisar',
  'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido', 'contrato_vencido_juridica', 'insumo_rechazado',
  'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado',
  'otrosi_devuelto_subgerencia', 'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta',
  'requisicion_admin_aprobada', 'requisicion_admin_rechazada', 'requisicion_extraordinaria',
  'requisicion_administrativa', 'insumo_por_convertir', 'requisicion_administrativa_por_aprobar',
  'requisicion_administrativa_aprobada', 'requisicion_administrativa_rechazada', 'insumo_aprobado',
  'autorizacion_tercero_por_revisar', 'autorizacion_tercero_aprobada', 'autorizacion_tercero_rechazada',
  'requisicion_comprada',
  'requisicion_espera_enviada', 'insumo_requisicion_rechazado', 'requisicion_espera_error'
]::text[])) not valid;

alter table public.notificaciones drop constraint if exists notificaciones_entidad_tipo_check;
alter table public.notificaciones add constraint notificaciones_entidad_tipo_check check (entidad_tipo = any (array[
  'cuadro_sinco', 'pedido_insumo', 'orden_compra', 'requisicion', 'contrato', 'acta', 'presupuesto', 'otrosi',
  'requisicion_admin', 'requisicion_espera'
]::text[])) not valid;

update public.ajustes_correo
   set tipos = tipos || array(select t from unnest(array['requisicion_espera_enviada', 'insumo_requisicion_rechazado',
                                                         'requisicion_espera_error']) t
                               where not t = any(tipos));

-- Los avisos de siempre ("Ya puedes hacer la requisición", "fue rechazado")
-- no salen para insumos de una requisición en espera: sale el suyo.
select pg_temp._parche('public._notificar_insumo_aprobado()'::regprocedure,
  '  if new.solicitado_por is null or new.solicitado_por = new.resuelto_por then',
  '  if exists (select 1 from public.requisiciones_admin_espera_nuevos x where x.solicitud_id = new.id) then
    return new;
  end if;
  if new.solicitado_por is null or new.solicitado_por = new.resuelto_por then');
select pg_temp._parche('public._notificar_insumo_rechazado()'::regprocedure,
  '  if new.solicitado_por is null or new.solicitado_por = new.resuelto_por then',
  '  if exists (select 1 from public.requisiciones_admin_espera_nuevos x where x.solicitud_id = new.id) then
    return new;
  end if;
  if new.solicitado_por is null or new.solicitado_por = new.resuelto_por then');

-- 4. Enviar la requisición cuando ya no falta nada ---------------------------
create or replace function public._enviar_requisicion_espera(p_espera uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  e record;
  v_lineas jsonb;
  v_res jsonb;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_previo text := coalesce(current_setting('app.requisicion_por', true), '');
begin
  select * into e from requisiciones_admin_espera where id = p_espera for update;
  if not found or e.estado <> 'esperando' then return; end if;
  if exists (select 1 from requisiciones_admin_espera_nuevos n
              where n.espera_id = p_espera and n.estado in ('esperando', 'rechazado')) then
    return;
  end if;

  -- Líneas del maestro + insumos nuevos ya aprobados (un insumo repetido suma).
  select coalesce(jsonb_agg(jsonb_build_object('insumo_id', insumo_id, 'cantidad', cantidad)), '[]'::jsonb)
    into v_lineas
    from (select insumo_id, sum(cantidad) as cantidad
            from (select (x->>'insumo_id')::uuid as insumo_id, (x->>'cantidad')::numeric as cantidad
                    from jsonb_array_elements(e.lineas) x
                  union all
                  select n.insumo_id, n.cantidad
                    from requisiciones_admin_espera_nuevos n
                   where n.espera_id = p_espera and n.estado = 'aprobado' and n.insumo_id is not null) l
           group by insumo_id) t;

  if jsonb_array_length(v_lineas) = 0 then
    update requisiciones_admin_espera set estado = 'cancelada', cancelada_at = now(),
           motivo_cancelacion = 'Se quitaron todos los insumos.'
     where id = p_espera;
    return;
  end if;

  perform set_config('app.requisicion_por', e.solicitado_por::text, true);
  begin
    v_res := _crear_requisicion_administrativa(e.proyecto_id, v_lineas, greatest(e.fecha_requerida, v_hoy),
                                               e.urgente, e.observaciones, e.direccion_entrega);
  exception when others then
    perform set_config('app.requisicion_por', v_previo, true);
    update requisiciones_admin_espera set estado = 'error', error = sqlerrm where id = p_espera;
    perform notificar_una(e.solicitado_por, 'requisicion_espera_error', 'requisicion_espera', p_espera,
      'Tu requisición administrativa no se pudo enviar',
      'Ya se aprobaron los insumos nuevos, pero la requisición no se pudo crear: ' || sqlerrm
        || ' Ábrela en Mis requisiciones para reintentar o cancelarla.');
    return;
  end;
  perform set_config('app.requisicion_por', v_previo, true);

  update requisiciones_admin_espera
     set estado = 'enviada', requisicion_id = (v_res->>'id')::uuid, enviada_at = now(), error = null
   where id = p_espera;
  perform notificar_una(e.solicitado_por, 'requisicion_espera_enviada', 'requisicion', (v_res->>'id')::uuid,
    'Tu requisición pasó a aprobación',
    'Ya se aprobaron los insumos nuevos de tu requisición administrativa: quedó como '
      || coalesce(v_res->>'codigo', 'requisición') || ' y pasó a aprobación de Subgerencia.');
end;
$$;
revoke all on function public._enviar_requisicion_espera(uuid) from public, anon, authenticated;

-- 5. Seguir a la solicitud del insumo nuevo ----------------------------------
create or replace function public._requisicion_espera_sigue_solicitud()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_espera uuid;
  v_insumo uuid;
begin
  if old.estado is not distinct from new.estado or old.estado <> 'pendiente' then
    return new;
  end if;
  if not exists (select 1 from requisiciones_admin_espera_nuevos where solicitud_id = new.id) then
    return new;
  end if;

  if new.estado = 'aprobado' then
    select id into v_insumo from maestro_insumos where codigo = new.codigo_maestro_asignado;
    for v_espera in
      update requisiciones_admin_espera_nuevos
         set estado = 'aprobado', insumo_id = v_insumo, resuelto_at = now()
       where solicitud_id = new.id and estado = 'esperando'
      returning espera_id
    loop
      perform _enviar_requisicion_espera(v_espera);
    end loop;
  elsif new.estado = 'rechazado' then
    for v_espera in
      update requisiciones_admin_espera_nuevos
         set estado = 'rechazado', motivo_rechazo = nullif(btrim(new.motivo_rechazo), ''), resuelto_at = now()
       where solicitud_id = new.id and estado = 'esperando'
      returning espera_id
    loop
      perform notificar_una(e.solicitado_por, 'insumo_requisicion_rechazado', 'requisicion_espera', e.id,
        'Un insumo de tu requisición fue rechazado',
        '"' || new.descripcion || '" fue rechazado en Aprobación de insumos.'
          || coalesce(' Motivo: ' || nullif(btrim(new.motivo_rechazo), '') || '.', '')
          || ' Abre la requisición en Mis requisiciones para cambiarlo por otro insumo o quitarlo.')
        from requisiciones_admin_espera e where e.id = v_espera and e.estado = 'esperando';
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public._requisicion_espera_sigue_solicitud() from public, anon, authenticated;

drop trigger if exists trg_requisicion_espera_sigue_solicitud on public.solicitudes_insumos;
create trigger trg_requisicion_espera_sigue_solicitud
  after update of estado on public.solicitudes_insumos
  for each row execute function public._requisicion_espera_sigue_solicitud();

-- 6. Crear la requisición en espera ------------------------------------------
-- p_lineas: [{insumo_id, cantidad}] del maestro (puede ir vacía).
-- p_nuevos: [{descripcion, unidad, cantidad}] (al menos uno).
create or replace function public.crear_requisicion_administrativa_en_espera(
  p_proyecto_id uuid, p_lineas jsonb, p_nuevos jsonb, p_fecha_requerida date, p_urgente boolean,
  p_observaciones text, p_direccion_entrega text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_dir text := nullif(btrim(coalesce(p_direccion_entrega, '')), '');
  v_obs text := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_n_lineas int;
  v_n_nuevos int;
  v_sol uuid;
  l record;
begin
  if v_uid is null then raise exception 'Inicia sesión.'; end if;
  if p_proyecto_id is null then raise exception 'Elige FUNCIONAMIENTO o un proyecto.'; end if;
  if not exists (select 1 from proyectos where id = p_proyecto_id
                  and (funcionamiento or id in (select proyectos_visibles(v_uid)))) then
    raise exception 'El proyecto no existe o no tienes acceso.';
  end if;
  if _item_requisicion_administrativa(p_proyecto_id) is null then
    raise exception 'El proyecto no tiene presupuesto cargado: pide la requisición para FUNCIONAMIENTO o carga el presupuesto.';
  end if;
  if v_dir is null then raise exception 'La dirección de entrega es obligatoria.'; end if;
  if length(v_dir) > 300 then raise exception 'La dirección de entrega puede tener máximo 300 caracteres.'; end if;
  if p_fecha_requerida is null then raise exception 'La fecha requerida es obligatoria.'; end if;
  if p_fecha_requerida < (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha requerida no puede ser anterior a hoy.';
  end if;

  if p_lineas is null then p_lineas := '[]'::jsonb; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_typeof(coalesce(p_nuevos, 'null'::jsonb)) <> 'array' then
    raise exception 'Lista de insumos inválida.';
  end if;
  v_n_lineas := jsonb_array_length(p_lineas);
  v_n_nuevos := jsonb_array_length(p_nuevos);
  if v_n_nuevos = 0 then raise exception 'No hay insumos nuevos: envía la requisición normal.'; end if;
  if v_n_lineas + v_n_nuevos > 50 then raise exception 'Una requisición puede tener máximo 50 insumos.'; end if;

  if (select count(distinct x.insumo_id) from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric)) <> v_n_lineas then
    raise exception 'Hay un insumo repetido en la requisición.';
  end if;
  for l in select * from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric) loop
    if l.insumo_id is null or not exists (select 1 from maestro_insumos mi where mi.id = l.insumo_id) then
      raise exception 'Hay un insumo que no existe en el maestro.';
    end if;
    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero.';
    end if;
  end loop;
  for l in select * from jsonb_to_recordset(p_nuevos) as x(descripcion text, unidad text, cantidad numeric) loop
    if nullif(btrim(coalesce(l.descripcion, '')), '') is null then raise exception 'Escribe el nombre de cada insumo nuevo.'; end if;
    if length(btrim(l.descripcion)) > 300 then raise exception 'El nombre de un insumo nuevo puede tener máximo 300 caracteres.'; end if;
    if nullif(btrim(coalesce(l.unidad, '')), '') is null then raise exception 'Elige la unidad de "%".', btrim(l.descripcion); end if;
    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'La cantidad de "%" debe ser un número entero mayor que cero.', btrim(l.descripcion);
    end if;
  end loop;

  insert into requisiciones_admin_espera (solicitado_por, proyecto_id, fecha_requerida, urgente, observaciones,
                                          direccion_entrega, lineas)
  values (v_uid, p_proyecto_id, p_fecha_requerida, coalesce(p_urgente, false), v_obs, v_dir,
          (select coalesce(jsonb_agg(jsonb_build_object('insumo_id', x.insumo_id, 'cantidad', x.cantidad)), '[]'::jsonb)
             from jsonb_to_recordset(p_lineas) as x(insumo_id uuid, cantidad numeric)))
  returning id into v_id;

  for l in select * from jsonb_to_recordset(p_nuevos) as x(descripcion text, unidad text, cantidad numeric) loop
    insert into solicitudes_insumos (descripcion, u_m, solicitado_por, estado, origen, proyecto_id)
    values (btrim(l.descripcion), btrim(l.unidad), v_uid, 'pendiente', 'requisicion_administrativa', p_proyecto_id)
    returning id into v_sol;
    insert into requisiciones_admin_espera_nuevos (espera_id, solicitud_id, descripcion, unidad, cantidad)
    values (v_id, v_sol, btrim(l.descripcion), btrim(l.unidad), l.cantidad);
  end loop;

  return jsonb_build_object('id', v_id);
end;
$$;
revoke all on function public.crear_requisicion_administrativa_en_espera(uuid, jsonb, jsonb, date, boolean, text, text) from public, anon;
grant execute on function public.crear_requisicion_administrativa_en_espera(uuid, jsonb, jsonb, date, boolean, text, text) to authenticated;

-- 7. Lo que ve quien la pidió -------------------------------------------------
create or replace function public.mis_requisiciones_en_espera()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'estado', e.estado, 'error', e.error, 'created_at', e.created_at,
           'fecha_requerida', e.fecha_requerida, 'urgente', e.urgente, 'observaciones', e.observaciones,
           'direccion_entrega', e.direccion_entrega,
           'proyecto', (select coalesce(p.codigo || ' - ', '') || p.nombre from proyectos p where p.id = e.proyecto_id),
           'lineas', (select coalesce(jsonb_agg(jsonb_build_object(
                         'insumo_id', mi.id, 'codigo', mi.codigo, 'descripcion', mi.descripcion, 'unidad', mi.u_m,
                         'cantidad', (x->>'cantidad')::numeric) order by mi.descripcion), '[]'::jsonb)
                        from jsonb_array_elements(e.lineas) x
                        join maestro_insumos mi on mi.id = (x->>'insumo_id')::uuid),
           'nuevos', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', n.id, 'descripcion', n.descripcion, 'unidad', n.unidad, 'cantidad', n.cantidad,
                         'estado', n.estado, 'motivo_rechazo', n.motivo_rechazo,
                         'codigo', (select mi.codigo from maestro_insumos mi where mi.id = n.insumo_id)) order by n.descripcion),
                         '[]'::jsonb)
                        from requisiciones_admin_espera_nuevos n where n.espera_id = e.id)
         ) order by e.created_at desc), '[]'::jsonb)
    from requisiciones_admin_espera e
   where e.solicitado_por = auth.uid() and e.estado in ('esperando', 'error')
$$;
revoke all on function public.mis_requisiciones_en_espera() from public, anon;
grant execute on function public.mis_requisiciones_en_espera() to authenticated;

-- 8. Insumo rechazado: cambiarlo por uno del maestro o quitarlo ---------------
create or replace function public.resolver_insumo_rechazado_espera(p_nuevo uuid, p_insumo uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  n record;
  e record;
begin
  select * into n from requisiciones_admin_espera_nuevos where id = p_nuevo;
  if not found then raise exception 'El insumo ya no está en la requisición.'; end if;
  select * into e from requisiciones_admin_espera where id = n.espera_id for update;
  if e.solicitado_por is distinct from v_uid then raise exception 'Solo quien hizo la requisición puede cambiarla.'; end if;
  if e.estado <> 'esperando' then raise exception 'La requisición ya no está en espera.'; end if;
  if n.estado <> 'rechazado' then raise exception 'Solo se cambia o se quita un insumo rechazado.'; end if;

  if p_insumo is not null then
    if not exists (select 1 from maestro_insumos where id = p_insumo) then
      raise exception 'El insumo no existe en el maestro.';
    end if;
    update requisiciones_admin_espera
       set lineas = case
             when exists (select 1 from jsonb_array_elements(lineas) x where (x->>'insumo_id')::uuid = p_insumo) then
               (select jsonb_agg(case when (x->>'insumo_id')::uuid = p_insumo
                                      then jsonb_set(x, '{cantidad}', to_jsonb((x->>'cantidad')::numeric + n.cantidad))
                                      else x end)
                  from jsonb_array_elements(lineas) x)
             else lineas || jsonb_build_array(jsonb_build_object('insumo_id', p_insumo, 'cantidad', n.cantidad))
           end
     where id = e.id;
  end if;
  delete from requisiciones_admin_espera_nuevos where id = p_nuevo;
  perform _enviar_requisicion_espera(e.id);
end;
$$;
revoke all on function public.resolver_insumo_rechazado_espera(uuid, uuid) from public, anon;
grant execute on function public.resolver_insumo_rechazado_espera(uuid, uuid) to authenticated;

-- 9. Reintentar (estado error) y cancelar --------------------------------------
create or replace function public.reintentar_requisicion_espera(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  e record;
begin
  select * into e from requisiciones_admin_espera where id = p_id for update;
  if not found or e.solicitado_por is distinct from auth.uid() then raise exception 'La requisición no existe.'; end if;
  if e.estado <> 'error' then raise exception 'La requisición no tiene un error para reintentar.'; end if;
  update requisiciones_admin_espera set estado = 'esperando', error = null where id = p_id;
  perform _enviar_requisicion_espera(p_id);
  select * into e from requisiciones_admin_espera where id = p_id;
  if e.estado = 'error' then raise exception 'No se pudo enviar: %', e.error; end if;
end;
$$;
revoke all on function public.reintentar_requisicion_espera(uuid) from public, anon;
grant execute on function public.reintentar_requisicion_espera(uuid) to authenticated;

create or replace function public.cancelar_requisicion_espera(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  e record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then raise exception 'El motivo de cancelación es obligatorio.'; end if;
  select * into e from requisiciones_admin_espera where id = p_id for update;
  if not found or e.solicitado_por is distinct from auth.uid() then raise exception 'La requisición no existe.'; end if;
  if e.estado not in ('esperando', 'error') then raise exception 'La requisición ya no está en espera.'; end if;
  -- Las solicitudes de insumo que solo servían a esta requisición salen de Aprobación de insumos.
  delete from solicitudes_insumos s
   using requisiciones_admin_espera_nuevos n
   where n.espera_id = p_id and n.solicitud_id = s.id and s.estado = 'pendiente';
  update requisiciones_admin_espera
     set estado = 'cancelada', cancelada_at = now(), motivo_cancelacion = v_motivo
   where id = p_id;
end;
$$;
revoke all on function public.cancelar_requisicion_espera(uuid, text) from public, anon;
grant execute on function public.cancelar_requisicion_espera(uuid, text) to authenticated;

commit;
