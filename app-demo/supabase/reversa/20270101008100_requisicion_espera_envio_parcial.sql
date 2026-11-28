-- Reversa de 20270101008100_requisicion_espera_envio_parcial.sql: la
-- requisición en espera vuelve a salir completa cuando se aprueba el último
-- insumo nuevo.
--
-- OJO: una espera que ya mandó una parte la volvería a mandar entera (con lo
-- que ya salió) al aprobarse el último insumo. Antes de correrla, revisar
--   select id from requisiciones_admin_espera e
--    where estado = 'esperando'
--      and exists (select 1 from requisiciones_admin_espera_nuevos n
--                   where n.espera_id = e.id and n.enviado_at is not null);
-- y resolver esas a mano (cancelar la espera y pedir lo que falta en otra).
-- Las columnas nuevas se dejan (no estorban) para no perder qué salió y dónde.

begin;
set local lock_timeout = '10s';

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
begin
  select * into e from requisiciones_admin_espera where id = p_espera for update;
  if not found or e.estado <> 'esperando' then return; end if;
  if exists (select 1 from requisiciones_admin_espera_nuevos n
              where n.espera_id = p_espera and n.estado in ('esperando', 'rechazado')) then
    return;
  end if;
  v_extra := e.tipo = 'extraordinaria';
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
$function$;

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
                         'codigo', (select mi.codigo from maestro_insumos mi where mi.id = n.insumo_id)) order by n.descripcion),
                         '[]'::jsonb)
                        from requisiciones_admin_espera_nuevos n where n.espera_id = e.id)
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
                         'codigo', (select mi.codigo from maestro_insumos mi where mi.id = n.insumo_id)) order by n.descripcion),
                         '[]'::jsonb)
                        from requisiciones_admin_espera_nuevos n where n.espera_id = e.id)
         ) order by e.created_at desc), '[]'::jsonb)
    from requisiciones_admin_espera e
   where e.solicitado_por = auth.uid() and e.estado in ('esperando', 'error') and e.tipo = 'extraordinaria'
$function$;

commit;
