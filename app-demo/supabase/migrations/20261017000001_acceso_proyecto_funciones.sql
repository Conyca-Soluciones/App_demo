-- Acceso al proyecto en dos funciones SECURITY DEFINER que no lo revisaban
-- (auditoría 2026-10-02):
--
-- * resumen_ejecucion_proyecto(p_proyecto_id): devolvía presupuesto, compras
--   y salidas de CUALQUIER proyecto a cualquier usuario con sesión que la
--   llamara directo por la API. Ahora exige ver el proyecto, salvo cuando la
--   llama un disparador (notificar_insumo_sobre_presupuesto, al aprobar una
--   orden de compra), que no debe fallar por eso.
-- * registrar_salida_almacen(p_proyecto_id, ...): con la acción
--   gestionar_almacen se podían registrar salidas en proyectos ajenos. Ahora
--   exige además ver el proyecto (como inventario_proyecto y
--   listar_salidas_proyecto).
--
-- No se reescribe la lógica: la función original se renombra con "_" (sin
-- permiso de ejecución para los usuarios) y se crea una envoltura con el
-- nombre de siempre que revisa el acceso y la llama. Así funciona aunque la
-- versión aplicada en la base difiera de los archivos (ver CLAUDE.md: hubo
-- migraciones aplicadas a mano). La envoltura toma el tipo de retorno de la
-- función que esté en la base. Se puede correr dos veces.

do $$
declare
  v_res text;
begin
  -- ------------------------------------------------ resumen_ejecucion_proyecto
  if to_regprocedure('public._resumen_ejecucion_proyecto(uuid)') is null then
    alter function public.resumen_ejecucion_proyecto(uuid) rename to _resumen_ejecucion_proyecto;
  end if;
  v_res := pg_get_function_result('public._resumen_ejecucion_proyecto(uuid)'::regprocedure);
  execute format($f$
    create or replace function public.resumen_ejecucion_proyecto(p_proyecto_id uuid)
    returns %s
    language plpgsql
    stable
    security definer
    set search_path = public
    as $b$
    begin
      if pg_trigger_depth() = 0 and not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
        raise exception 'No tienes acceso a este proyecto.';
      end if;
      return query select * from public._resumen_ejecucion_proyecto(p_proyecto_id);
    end;
    $b$
  $f$, v_res);

  -- ------------------------------------------------ registrar_salida_almacen
  if to_regprocedure('public._registrar_salida_almacen(uuid, jsonb, text, text)') is null then
    alter function public.registrar_salida_almacen(uuid, jsonb, text, text) rename to _registrar_salida_almacen;
  end if;
  v_res := pg_get_function_result('public._registrar_salida_almacen(uuid, jsonb, text, text)'::regprocedure);
  execute format($f$
    create or replace function public.registrar_salida_almacen(
      p_proyecto_id uuid, p_lineas jsonb, p_retira text, p_observaciones text
    )
    returns %s
    language plpgsql
    security definer
    set search_path = public
    as $b$
    begin
      if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
        raise exception 'No tienes acceso a este proyecto.';
      end if;
      return public._registrar_salida_almacen(p_proyecto_id, p_lineas, p_retira, p_observaciones);
    end;
    $b$
  $f$, v_res);
end;
$$;

revoke all on function public._resumen_ejecucion_proyecto(uuid) from public, anon, authenticated;
revoke all on function public._registrar_salida_almacen(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.resumen_ejecucion_proyecto(uuid) from public, anon;
revoke all on function public.registrar_salida_almacen(uuid, jsonb, text, text) from public, anon;
grant execute on function public.resumen_ejecucion_proyecto(uuid) to authenticated;
grant execute on function public.registrar_salida_almacen(uuid, jsonb, text, text) to authenticated;
