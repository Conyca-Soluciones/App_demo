-- Reversa de 20270101005500_extraordinaria_en_espera.sql.
-- Las extraordinarias que estén en espera se cancelan (sus solicitudes de insumo
-- quedan sueltas en Aprobación de insumos, como antes).

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
    return;
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

update public.requisiciones_admin_espera
   set estado = 'cancelada', cancelada_at = now(), motivo_cancelacion = 'Reversa de la migración 20270101005500.'
 where tipo = 'extraordinaria' and estado in ('esperando', 'error');
delete from public.requisiciones_admin_espera_nuevos n using public.requisiciones_admin_espera e
 where n.espera_id = e.id and e.tipo = 'extraordinaria';
delete from public.requisiciones_admin_espera where tipo = 'extraordinaria';

drop function if exists public.crear_requisicion_extraordinaria_en_espera(jsonb, jsonb, date, boolean, text, text);
drop function if exists public.mis_extraordinarias_en_espera();

select pg_temp._parche('public.mis_requisiciones_en_espera()'::regprocedure,
  $a$ and e.tipo = 'administrativa'$a$, '');
select pg_temp._parche('public.crear_requisicion_extraordinaria(jsonb,date,boolean,text)'::regprocedure,
  '  v_uid uuid := coalesce(nullif(current_setting(''app.requisicion_por'', true), '''')::uuid, auth.uid());',
  '  v_uid uuid := auth.uid();');
select pg_temp._parche('public.crear_requisicion_extraordinaria(jsonb,date,boolean,text)'::regprocedure,
  '    if not (case when nullif(current_setting(''app.requisicion_por'', true), '''') is not null
                 then public.usuario_puede_ver_proyecto(v_uid, l.proyecto_id)
                 else public.usuario_tiene_acceso_a_item(l.presupuesto_item_id) end) then',
  '    if not public.usuario_tiene_acceso_a_item(l.presupuesto_item_id) then');

-- Funciones como quedaron en 20270101005000.
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

alter table public.requisiciones_admin_espera_nuevos drop column if exists presupuesto_item_id;
alter table public.requisiciones_admin_espera drop constraint if exists requisiciones_admin_espera_tipo_check;
alter table public.requisiciones_admin_espera drop column if exists justificacion, drop column if exists tipo;

update public.ajustes_correo set tipos = array_remove(tipos, 'requisicion_extra_espera_enviada');
-- Los tipos de aviso se dejan en los CHECK de notificaciones (quitar uno con filas fallaría).

commit;
