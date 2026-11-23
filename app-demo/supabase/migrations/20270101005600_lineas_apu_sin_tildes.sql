-- Líneas del APU iguales aunque cambie la tilde o el superíndice (decisión del
-- usuario, 2026-11-23).
--
-- Al subir el Excel como versión nueva, cada línea del APU se empareja con la de
-- la versión anterior por su texto para conservar lo decidido (insumo, categoría,
-- solicitud, rechazo). El texto se comparaba sin mayúsculas ni espacios de más
-- (_clave_actividad), así que "Volqueta (6 m3)" y "Volqueta (6 m³)", o
-- "albañilería" y "albañileria", contaban como líneas distintas y volvían a
-- quedar pendientes. Ahora se comparan con _clave_linea_apu: además sin tildes,
-- con ³ = 3, ² = 2, y sin puntuación (solo letras y números).
-- - reutilizar_decisiones_items (20270101005400) y reutilizar_decisiones_version
--   (20270101004700) emparejan con _clave_linea_apu.
-- - _desperdicio_de_linea encuentra la excepción de desperdicio de la línea aunque
--   el texto del Excel nuevo cambie así (prefiere el texto exacto).
-- - En la app, lib/comparar-version.ts (claveLinea) compara igual.
-- _clave_actividad no cambia (la usan las solicitudes de mano de obra y la clave
-- guardada del desperdicio).
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

create or replace function public._clave_linea_apu(p text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select btrim(regexp_replace(
           translate(lower(coalesce(p, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç³²º°', 'aaaaaeeeeiiiiooooouuuunc32oo'),
           '[^a-z0-9]+', ' ', 'g'))
$$;
grant execute on function public._clave_linea_apu(text) to authenticated;

select pg_temp._parche('public.reutilizar_decisiones_items(uuid,jsonb)'::regprocedure,
  '_clave_actividad(r.descripcion_original)', '_clave_linea_apu(r.descripcion_original)');
select pg_temp._parche('public.reutilizar_decisiones_version(uuid)'::regprocedure,
  '_clave_actividad(r.descripcion_original)', '_clave_linea_apu(r.descripcion_original)');

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
      left join lateral (
        select d2.porcentaje
          from public.presupuesto_desperdicios d2
         where d2.version_id = pi.version_id
           and (d2.clave = p_clave or public._clave_linea_apu(d2.clave) = public._clave_linea_apu(p_clave))
         order by (d2.clave = p_clave) desc
         limit 1) d on true
     where pi.apu_id = p_apu_id
     limit 1), 0)
$function$;

commit;
