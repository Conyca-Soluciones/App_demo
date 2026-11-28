-- Requisición en espera de insumos nuevos: lo aprobado sale de una vez
-- (decisión del usuario, 2026-11-28; cambia 20270101005000 y 20270101005500).
--
-- Caso: la requisición administrativa de Ricardo (Malecón, 22/11) tenía 11 de
-- 14 insumos nuevos aprobados y no salía en Requisiciones, porque solo se creaba
-- cuando se aprobaba el último.
--
-- Ahora, cada vez que se aprueba un insumo nuevo (o se cambia un rechazado por
-- uno del maestro), _enviar_requisicion_espera crea una requisición con lo que
-- falta por enviar: las líneas del maestro (la primera vez) y los insumos nuevos
-- aprobados que no han salido. Pasa a Subgerencia (administrativa) o a Gerencia
-- (extraordinaria) como siempre. Lo que sigue por aprobar o rechazado se queda
-- en espera; cuando ya no queda nada, la espera queda 'enviada'. Decisión del
-- usuario: automático, aunque si los insumos se aprueban de a uno salgan varias
-- requisiciones pequeñas.
--
-- - requisiciones_admin_espera_nuevos.enviado_at / requisicion_id: si ya salió y
--   en qué requisición.
-- - requisiciones_admin_espera.lineas: solo las líneas del maestro que faltan por
--   enviar; las enviadas pasan a lineas_enviadas. requisicion_id = la primera.
-- - Cancelar la espera cancela lo que falta; las requisiciones que ya salieron
--   siguen (se cancelan en su pantalla, como cualquier requisición).
-- - Al aplicarla, salen de una vez los insumos ya aprobados de las esperas
--   abiertas.
--
-- Va ANTES del código (la pantalla lee los campos nuevos). Reversa en
-- supabase/reversa/.

begin;
set local lock_timeout = '10s';

-- 1. Columnas ----------------------------------------------------------------------

alter table public.requisiciones_admin_espera_nuevos
  add column if not exists enviado_at timestamptz,
  add column if not exists requisicion_id uuid references public.requisiciones(id) on delete set null;
alter table public.requisiciones_admin_espera
  add column if not exists lineas_enviadas jsonb not null default '[]'::jsonb;

comment on column public.requisiciones_admin_espera_nuevos.enviado_at is
  'Cuándo salió en una requisición (20270101008100). null = todavía en espera.';
comment on column public.requisiciones_admin_espera.lineas_enviadas is
  'Líneas del maestro que ya salieron en una requisición (20270101008100); lineas = las que faltan.';

-- 2. Enviar lo que haya aprobado ------------------------------------------------------

create or replace function public._enviar_requisicion_espera(p_espera uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  e record;
  v_lineas jsonb;
  v_res jsonb;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_previo text := coalesce(current_setting('app.requisicion_por', true), '');
  v_extra boolean;
  v_quedan integer;
  v_rq uuid;
  v_codigo text;
begin
  select * into e from requisiciones_admin_espera where id = p_espera for update;
  if not found or e.estado <> 'esperando' then return; end if;
  v_extra := e.tipo = 'extraordinaria';

  -- Lo que sigue por aprobar o rechazado se queda en espera.
  select count(*) into v_quedan
    from requisiciones_admin_espera_nuevos n
   where n.espera_id = p_espera and n.estado in ('esperando', 'rechazado');

  -- Lo que falta por enviar: líneas del maestro + nuevos aprobados sin enviar.
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
                     where n.espera_id = p_espera and n.estado = 'aprobado' and n.insumo_id is not null
                       and n.enviado_at is null) l
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
                     where n.espera_id = p_espera and n.estado = 'aprobado' and n.insumo_id is not null
                       and n.enviado_at is null) l
             group by insumo_id) t;
  end if;

  if jsonb_array_length(v_lineas) = 0 then
    if v_quedan = 0 then
      if e.requisicion_id is null then
        update requisiciones_admin_espera set estado = 'cancelada', cancelada_at = now(),
               motivo_cancelacion = 'Se quitaron todos los insumos.'
         where id = p_espera;
      else
        -- Ya salió todo en requisiciones anteriores.
        update requisiciones_admin_espera set estado = 'enviada', error = null where id = p_espera;
      end if;
    end if;
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
        'Ya se aprobaron insumos nuevos, pero la requisición no se pudo crear: ' || sqlerrm
          || ' Ábrela en Elaboración de requisiciones para reintentar o cancelarla.');
    else
      perform notificar_una(e.solicitado_por, 'requisicion_espera_error', 'requisicion_espera', p_espera,
        'Tu requisición administrativa no se pudo enviar',
        'Ya se aprobaron insumos nuevos, pero la requisición no se pudo crear: ' || sqlerrm
          || ' Ábrela en Mis requisiciones para reintentar o cancelarla.');
    end if;
    return;
  end;
  perform set_config('app.requisicion_por', v_previo, true);
  v_rq := (v_res->>'id')::uuid;
  v_codigo := coalesce(v_res->>'codigo', 'requisición');

  update requisiciones_admin_espera_nuevos
     set enviado_at = now(), requisicion_id = v_rq
   where espera_id = p_espera and estado = 'aprobado' and insumo_id is not null and enviado_at is null;
  update requisiciones_admin_espera
     set lineas_enviadas = lineas_enviadas || lineas,
         lineas = '[]'::jsonb,
         requisicion_id = coalesce(requisicion_id, v_rq),
         enviada_at = coalesce(enviada_at, now()),
         estado = case when v_quedan > 0 then 'esperando' else 'enviada' end,
         error = null
   where id = p_espera;

  if v_extra then
    perform notificar_una(e.solicitado_por, 'requisicion_extra_espera_enviada', 'requisicion', v_rq,
      case when v_quedan > 0 then 'Parte de tu requisición extraordinaria pasó a Gerencia'
           else 'Tu requisición extraordinaria pasó a Gerencia' end,
      case when v_quedan > 0
           then 'Los insumos ya aprobados de tu requisición extraordinaria quedaron como ' || v_codigo
                || ' y pasaron a aprobación de Gerencia. ' || v_quedan
                || ' insumo(s) nuevo(s) siguen en espera y saldrán cuando se aprueben.'
           else 'Ya se aprobaron los insumos nuevos de tu requisición extraordinaria: quedó como '
                || v_codigo || ' y pasó a aprobación de Gerencia.' end);
  else
    perform notificar_una(e.solicitado_por, 'requisicion_espera_enviada', 'requisicion', v_rq,
      case when v_quedan > 0 then 'Parte de tu requisición pasó a aprobación'
           else 'Tu requisición pasó a aprobación' end,
      case when v_quedan > 0
           then 'Los insumos ya aprobados de tu requisición administrativa quedaron como ' || v_codigo
                || ' y pasaron a aprobación de Subgerencia. ' || v_quedan
                || ' insumo(s) nuevo(s) siguen en espera y saldrán cuando se aprueben.'
           else 'Ya se aprobaron los insumos nuevos de tu requisición administrativa: quedó como '
                || v_codigo || ' y pasó a aprobación de Subgerencia.' end);
  end if;
end;
$function$;

-- 3. Lo que ve quien la hizo -----------------------------------------------------------

create or replace function public.mis_requisiciones_en_espera()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
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
                         'codigo', (select mi.codigo from maestro_insumos mi where mi.id = n.insumo_id),
                         'requisicion_codigo', (select r.codigo from requisiciones r where r.id = n.requisicion_id),
                         'enviado', n.enviado_at is not null) order by n.descripcion),
                         '[]'::jsonb)
                        from requisiciones_admin_espera_nuevos n where n.espera_id = e.id),
           -- Requisiciones que ya salieron de esta espera (20270101008100).
           'enviadas', (select coalesce(jsonb_agg(distinct r.codigo), '[]'::jsonb)
                          from requisiciones r
                         where r.id = e.requisicion_id
                            or r.id in (select n.requisicion_id from requisiciones_admin_espera_nuevos n
                                         where n.espera_id = e.id))
         ) order by e.created_at desc), '[]'::jsonb)
    from requisiciones_admin_espera e
   where e.solicitado_por = auth.uid() and e.estado in ('esperando', 'error') and e.tipo = 'administrativa'
$function$;

create or replace function public.mis_extraordinarias_en_espera()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
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
                         'codigo', (select mi.codigo from maestro_insumos mi where mi.id = n.insumo_id),
                         'requisicion_codigo', (select r.codigo from requisiciones r where r.id = n.requisicion_id),
                         'enviado', n.enviado_at is not null) order by n.descripcion),
                         '[]'::jsonb)
                        from requisiciones_admin_espera_nuevos n where n.espera_id = e.id),
           'enviadas', (select coalesce(jsonb_agg(distinct r.codigo), '[]'::jsonb)
                          from requisiciones r
                         where r.id = e.requisicion_id
                            or r.id in (select n.requisicion_id from requisiciones_admin_espera_nuevos n
                                         where n.espera_id = e.id))
         ) order by e.created_at desc), '[]'::jsonb)
    from requisiciones_admin_espera e
   where e.solicitado_por = auth.uid() and e.estado in ('esperando', 'error') and e.tipo = 'extraordinaria'
$function$;

-- 4. Las esperas abiertas: sale de una vez lo ya aprobado ------------------------------

do $$
declare
  v uuid;
begin
  for v in
    select e.id from requisiciones_admin_espera e
     where e.estado = 'esperando'
       and exists (select 1 from requisiciones_admin_espera_nuevos n
                    where n.espera_id = e.id and n.estado = 'aprobado' and n.insumo_id is not null)
     order by e.created_at
  loop
    perform public._enviar_requisicion_espera(v);
  end loop;
end;
$$;

commit;
