-- Salidas de almacén: "quién retira" es obligatorio (decisión del usuario,
-- 2026-10-23). Se exige en los envoltorios públicos al registrar y al editar;
-- las internas (_registrar_salida_almacen / _editar_salida_almacen) no cambian.
-- No va como CHECK en salidas_insumos: hay salidas viejas sin el dato y un
-- CHECK (aunque sea not valid) haría fallar cualquier UPDATE sobre ellas, p. ej.
-- anularlas. Editar una salida vieja sí obliga a llenarlo.

create or replace function public.registrar_salida_almacen(
  p_proyecto_id uuid, p_lineas jsonb, p_retira text, p_observaciones text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.usuario_puede_ver_proyecto(auth.uid(), p_proyecto_id) then
    raise exception 'No tienes acceso a este proyecto.';
  end if;
  if nullif(trim(p_retira), '') is null then
    raise exception 'Escribe quién retira el material.';
  end if;
  return public._registrar_salida_almacen(p_proyecto_id, p_lineas, p_retira, p_observaciones);
end;
$$;

create or replace function public.editar_salida_almacen(
  p_salida_id uuid, p_cantidad numeric, p_retira text, p_observaciones text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._exigir_proyecto_almacen(public._proyecto_de_salida(p_salida_id));
  if nullif(trim(p_retira), '') is null then
    raise exception 'Escribe quién retira el material.';
  end if;
  perform public._editar_salida_almacen(p_salida_id, p_cantidad, p_retira, p_observaciones);
end;
$$;
