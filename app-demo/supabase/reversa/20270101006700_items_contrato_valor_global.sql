-- Reversa de 20270101006700_items_contrato_valor_global.sql (aplicada con el número
-- 20270101006500: los textos que se buscan en la función conservan ese número).
-- Quita los parches de _guardar_solicitud_contrato, la validación y la tabla de
-- ítems de los contratos a valor global (se pierden las listas guardadas: los
-- contratos siguen a valor global, sin desglose).

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

select pg_temp._parche(
  'public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)'::regprocedure,
  '    delete from contrato_items_globales where contrato_id = p_id;
', '');

select pg_temp._parche(
  'public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)'::regprocedure,
  '  -- Ítems de un suministro a valor global (20270101006500).
  perform public._validar_items_globales(v_tipo, v_anexo, v_valor, p_datos->''items_globales'');
', '');

select pg_temp._parche(
  'public._guardar_solicitud_contrato(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, boolean)'::regprocedure,
  '  insert into contrato_items_globales (contrato_id, orden, descripcion, unidad, cantidad, valor_unitario)
  select p_id, t.ord, trim(t.v->>''descripcion''), nullif(trim(t.v->>''unidad''), ''''),
         nullif(t.v->>''cantidad'', '''')::numeric, round(nullif(t.v->>''valor_unitario'', '''')::numeric, 2)
  from jsonb_array_elements(case when jsonb_typeof(p_datos->''items_globales'') = ''array''
                                 then p_datos->''items_globales'' else ''[]''::jsonb end) with ordinality as t(v, ord);

', '');

drop function if exists public._validar_items_globales(text, text, numeric, jsonb);
drop table if exists public.contrato_items_globales;

commit;
