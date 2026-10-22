-- ---------------------------------------------------------------------------
-- Crear una requisición de obra exige la pestaña Elaboración de requisiciones
-- (revisión por roles 2026-10-22, matriz de permisos). `crear_requisicion`
-- solo revisaba el acceso al proyecto: Compras, Legal, Financiera, RRHH,
-- Almacenista... con un proyecto asignado podían crear requisiciones por la API
-- (la pantalla no los dejaba entrar) y consumían cupo del presupuesto.
-- Modificar y cancelar ya eran solo de quien la hizo. Se puede correr dos veces.
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn regprocedure := 'public.crear_requisicion(jsonb,date,boolean,text,text)'::regprocedure;
  v_def text := pg_get_functiondef(v_fn);
  v_viejo text := 'if v_uid is null then raise exception ''No autenticado.''; end if;';
  v_nuevo text := 'if v_uid is null then raise exception ''No autenticado.''; end if;
  if not public.tiene_pestana(v_uid, ''tecnico.pedidos'') then
    raise exception ''No tienes permiso para crear requisiciones (pestaña Elaboración de requisiciones).'';
  end if;';
begin
  if position('tecnico.pedidos' in v_def) > 0 then
    return;  -- ya aplicado
  end if;
  if position(v_viejo in v_def) = 0 then
    raise exception 'No se encontró el texto esperado en crear_requisicion.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
