-- Reversa de 20270101004800_modalidad_item_sin_apu.sql: quita el error
-- "no tiene APU" de fijar_modalidades_presupuesto.

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

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '        elsif coalesce(v_f.modalidad, '''') <> ''todo_costo''
              and v_f.apu_id is null and v_f.apu_guardado_id is null
              and upper(trim(coalesce(v_f.unidad, ''''))) not in (''GL'', ''GLB'', ''GLOBAL'') then
          v_error := ''no tiene APU (no vino en la hoja APU del Excel): solo puede ser subcontrato todo costo'';
', '');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '           pi.precio_original, pi.apu_id, pi.apu_guardado_id, pi.unidad,',
  '           pi.precio_original,');

commit;
