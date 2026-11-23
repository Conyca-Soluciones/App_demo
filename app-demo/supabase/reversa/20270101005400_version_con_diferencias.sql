-- Reversa de 20270101005400_version_con_diferencias.sql.
-- Quita crear_version_con_diferencias, reutilizar_decisiones_items y
-- _borrar_solicitudes_sin_lineas, y devuelve crear_nueva_version a como estaba
-- (sin copiar las líneas de revisión ni sus solicitudes). Las versiones ya
-- creadas se dejan.

begin;
set local lock_timeout = '10s';

drop function if exists public.crear_version_con_diferencias(uuid, text, jsonb);
drop function if exists public.reutilizar_decisiones_items(uuid, jsonb);
drop function if exists public._borrar_solicitudes_sin_lineas(uuid[], uuid[], uuid[]);

create or replace function public.crear_nueva_version(p_presupuesto_id uuid, p_nombre text)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
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
  perform pg_advisory_xact_lock(hashtext('presupuesto_version:' || p_presupuesto_id::text));
  select version_actual_id into v_actual from presupuestos where id = p_presupuesto_id for update;
  if not found then
    raise exception 'El presupuesto no existe o no tienes acceso.';
  end if;
  if v_actual is null then
    raise exception 'El presupuesto todavía no tiene versión: guárdalo primero.';
  end if;
  select coalesce(max(numero), 0) + 1 into v_numero from presupuesto_versiones where presupuesto_id = p_presupuesto_id;
  insert into presupuesto_versiones (presupuesto_id, numero, nombre, desperdicio_pct)
  values (p_presupuesto_id, v_numero, v_nombre,
          coalesce((select x.desperdicio_pct from presupuesto_versiones x where x.id = v_actual), 0))
  returning id, numero, nombre, creado_en into v_nueva;
  insert into presupuesto_desperdicios (version_id, clave, porcentaje, actualizado_por, actualizado_at)
  select v_nueva.id, d.clave, d.porcentaje, d.actualizado_por, d.actualizado_at
    from presupuesto_desperdicios d where d.version_id = v_actual;
  select coalesce(jsonb_object_agg(pi.id::text, gen_random_uuid()), '{}'::jsonb) into v_items
    from presupuesto_items pi
   where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual;
  select coalesce(jsonb_object_agg(x.apu_id::text, gen_random_uuid()), '{}'::jsonb) into v_apus
    from (select distinct pi.apu_id from presupuesto_items pi
           where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_id is not null
          union
          select pi.apu_guardado_id from presupuesto_items pi
           where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_guardado_id is not null) x;
  insert into apu (id, codigo, descripcion)
  select (v_apus->>a.id::text)::uuid, a.codigo, a.descripcion
    from apu a
   where a.id in (select k::uuid from jsonb_object_keys(v_apus) k);
  insert into item_apu (apu_id, insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, equipo_categoria_id,
                        transporte_precio_id, cantidad, rendimiento, tipo, precio_unitario_congelado, unidad, factor_unidad, no_aplica, cantidad_base, desperdicio_pct, desperdicio_clave, concepto_fijo, valor_fijo)
  select (v_apus->>ia.apu_id::text)::uuid, ia.insumo_id, ia.mano_obra_categoria_id, ia.porcentaje_mano_obra,
         ia.equipo_categoria_id, ia.transporte_precio_id, ia.cantidad, coalesce(ia.rendimiento, 1), ia.tipo,
         ia.precio_unitario_congelado, ia.unidad, coalesce(ia.factor_unidad, 1), ia.no_aplica, ia.cantidad_base, ia.desperdicio_pct, ia.desperdicio_clave, ia.concepto_fijo, ia.valor_fijo
    from item_apu ia
   where ia.apu_id in (select k::uuid from jsonb_object_keys(v_apus) k);
  insert into presupuesto_items (id, presupuesto_id, version_id, padre_id, nivel, codigo, descripcion, unidad, cantidad,
                                 valor_unitario, valor_total, apu_id, precio_original, lineas_apu_oficial,
                                 modalidad, mano_obra_oficial, herramienta_menor_pct, apu_guardado_id)
  select (v_items->>pi.id::text)::uuid, p_presupuesto_id, v_nueva.id, (v_items->>pi.padre_id::text)::uuid, pi.nivel,
         pi.codigo, pi.descripcion, pi.unidad, pi.cantidad, pi.valor_unitario, pi.valor_total,
         (v_apus->>pi.apu_id::text)::uuid, pi.precio_original, pi.lineas_apu_oficial,
         pi.modalidad, pi.mano_obra_oficial, pi.herramienta_menor_pct, (v_apus->>pi.apu_guardado_id::text)::uuid
    from presupuesto_items pi
   where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual;
  update presupuestos set version_actual_id = v_nueva.id where id = p_presupuesto_id;
  return jsonb_build_object('id', v_nueva.id, 'numero', v_nueva.numero, 'nombre', v_nueva.nombre, 'creado_en', v_nueva.creado_en);
end;
$function$;

commit;
