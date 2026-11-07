-- Revisión del 2026-11-06: quien aprueba su propia requisición recibía
-- "Tu requisición RQ-001-0008 fue aprobada". `notificar_una` (la usan los
-- avisos de requisiciones, OC, contratos, insumos...) ya no le avisa a quien
-- hizo la acción: el aviso es para los demás. Los avisos de procesos sin
-- usuario (auth.uid() nulo) siguen igual. Parche por texto exacto sobre la
-- función VIVA. Se puede correr dos veces. Va después de 20261231500000.

do $$
declare
  d text := pg_get_functiondef('public.notificar_una(uuid, text, text, uuid, text, text)'::regprocedure);
  viejo text := 'if p_usuario is null then return; end if;';
  nuevo text := 'if p_usuario is null or p_usuario = auth.uid() then return; end if;';
begin
  if position(nuevo in d) > 0 then
    return;  -- ya aplicado
  end if;
  if position(viejo in d) = 0 then
    raise exception 'notificar_una no tiene el texto esperado: %', viejo;
  end if;
  execute replace(d, viejo, nuevo);
end $$;
