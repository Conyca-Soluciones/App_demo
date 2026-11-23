-- Requisición extraordinaria en espera de insumos nuevos (decisión del usuario,
-- 2026-11-23).
--
-- Antes, en "Pedir insumo que no está en el presupuesto" de la requisición
-- extraordinaria, un insumo que no estaba en el maestro se pedía aparte a
-- Aprobación de insumos (20270101005200): la solicitud quedaba suelta, sin
-- cantidad ni ítem, y quien la pidió no tenía dónde verla; al aprobarla tenía que
-- armar la extraordinaria otra vez desde cero.
-- Ahora es como en las requisiciones administrativas (20270101005000): el insumo
-- nuevo va como una línea más de la extraordinaria (con su ítem y su cantidad) y
-- la requisición se envía UNA vez:
-- - Se guarda en espera (requisiciones_admin_espera con tipo = 'extraordinaria',
--   la justificación y las líneas con su ítem) y cada insumo nuevo
--   (requisiciones_admin_espera_nuevos, con presupuesto_item_id) con su solicitud
--   de insumo (origen requisicion_extraordinaria, sin ítem: al aprobarla no entra
--   al APU).
-- - Cuando se aprueba el ÚLTIMO insumo nuevo, la base crea la extraordinaria de
--   siempre (crear_requisicion_extraordinaria_con_direccion, a nombre de quien la
--   pidió) y pasa a Gerencia. Rechazado: se cambia por uno del maestro o se quita.
-- - Quien la pidió la ve en Elaboración de requisiciones (mis_extraordinarias_en_espera)
--   y puede cancelarla o reintentarla.
-- Avisos: requisicion_extra_espera_enviada (al crearse, lleva al detalle), y
-- insumo_requisicion_rechazado / requisicion_espera_error con entidad
-- requisicion_extra_espera (llevan a Elaboración de requisiciones).
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
  if position(p_b in d) > 0 then
    return;
  end if;
  if position(p_a in d) = 0 then
    raise exception 'No se encontró el texto a reemplazar en %: %', p_fn, left(p_a, 80);
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

-- 1. Columnas ------------------------------------------------------------------
alter table public.requisiciones_admin_espera
  add column if not exists tipo text not null default 'administrativa',
  add column if not exists justificacion text;
alter table public.requisiciones_admin_espera drop constraint if exists requisiciones_admin_espera_tipo_check;
alter table public.requisiciones_admin_espera
  add constraint requisiciones_admin_espera_tipo_check check (tipo in ('administrativa', 'extraordinaria'));
alter table public.requisiciones_admin_espera_nuevos
  add column if not exists presupuesto_item_id uuid references public.presupuesto_items(id) on delete set null;

-- 2. Avisos (se agregan a la lista viva de tipos) --------------------------------
do $$
declare
  d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint
   where conrelid = 'public.notificaciones'::regclass and conname = 'notificaciones_tipo_check';
  if position('requisicion_extra_espera_enviada' in d) = 0 then
    d := replace(replace(d, ' NOT VALID', ''), '''requisicion_espera_enviada''::text',
                 '''requisicion_espera_enviada''::text, ''requisicion_extra_espera_enviada''::text');
    alter table public.notificaciones drop constraint notificaciones_tipo_check;
    execute 'alter table public.notificaciones add constraint notificaciones_tipo_check ' || d || ' not valid';
  end if;
  select pg_get_constraintdef(oid) into d from pg_constraint
   where conrelid = 'public.notificaciones'::regclass and conname = 'notificaciones_entidad_tipo_check';
  if position('requisicion_extra_espera' in d) = 0 then
    d := replace(replace(d, ' NOT VALID', ''), '''requisicion_espera''::text',
                 '''requisicion_espera''::text, ''requisicion_extra_espera''::text');
    alter table public.notificaciones drop constraint notificaciones_entidad_tipo_check;
    execute 'alter table public.notificaciones add constraint notificaciones_entidad_tipo_check ' || d || ' not valid';
  end if;
end $$;

update public.ajustes_correo
   set tipos = tipos || array['requisicion_extra_espera_enviada']
 where not 'requisicion_extra_espera_enviada' = any(tipos);

-- 3. Crear la extraordinaria a nombre de quien la pidió -------------------------
-- Se crea en la sesión de quien aprueba el último insumo: app.requisicion_por
-- (solo lo pone _enviar_requisicion_espera) dice a nombre de quién va, y el acceso
-- al proyecto se revisa para esa persona.
select pg_temp._parche('public.crear_requisicion_extraordinaria(jsonb,date,boolean,text)'::regprocedure,
  '  v_uid uuid := auth.uid();',
  '  v_uid uuid := coalesce(nullif(current_setting(''app.requisicion_por'', true), '''')::uuid, auth.uid());');
select pg_temp._parche('public.crear_requisicion_extraordinaria(jsonb,date,boolean,text)'::regprocedure,
  '    if not public.usuario_tiene_acceso_a_item(l.presupuesto_item_id) then',
  '    if not (case when nullif(current_setting(''app.requisicion_por'', true), '''') is not null
                 then public.usuario_puede_ver_proyecto(v_uid, l.proyecto_id)
                 else public.usuario_tiene_acceso_a_item(l.presupuesto_item_id) end) then');

-- 4. Enviar cuando ya no falta nada (administrativa o extraordinaria) -------------
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
  v_extra boolean;
begin
  select * into e from requisiciones_admin_espera where id = p_espera for update;
  if not found or e.estado <> 'esperando' then return; end if;
  if exists (select 1 from requisiciones_admin_espera_nuevos n
              where n.espera_id = p_espera and n.estado in ('esperando', 'rechazado')) then
    return;
  end if;
  v_extra := e.tipo = 'extraordinaria';

  -- Líneas del maestro + insumos nuevos ya aprobados (un insumo repetido suma).
  if v_extra then
    select coalesce(jsonb_agg(jsonb_build_object('presupuesto_item_id', presupuesto_item_id,
                                                 'insumo_id', insumo_id, 'cantidad', cantidad)), '[]'::jsonb)
      into v_lineas
      from (select presupuesto_item_id, insumo_id, sum(cantidad) as cantidad
              from (select (x->>'presupuesto_item_id')::uuid as presupuesto_item_id,
                           (x->>'insumo_id')::uuid as insumo_id, (x->>'cantidad')::numeric as cantidad
                      from jsonb_array_elements(e.lineas) x
                    union all
                    select n.presupuesto_item_id, n.insumo_id, n.cantidad
                      from requisiciones_admin_espera_nuevos n
                     where n.espera_id = p_espera and n.estado = 'aprobado' and n.insumo_id is not null) l
             group by presupuesto_item_id, insumo_id) t;
  else
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
  end if;

  if jsonb_array_length(v_lineas) = 0 then
    update requisiciones_admin_espera set estado = 'cancelada', cancelada_at = now(),
           motivo_cancelacion = 'Se quitaron todos los insumos.'
     where id = p_espera;
    return;
  end if;

  perform set_config('app.requisicion_por', e.solicitado_por::text, true);
  begin
    if v_extra then
      v_res := crear_requisicion_extraordinaria_con_direccion(v_lineas, greatest(e.fecha_requerida, v_hoy),
                                                              e.urgente, e.justificacion, e.direccion_entrega);
    else
      v_res := _crear_requisicion_administrativa(e.proyecto_id, v_lineas, greatest(e.fecha_requerida, v_hoy),
                                                 e.urgente, e.observaciones, e.direccion_entrega);
    end if;
  exception when others then
    perform set_config('app.requisicion_por', v_previo, true);
    update requisiciones_admin_espera set estado = 'error', error = sqlerrm where id = p_espera;
    if v_extra then
      perform notificar_una(e.solicitado_por, 'requisicion_espera_error', 'requisicion_extra_espera', p_espera,
        'Tu requisición extraordinaria no se pudo enviar',
        'Ya se aprobaron los insumos nuevos, pero la requisición no se pudo crear: ' || sqlerrm
          || ' Ábrela en Elaboración de requisiciones para reintentar o cancelarla.');
    else
      perform notificar_una(e.solicitado_por, 'requisicion_espera_error', 'requisicion_espera', p_espera,
        'Tu requisición administrativa no se pudo enviar',
        'Ya se aprobaron los insumos nuevos, pero la requisición no se pudo crear: ' || sqlerrm
          || ' Ábrela en Mis requisiciones para reintentar o cancelarla.');
    end if;
    return;
  end;
  perform set_config('app.requisicion_por', v_previo, true);

  update requisiciones_admin_espera
     set estado = 'enviada', requisicion_id = (v_res->>'id')::uuid, enviada_at = now(), error = null
   where id = p_espera;
  if v_extra then
    perform notificar_una(e.solicitado_por, 'requisicion_extra_espera_enviada', 'requisicion', (v_res->>'id')::uuid,
      'Tu requisición extraordinaria pasó a Gerencia',
      'Ya se aprobaron los insumos nuevos de tu requisición extraordinaria: quedó como '
        || coalesce(v_res->>'codigo', 'requisición') || ' y pasó a aprobación de Gerencia.');
  else
    perform notificar_una(e.solicitado_por, 'requisicion_espera_enviada', 'requisicion', (v_res->>'id')::uuid,
      'Tu requisición pasó a aprobación',
      'Ya se aprobaron los insumos nuevos de tu requisición administrativa: quedó como '
        || coalesce(v_res->>'codigo', 'requisición') || ' y pasó a aprobación de Subgerencia.');
  end if;
end;
$$;
revoke all on function public._enviar_requisicion_espera(uuid) from public, anon, authenticated;

-- 5. Aviso de insumo rechazado según el tipo -------------------------------------
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
      perform notificar_una(e.solicitado_por, 'insumo_requisicion_rechazado',
        case when e.tipo = 'extraordinaria' then 'requisicion_extra_espera' else 'requisicion_espera' end, e.id,
        'Un insumo de tu requisición fue rechazado',
        '"' || new.descripcion || '" fue rechazado en Aprobación de insumos.'
          || coalesce(' Motivo: ' || nullif(btrim(new.motivo_rechazo), '') || '.', '')
          || case when e.tipo = 'extraordinaria'
                  then ' Abre la requisición extraordinaria en Elaboración de requisiciones para cambiarlo por otro insumo o quitarlo.'
                  else ' Abre la requisición en Mis requisiciones para cambiarlo por otro insumo o quitarlo.' end)
        from requisiciones_admin_espera e where e.id = v_espera and e.estado = 'esperando';
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public._requisicion_espera_sigue_solicitud() from public, anon, authenticated;

-- 6. Crear la extraordinaria en espera -------------------------------------------
-- p_lineas: [{presupuesto_item_id, insumo_id, cantidad}] del maestro, cantidad ya
-- en la unidad del APU (como crear_requisicion_extraordinaria; puede ir vacía).
-- p_nuevos: [{presupuesto_item_id, descripcion, unidad, cantidad}] (al menos uno).
create or replace function public.crear_requisicion_extraordinaria_en_espera(
  p_lineas jsonb, p_nuevos jsonb, p_fecha_requerida date, p_urgente boolean,
  p_justificacion text, p_direccion_entrega text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_dir text := nullif(btrim(regexp_replace(coalesce(p_direccion_entrega, ''), '\s+', ' ', 'g')), '');
  v_just text := nullif(btrim(coalesce(p_justificacion, '')), '');
  v_n_lineas int;
  v_n_nuevos int;
  v_proyecto uuid;
  v_sol uuid;
  l record;
begin
  if v_uid is null then raise exception 'Inicia sesión.'; end if;
  if not public.tiene_pestana(v_uid, 'tecnico.pedidos') then
    raise exception 'No tienes permiso para crear requisiciones (pestaña Elaboración de requisiciones).';
  end if;
  if v_just is null then raise exception 'Escribe por qué se necesita más de lo presupuestado.'; end if;
  if v_dir is null then raise exception 'La dirección de entrega es obligatoria.'; end if;
  if length(v_dir) > 300 then raise exception 'La dirección de entrega es muy larga (máximo 300 caracteres).'; end if;
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
  if v_n_nuevos = 0 then raise exception 'No hay insumos nuevos: envía la requisición extraordinaria normal.'; end if;
  if v_n_lineas + v_n_nuevos > 50 then raise exception 'Una requisición puede tener máximo 50 insumos.'; end if;

  -- Todos los ítems: que existan, de la versión vigente, de un mismo proyecto que la persona ve.
  with items as (
    select (x->>'presupuesto_item_id')::uuid as item_id from jsonb_array_elements(p_lineas) x
    union all
    select (x->>'presupuesto_item_id')::uuid from jsonb_array_elements(p_nuevos) x
  )
  select count(distinct pr.proyecto_id), (array_agg(pr.proyecto_id))[1]
    into v_n_lineas, v_proyecto
    from items i
    left join presupuesto_items pi on pi.id = i.item_id
    left join presupuestos pr on pr.id = pi.presupuesto_id;
  if exists (select 1 from (select (x->>'presupuesto_item_id')::uuid as item_id from jsonb_array_elements(p_lineas) x
                            union all
                            select (x->>'presupuesto_item_id')::uuid from jsonb_array_elements(p_nuevos) x) i
              left join presupuesto_items pi on pi.id = i.item_id
              left join presupuestos pr on pr.id = pi.presupuesto_id
             where pi.id is null or pi.version_id is distinct from pr.version_actual_id) then
    raise exception 'Hay un ítem que no existe o no es de la versión vigente del presupuesto.';
  end if;
  if v_n_lineas <> 1 then raise exception 'Una requisición solo puede tener ítems de un mismo proyecto.'; end if;
  if not public.usuario_puede_ver_proyecto(v_uid, v_proyecto) then
    raise exception 'No tienes acceso al proyecto de este ítem.';
  end if;

  if (select count(distinct (x.presupuesto_item_id, x.insumo_id))
        from jsonb_to_recordset(p_lineas) as x(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric))
     <> jsonb_array_length(p_lineas) then
    raise exception 'Hay un insumo repetido para el mismo ítem del presupuesto.';
  end if;
  for l in select * from jsonb_to_recordset(p_lineas) as x(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric) loop
    if l.insumo_id is null or not exists (select 1 from maestro_insumos mi where mi.id = l.insumo_id) then
      raise exception 'Hay un insumo que no existe en el maestro.';
    end if;
    if l.cantidad is null or l.cantidad <= 0
       or not public._cantidad_compra_entera(l.cantidad, public._factor_pedido(l.presupuesto_item_id, null, l.insumo_id)) then
      raise exception 'Todas las cantidades deben ser números enteros mayores que cero, en la unidad de compra del insumo.';
    end if;
  end loop;
  for l in select * from jsonb_to_recordset(p_nuevos) as x(presupuesto_item_id uuid, descripcion text, unidad text, cantidad numeric) loop
    if nullif(btrim(coalesce(l.descripcion, '')), '') is null then raise exception 'Escribe el nombre de cada insumo nuevo.'; end if;
    if length(btrim(l.descripcion)) > 300 then raise exception 'El nombre de un insumo nuevo puede tener máximo 300 caracteres.'; end if;
    if nullif(btrim(coalesce(l.unidad, '')), '') is null then raise exception 'Elige la unidad de "%".', btrim(l.descripcion); end if;
    if l.cantidad is null or l.cantidad <= 0 or l.cantidad <> trunc(l.cantidad) then
      raise exception 'La cantidad de "%" debe ser un número entero mayor que cero.', btrim(l.descripcion);
    end if;
  end loop;

  insert into requisiciones_admin_espera (tipo, solicitado_por, proyecto_id, fecha_requerida, urgente, observaciones,
                                          justificacion, direccion_entrega, lineas)
  values ('extraordinaria', v_uid, v_proyecto, p_fecha_requerida, coalesce(p_urgente, false), v_just, v_just, v_dir,
          (select coalesce(jsonb_agg(jsonb_build_object('presupuesto_item_id', x.presupuesto_item_id,
                                                        'insumo_id', x.insumo_id, 'cantidad', x.cantidad)), '[]'::jsonb)
             from jsonb_to_recordset(p_lineas) as x(presupuesto_item_id uuid, insumo_id uuid, cantidad numeric)))
  returning id into v_id;

  for l in select * from jsonb_to_recordset(p_nuevos) as x(presupuesto_item_id uuid, descripcion text, unidad text, cantidad numeric) loop
    insert into solicitudes_insumos (descripcion, u_m, solicitado_por, estado, origen, proyecto_id)
    values (btrim(l.descripcion), btrim(l.unidad), v_uid, 'pendiente', 'requisicion_extraordinaria', v_proyecto)
    returning id into v_sol;
    insert into requisiciones_admin_espera_nuevos (espera_id, solicitud_id, presupuesto_item_id, descripcion, unidad, cantidad)
    values (v_id, v_sol, l.presupuesto_item_id, btrim(l.descripcion), btrim(l.unidad), l.cantidad);
  end loop;

  return jsonb_build_object('id', v_id);
end;
$$;
revoke all on function public.crear_requisicion_extraordinaria_en_espera(jsonb, jsonb, date, boolean, text, text) from public, anon;
grant execute on function public.crear_requisicion_extraordinaria_en_espera(jsonb, jsonb, date, boolean, text, text) to authenticated;

-- 7. Lo que ve quien la pidió ------------------------------------------------------
-- Las administrativas siguen en Mis requisiciones (solo las suyas).
select pg_temp._parche('public.mis_requisiciones_en_espera()'::regprocedure,
  $a$   where e.solicitado_por = auth.uid() and e.estado in ('esperando', 'error')$a$,
  $b$   where e.solicitado_por = auth.uid() and e.estado in ('esperando', 'error') and e.tipo = 'administrativa'$b$);

create or replace function public.mis_extraordinarias_en_espera()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'estado', e.estado, 'error', e.error, 'created_at', e.created_at,
           'fecha_requerida', e.fecha_requerida, 'urgente', e.urgente, 'observaciones', e.justificacion,
           'direccion_entrega', e.direccion_entrega,
           'proyecto', (select coalesce(p.codigo || ' - ', '') || p.nombre from proyectos p where p.id = e.proyecto_id),
           'lineas', (select coalesce(jsonb_agg(jsonb_build_object(
                         'insumo_id', mi.id, 'codigo', mi.codigo, 'descripcion', mi.descripcion, 'unidad', mi.u_m,
                         'cantidad', (x->>'cantidad')::numeric, 'item_codigo', pi.codigo) order by pi.codigo, mi.descripcion), '[]'::jsonb)
                        from jsonb_array_elements(e.lineas) x
                        join maestro_insumos mi on mi.id = (x->>'insumo_id')::uuid
                        left join presupuesto_items pi on pi.id = (x->>'presupuesto_item_id')::uuid),
           'nuevos', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', n.id, 'descripcion', n.descripcion, 'unidad', n.unidad, 'cantidad', n.cantidad,
                         'estado', n.estado, 'motivo_rechazo', n.motivo_rechazo,
                         'item_codigo', (select pi.codigo from presupuesto_items pi where pi.id = n.presupuesto_item_id),
                         'codigo', (select mi.codigo from maestro_insumos mi where mi.id = n.insumo_id)) order by n.descripcion),
                         '[]'::jsonb)
                        from requisiciones_admin_espera_nuevos n where n.espera_id = e.id)
         ) order by e.created_at desc), '[]'::jsonb)
    from requisiciones_admin_espera e
   where e.solicitado_por = auth.uid() and e.estado in ('esperando', 'error') and e.tipo = 'extraordinaria'
$$;
revoke all on function public.mis_extraordinarias_en_espera() from public, anon;
grant execute on function public.mis_extraordinarias_en_espera() to authenticated;

-- 8. Insumo rechazado: en la extraordinaria la línea conserva su ítem ----------------
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
  v_cant numeric;
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
    if e.tipo = 'extraordinaria' then
      if n.presupuesto_item_id is null then raise exception 'El ítem del presupuesto de este insumo ya no existe: quítalo.'; end if;
      -- La cantidad se pidió en unidades de compra; en la base va en la unidad del APU.
      v_cant := n.cantidad * public._factor_pedido(n.presupuesto_item_id, null, p_insumo);
      update requisiciones_admin_espera
         set lineas = case
               when exists (select 1 from jsonb_array_elements(lineas) x
                             where (x->>'insumo_id')::uuid = p_insumo
                               and (x->>'presupuesto_item_id')::uuid = n.presupuesto_item_id) then
                 (select jsonb_agg(case when (x->>'insumo_id')::uuid = p_insumo
                                         and (x->>'presupuesto_item_id')::uuid = n.presupuesto_item_id
                                        then jsonb_set(x, '{cantidad}', to_jsonb((x->>'cantidad')::numeric + v_cant))
                                        else x end)
                    from jsonb_array_elements(lineas) x)
               else lineas || jsonb_build_array(jsonb_build_object('presupuesto_item_id', n.presupuesto_item_id,
                                                                   'insumo_id', p_insumo, 'cantidad', v_cant))
             end
       where id = e.id;
    else
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
  end if;
  delete from requisiciones_admin_espera_nuevos where id = p_nuevo;
  perform _enviar_requisicion_espera(e.id);
end;
$$;
revoke all on function public.resolver_insumo_rechazado_espera(uuid, uuid) from public, anon;
grant execute on function public.resolver_insumo_rechazado_espera(uuid, uuid) to authenticated;

commit;
