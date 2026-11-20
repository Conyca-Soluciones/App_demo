-- Modalidades: un ítem sin APU solo puede ir a todo costo (decisión del usuario,
-- 2026-11-20; caso: el Malecón, versión 20/11, cuyo Excel no trajo los bloques
-- APU del 10.1 al 10.3).
--
-- Antes, Administración en un ítem sin APU (que no fuera global GL) se aplicaba
-- y el ítem quedaba valiendo $ 0 sin aviso, y Subcontrato mano de obra decía
-- "no tiene mano de obra ni insumos". Ahora fijar_modalidades_presupuesto da el
-- error "no tiene APU" para cualquier modalidad que no sea todo costo en un
-- ítem hoja sin APU (ni APU guardado) que no sea global. Los globales (GL, GLB,
-- GLOBAL) siguen como antes: sin APU valen su precio oficial.
--
-- La app ya no frena toda la carga por los errores: aplica las filas buenas y
-- lista las que tienen error (components/modalidades-dialog.tsx).
--
-- Va antes o después del código, da igual. Reversa en supabase/reversa/.

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

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '           pi.precio_original,
           count(*) over (partition by f.codigo) as repetidas,',
  '           pi.precio_original, pi.apu_id, pi.apu_guardado_id, pi.unidad,
           count(*) over (partition by f.codigo) as repetidas,');

select pg_temp._parche('public.fijar_modalidades_presupuesto(uuid,jsonb,boolean)'::regprocedure,
  '        elsif v_f.modalidad = ''mano_obra'' and not v_info.tiene_mano_obra and not v_info.con_insumos then',
  '        elsif coalesce(v_f.modalidad, '''') <> ''todo_costo''
              and v_f.apu_id is null and v_f.apu_guardado_id is null
              and upper(trim(coalesce(v_f.unidad, ''''))) not in (''GL'', ''GLB'', ''GLOBAL'') then
          v_error := ''no tiene APU (no vino en la hoja APU del Excel): solo puede ser subcontrato todo costo'';
        elsif v_f.modalidad = ''mano_obra'' and not v_info.tiene_mano_obra and not v_info.con_insumos then');

commit;
