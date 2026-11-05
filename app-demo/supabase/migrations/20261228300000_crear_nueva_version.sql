-- "Crear versión nueva" del presupuesto en UNA transacción (pendiente: antes
-- crearNuevaVersion lo hacía desde la app en 5 pasos y, si fallaba a mitad,
-- dejaba una versión vacía y APUs huérfanos).
--
-- Hace lo mismo que hacía la app: duplica todos los ítems de la versión actual
-- (con su jerarquía), copia el APU de cada uno a un apu_id nuevo con todas sus
-- líneas (insumo, mano de obra, equipo, transporte, herramienta menor) y el
-- precio congelado tal cual (la versión vieja queda como foto), crea la versión
-- con el número siguiente y la deja como actual. Si algo falla, no queda nada.
--
-- SECURITY INVOKER: valen las mismas políticas que antes (editar el presupuesto
-- y escribir APU de los proyectos de cada quien). Se puede correr más de una vez.

create or replace function public.crear_nueva_version(p_presupuesto_id uuid, p_nombre text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nombre text := nullif(trim(p_nombre), '');
  v_actual uuid;
  v_numero integer;
  v_nueva record;
  v_items jsonb;
  v_apus jsonb;
begin
  if v_nombre is null then
    raise exception 'Escribe el nombre de la versión.';
  end if;

  -- Dos "crear versión" a la vez sobre el mismo presupuesto no toman el mismo número.
  perform pg_advisory_xact_lock(hashtext('presupuesto_version:' || p_presupuesto_id::text));
  select version_actual_id into v_actual from presupuestos where id = p_presupuesto_id for update;
  if not found then
    raise exception 'El presupuesto no existe o no tienes acceso.';
  end if;
  if v_actual is null then
    raise exception 'El presupuesto todavía no tiene versión: guárdalo primero.';
  end if;

  select coalesce(max(numero), 0) + 1 into v_numero from presupuesto_versiones where presupuesto_id = p_presupuesto_id;
  insert into presupuesto_versiones (presupuesto_id, numero, nombre)
  values (p_presupuesto_id, v_numero, v_nombre)
  returning id, numero, nombre, creado_en into v_nueva;

  -- id viejo -> id nuevo de cada ítem y de cada APU usado.
  select coalesce(jsonb_object_agg(pi.id::text, gen_random_uuid()), '{}'::jsonb) into v_items
    from presupuesto_items pi
   where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual;
  select coalesce(jsonb_object_agg(x.apu_id::text, gen_random_uuid()), '{}'::jsonb) into v_apus
    from (select distinct pi.apu_id from presupuesto_items pi
           where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_id is not null) x;

  insert into apu (id, codigo, descripcion)
  select (v_apus->>a.id::text)::uuid, a.codigo, a.descripcion
    from apu a
   where a.id in (select k::uuid from jsonb_object_keys(v_apus) k);

  insert into item_apu (apu_id, insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, equipo_categoria_id,
                        transporte_precio_id, cantidad, rendimiento, tipo, precio_unitario_congelado, unidad, factor_unidad)
  select (v_apus->>ia.apu_id::text)::uuid, ia.insumo_id, ia.mano_obra_categoria_id, ia.porcentaje_mano_obra,
         ia.equipo_categoria_id, ia.transporte_precio_id, ia.cantidad, coalesce(ia.rendimiento, 1), ia.tipo,
         ia.precio_unitario_congelado, ia.unidad, coalesce(ia.factor_unidad, 1)
    from item_apu ia
   where ia.apu_id in (select k::uuid from jsonb_object_keys(v_apus) k);

  -- Un solo INSERT: la llave a padre_id se revisa al final de la sentencia,
  -- así que el orden de las filas no importa.
  insert into presupuesto_items (id, presupuesto_id, version_id, padre_id, nivel, codigo, descripcion, unidad, cantidad,
                                 valor_unitario, valor_total, apu_id, precio_original, lineas_apu_oficial)
  select (v_items->>pi.id::text)::uuid, p_presupuesto_id, v_nueva.id, (v_items->>pi.padre_id::text)::uuid, pi.nivel,
         pi.codigo, pi.descripcion, pi.unidad, pi.cantidad, pi.valor_unitario, pi.valor_total,
         (v_apus->>pi.apu_id::text)::uuid, pi.precio_original, pi.lineas_apu_oficial
    from presupuesto_items pi
   where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual;

  update presupuestos set version_actual_id = v_nueva.id where id = p_presupuesto_id;

  return jsonb_build_object('id', v_nueva.id, 'numero', v_nueva.numero, 'nombre', v_nueva.nombre, 'creado_en', v_nueva.creado_en);
end;
$$;
revoke all on function public.crear_nueva_version(uuid, text) from public, anon;
grant execute on function public.crear_nueva_version(uuid, text) to authenticated;
