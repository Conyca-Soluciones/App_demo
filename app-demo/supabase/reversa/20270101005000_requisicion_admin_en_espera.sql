-- Reversa de 20270101005000_requisicion_admin_en_espera.sql.
-- Quita las funciones, el disparador y las tablas de requisiciones en espera
-- (las que estén esperando se pierden: cancelarlas antes). Los avisos de
-- insumo aprobado/rechazado vuelven a salir para todas las solicitudes y
-- _crear_requisicion_administrativa / _evento_requisicion vuelven a usar solo
-- auth.uid(). Los tipos de aviso nuevos se dejan en los CHECK.

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

drop trigger if exists trg_requisicion_espera_sigue_solicitud on public.solicitudes_insumos;
drop function if exists public._requisicion_espera_sigue_solicitud();
drop function if exists public.cancelar_requisicion_espera(uuid, text);
drop function if exists public.reintentar_requisicion_espera(uuid);
drop function if exists public.resolver_insumo_rechazado_espera(uuid, uuid);
drop function if exists public.mis_requisiciones_en_espera();
drop function if exists public.crear_requisicion_administrativa_en_espera(uuid, jsonb, jsonb, date, boolean, text, text);
drop function if exists public._enviar_requisicion_espera(uuid);

select pg_temp._parche('public._notificar_insumo_aprobado()'::regprocedure,
  '  if exists (select 1 from public.requisiciones_admin_espera_nuevos x where x.solicitud_id = new.id) then
    return new;
  end if;
', '');
select pg_temp._parche('public._notificar_insumo_rechazado()'::regprocedure,
  '  if exists (select 1 from public.requisiciones_admin_espera_nuevos x where x.solicitud_id = new.id) then
    return new;
  end if;
', '');
select pg_temp._parche('public._crear_requisicion_administrativa(uuid,jsonb,date,boolean,text,text)'::regprocedure,
  '  v_uid uuid := coalesce(nullif(current_setting(''app.requisicion_por'', true), '''')::uuid, auth.uid());',
  '  v_uid uuid := auth.uid();');
select pg_temp._parche('public._evento_requisicion(uuid,text,text,jsonb)'::regprocedure,
  'values (''requisicion'', p_id, p_evento,
          coalesce(nullif(current_setting(''app.requisicion_por'', true), '''')::uuid, auth.uid()), p_motivo, p_datos)',
  'values (''requisicion'', p_id, p_evento, auth.uid(), p_motivo, p_datos)');

drop table if exists public.requisiciones_admin_espera_nuevos;
drop table if exists public.requisiciones_admin_espera;

commit;
