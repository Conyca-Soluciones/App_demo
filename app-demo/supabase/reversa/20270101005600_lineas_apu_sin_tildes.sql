-- Reversa de 20270101005600_lineas_apu_sin_tildes.sql.

begin;
set local lock_timeout = '10s';

create or replace function pg_temp._parche(p_fn regprocedure, p_a text, p_b text)
returns void
language plpgsql
as $f$
declare
  d text := replace(pg_get_functiondef(p_fn), E'\r\n', E'\n');
begin
  if position(p_a in d) = 0 then
    return;
  end if;
  execute replace(d, p_a, p_b);
end;
$f$;

select pg_temp._parche('public.reutilizar_decisiones_items(uuid,jsonb)'::regprocedure,
  '_clave_linea_apu(r.descripcion_original)', '_clave_actividad(r.descripcion_original)');
select pg_temp._parche('public.reutilizar_decisiones_version(uuid)'::regprocedure,
  '_clave_linea_apu(r.descripcion_original)', '_clave_actividad(r.descripcion_original)');

create or replace function public._desperdicio_de_linea(p_apu_id uuid, p_clave text)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select coalesce(d.porcentaje, v.desperdicio_pct)
      from public.presupuesto_items pi
      join public.presupuesto_versiones v on v.id = pi.version_id
      left join public.presupuesto_desperdicios d on d.version_id = pi.version_id and d.clave = p_clave
     where pi.apu_id = p_apu_id
     limit 1), 0)
$function$;

drop function if exists public._clave_linea_apu(text);

commit;
