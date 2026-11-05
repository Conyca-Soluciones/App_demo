-- crear_requisicion: TODOS los ítems deben ser de la versión vigente del
-- presupuesto (antes solo revisaba que fueran del mismo proyecto; el pendiente
-- "crearPedido solo valida la versión del primer ítem"). Así una requisición
-- nunca se hace contra ítems de una versión histórica congelada.
-- modificar_requisicion no se toca: una requisición hecha antes de una versión
-- nueva conserva sus líneas viejas al modificarse.
-- Parcha la versión VIVA (texto exacto, falla si no lo encuentra). Se puede
-- correr más de una vez.

do $$
declare
  v text := pg_get_functiondef('public.crear_requisicion(jsonb, date, boolean, text, text)'::regprocedure);
  v_buscar text := E'  if v_proyectos <> 1 then\n    raise exception ''Una requisición solo puede tener ítems de un mismo proyecto.'';\n  end if;\n';
begin
  if position('versión vigente' in v) > 0 then return; end if;
  if position(v_buscar in v) = 0 then
    raise exception 'crear_requisicion cambió: no se encontró el texto a parchar.';
  end if;
  execute replace(v, v_buscar, v_buscar
    || E'  if exists (\n'
    || E'    select 1\n'
    || E'    from jsonb_to_recordset(p_lineas) as x(presupuesto_item_id uuid, item_apu_id uuid, insumo_id uuid, cantidad numeric)\n'
    || E'    join presupuesto_items pi on pi.id = x.presupuesto_item_id\n'
    || E'    join presupuestos pr on pr.id = pi.presupuesto_id\n'
    || E'    where pi.version_id is distinct from pr.version_actual_id\n'
    || E'  ) then\n'
    || E'    raise exception ''Hay un ítem que no es de la versión vigente del presupuesto. Actualiza la página y vuelve a armar la requisición.'';\n'
    || E'  end if;\n');
end;
$$;
