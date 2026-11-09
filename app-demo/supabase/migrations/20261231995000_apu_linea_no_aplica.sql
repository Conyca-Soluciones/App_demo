-- Línea del APU "No aplica" (decisión del usuario, 2026-11-09). Ej.: "Relleno
-- de recebo con material local": el APU del Excel la trae, pero no se compra
-- nada. En la revisión del import se marca "No aplica" y queda en el APU por
-- trazabilidad, sin insumo y en $ 0.
--
-- item_apu.no_aplica = la descripción de la línea del Excel. Una línea es de
-- UN recurso (insumo, MO, %, equipo o transporte) o, sin ninguno, No aplica.
-- recalcular_valor_apus ya la suma en 0 (todo va con left join); las funciones
-- de requisiciones y control cruzan por insumo, así que no la ven.
-- crear_nueva_version la copia (parche de texto sobre la versión viva; falla
-- si no encuentra el texto). Se puede correr más de una vez.

alter table public.item_apu add column if not exists no_aplica text;

alter table public.item_apu drop constraint if exists item_apu_recurso_unico_check;
alter table public.item_apu add constraint item_apu_recurso_unico_check check (
  num_nonnulls(insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, equipo_categoria_id, transporte_precio_id)
    = case when no_aplica is null then 1 else 0 end
);

do $$
declare
  d text := pg_get_functiondef('public.crear_nueva_version'::regproc);
  a1 text := E'transporte_precio_id, cantidad, rendimiento, tipo, precio_unitario_congelado, unidad, factor_unidad)\n';
  b1 text := E'transporte_precio_id, cantidad, rendimiento, tipo, precio_unitario_congelado, unidad, factor_unidad, no_aplica)\n';
  a2 text := E'ia.precio_unitario_congelado, ia.unidad, coalesce(ia.factor_unidad, 1)\n';
  b2 text := E'ia.precio_unitario_congelado, ia.unidad, coalesce(ia.factor_unidad, 1), ia.no_aplica\n';
begin
  d := replace(d, E'\r\n', E'\n');
  if position('ia.no_aplica' in d) > 0 then
    return;
  end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 then
    raise exception 'crear_nueva_version no tiene el texto esperado.';
  end if;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;
