-- Contratos de obra y de mano de obra: solo por valores unitarios (decisión
-- del usuario, 2026-11-08). Con valor global no había ningún control de
-- precio contra el presupuesto; por valores unitarios cada actividad queda
-- limitada a la cantidad disponible y al valor unitario del ítem (mano de
-- obra: la mano de obra del APU + herramienta menor).
--
-- Parche de texto sobre la versión viva de _guardar_solicitud_contrato (la
-- usan crear y reenviar): falla si no encuentra el texto. Se puede correr más
-- de una vez. Los contratos ya creados no cambian. En TS: soloValoresUnitarios
-- (lib/contratos.ts).
do $$
declare
  d text := pg_get_functiondef('public._guardar_solicitud_contrato(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure);
  a text := E'  if v_anexo = ''valores_unitarios'' then\n';
  b text := E'  if v_tipo in (''obra'', ''mano_obra'') and v_anexo is distinct from ''valores_unitarios'' then\n'
         || E'    raise exception ''Los contratos de obra y de mano de obra van por valores unitarios (ítems del presupuesto).'';\n'
         || E'  end if;\n'
         || a;
begin
  d := replace(d, E'\r\n', E'\n');
  if position('van por valores unitarios (ítems del presupuesto)' in d) > 0 then
    return;
  end if;
  if position(a in d) = 0 then
    raise exception '_guardar_solicitud_contrato no tiene el texto esperado.';
  end if;
  execute replace(d, a, b);
end $$;
