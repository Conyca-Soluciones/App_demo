-- Versión nueva desde el Excel aplicando solo las diferencias (2026-11-23,
-- paso 2; el paso 1, la comparación, está en lib/comparar-version.ts y
-- 20270101005300).
--
-- 1. crear_nueva_version copia también las líneas de revisión del import
--    (apu_import_revision: pendientes, esperando solicitud, rechazadas,
--    guardadas por la modalidad, trabajos de una división) con los ids nuevos
--    de ítem, APU y línea, y les pasa las solicitudes pendientes (la línea de
--    la versión anterior se suelta): al aprobarlas el insumo entra a la versión
--    nueva. Antes se perdían y la aprobación caía en la versión congelada.
--    Vale también para "Crear versión nueva" a secas.
-- 2. crear_version_con_diferencias(presupuesto, nombre, cambios): en UNA
--    transacción copia la vigente (crear_nueva_version) y le aplica lo que
--    cambió en el Excel:
--      quitar   [codigo]: borra el ítem y sus hijos si ninguno tiene
--               requisiciones ni contratos (si los tiene se deja y se reporta);
--      cambios  [{codigo, descripcion?, unidad?, cantidad?, precio_oficial?}]:
--               actualiza; la cantidad recalcula el total; el precio oficial
--               de un global sin APU es su valor, y a todo costo se vuelve a
--               aplicar la modalidad (si no tiene movimientos);
--      nuevos   [{codigo, codigo_padre, nivel, descripcion, unidad, cantidad,
--               precio_oficial, es_global}]: en orden de nivel, colgados del
--               padre por código;
--      rehacer  [codigo]: ítems cuyo APU cambia. No los toca: devuelve su id y
--               su APU de la copia para que la app los vuelva a importar.
--    Devuelve la versión y lo hecho. Historial 'version_desde_excel'.
--    Las solicitudes pendientes que solo usaban las líneas de un ítem quitado
--    se borran (_borrar_solicitudes_sin_lineas).
-- 3. reutilizar_decisiones_items(presupuesto, items [{item_id, apu_anterior}]):
--    después de importar otra vez el APU de esos ítems, cada línea nueva que ya
--    estaba en la copia (mismo texto, tipo y orden) toma lo decidido como
--    reutilizar_decisiones_version (línea resuelta con la cantidad nueva, la
--    misma solicitud o el rechazo); borra el APU de la copia (y el guardado) y
--    vuelve a aplicar la modalidad del ítem con _aplicar_modalidad_item (sirve
--    también con requisiciones o contratos: la modalidad no cambia). Pasan
--    también al APU nuevo, así solo sale lo que el Excel quitó:
--      - las líneas puestas a mano en el editor (sin línea del Excel), con su
--        cantidad; si el Excel ya trae ese mismo recurso no se repiten;
--      - la mano de obra dividida en trabajos, si el Excel sigue trayendo
--        mano de obra para el ítem (sus líneas de mano de obra quedan
--        'dividido');
--      - la mano de obra que pide la modalidad (con la categoría elegida o su
--        solicitud), si el Excel sigue sin traer mano de obra.
--
-- Va ANTES del código. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

-- 1. Copia completa --------------------------------------------------------
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
  v_lineas jsonb;
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
  insert into presupuesto_versiones (presupuesto_id, numero, nombre, desperdicio_pct)
  values (p_presupuesto_id, v_numero, v_nombre,
          coalesce((select x.desperdicio_pct from presupuesto_versiones x where x.id = v_actual), 0))
  returning id, numero, nombre, creado_en into v_nueva;

  -- El desperdicio de la versión pasa igual a la nueva.
  insert into presupuesto_desperdicios (version_id, clave, porcentaje, actualizado_por, actualizado_at)
  select v_nueva.id, d.clave, d.porcentaje, d.actualizado_por, d.actualizado_at
    from presupuesto_desperdicios d where d.version_id = v_actual;

  -- id viejo -> id nuevo de cada ítem, de cada APU usado y de cada línea.
  select coalesce(jsonb_object_agg(pi.id::text, gen_random_uuid()), '{}'::jsonb) into v_items
    from presupuesto_items pi
   where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual;
  select coalesce(jsonb_object_agg(x.apu_id::text, gen_random_uuid()), '{}'::jsonb) into v_apus
    from (select distinct pi.apu_id from presupuesto_items pi
           where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_id is not null
          union
          select pi.apu_guardado_id from presupuesto_items pi
           where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual and pi.apu_guardado_id is not null) x;
  select coalesce(jsonb_object_agg(ia.id::text, gen_random_uuid()), '{}'::jsonb) into v_lineas
    from item_apu ia
   where ia.apu_id in (select k::uuid from jsonb_object_keys(v_apus) k);

  insert into apu (id, codigo, descripcion)
  select (v_apus->>a.id::text)::uuid, a.codigo, a.descripcion
    from apu a
   where a.id in (select k::uuid from jsonb_object_keys(v_apus) k);

  insert into item_apu (id, apu_id, insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, equipo_categoria_id,
                        transporte_precio_id, cantidad, rendimiento, tipo, precio_unitario_congelado, unidad, factor_unidad,
                        no_aplica, cantidad_base, desperdicio_pct, desperdicio_clave, concepto_fijo, valor_fijo)
  select (v_lineas->>ia.id::text)::uuid, (v_apus->>ia.apu_id::text)::uuid, ia.insumo_id, ia.mano_obra_categoria_id,
         ia.porcentaje_mano_obra, ia.equipo_categoria_id, ia.transporte_precio_id, ia.cantidad, coalesce(ia.rendimiento, 1),
         ia.tipo, ia.precio_unitario_congelado, ia.unidad, coalesce(ia.factor_unidad, 1), ia.no_aplica, ia.cantidad_base,
         ia.desperdicio_pct, ia.desperdicio_clave, ia.concepto_fijo, ia.valor_fijo
    from item_apu ia
   where ia.apu_id in (select k::uuid from jsonb_object_keys(v_apus) k);

  -- Un solo INSERT: la llave a padre_id se revisa al final de la sentencia,
  -- así que el orden de las filas no importa.
  insert into presupuesto_items (id, presupuesto_id, version_id, padre_id, nivel, codigo, descripcion, unidad, cantidad,
                                 valor_unitario, valor_total, apu_id, precio_original, lineas_apu_oficial,
                                 modalidad, mano_obra_oficial, herramienta_menor_pct, apu_guardado_id)
  select (v_items->>pi.id::text)::uuid, p_presupuesto_id, v_nueva.id, (v_items->>pi.padre_id::text)::uuid, pi.nivel,
         pi.codigo, pi.descripcion, pi.unidad, pi.cantidad, pi.valor_unitario, pi.valor_total,
         (v_apus->>pi.apu_id::text)::uuid, pi.precio_original, pi.lineas_apu_oficial,
         pi.modalidad, pi.mano_obra_oficial, pi.herramienta_menor_pct, (v_apus->>pi.apu_guardado_id::text)::uuid
    from presupuesto_items pi
   where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual;

  -- Líneas de revisión del import (20270101005400): con los ids nuevos. Las
  -- solicitudes pendientes pasan a la copia y la línea vieja se suelta.
  insert into apu_import_revision (id, lote_import_id, presupuesto_item_id, apu_id, descripcion_original, tipo, unidad,
                                   cantidad, candidatos, estado, insumo_id_asignado, item_apu_id, created_at, solicitud_id,
                                   mano_obra_categoria_id_asignado, solicitud_mano_obra_id, equipo_categoria_id_asignado,
                                   solicitud_equipo_id, rendimiento, motivo_rechazo, convertir_insumo_id, dividida_de,
                                   agregada_por_modalidad)
  select gen_random_uuid(), r.lote_import_id, (v_items->>r.presupuesto_item_id::text)::uuid,
         (v_apus->>r.apu_id::text)::uuid, r.descripcion_original, r.tipo, r.unidad, r.cantidad, r.candidatos, r.estado,
         r.insumo_id_asignado, (v_lineas->>r.item_apu_id::text)::uuid, r.created_at,
         case when si.estado = 'pendiente' then r.solicitud_id end,
         r.mano_obra_categoria_id_asignado,
         case when sm.estado = 'pendiente' then r.solicitud_mano_obra_id end,
         r.equipo_categoria_id_asignado,
         case when se.estado = 'pendiente' then r.solicitud_equipo_id end,
         r.rendimiento, r.motivo_rechazo, r.convertir_insumo_id, r.dividida_de, r.agregada_por_modalidad
    from apu_import_revision r
    join presupuesto_items pi on pi.id = r.presupuesto_item_id
    left join solicitudes_insumos si on si.id = r.solicitud_id
    left join solicitudes_mano_obra sm on sm.id = r.solicitud_mano_obra_id
    left join solicitudes_equipo se on se.id = r.solicitud_equipo_id
   where pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual;

  update apu_import_revision r
     set solicitud_id = case when si.estado = 'pendiente' then null else r.solicitud_id end,
         solicitud_mano_obra_id = case when sm.estado = 'pendiente' then null else r.solicitud_mano_obra_id end,
         solicitud_equipo_id = case when se.estado = 'pendiente' then null else r.solicitud_equipo_id end
    from presupuesto_items pi, apu_import_revision r0
    left join solicitudes_insumos si on si.id = r0.solicitud_id
    left join solicitudes_mano_obra sm on sm.id = r0.solicitud_mano_obra_id
    left join solicitudes_equipo se on se.id = r0.solicitud_equipo_id
   where r0.id = r.id and pi.id = r.presupuesto_item_id
     and pi.presupuesto_id = p_presupuesto_id and pi.version_id = v_actual
     and (si.estado = 'pendiente' or sm.estado = 'pendiente' or se.estado = 'pendiente');

  update presupuestos set version_actual_id = v_nueva.id where id = p_presupuesto_id;

  return jsonb_build_object('id', v_nueva.id, 'numero', v_nueva.numero, 'nombre', v_nueva.nombre, 'creado_en', v_nueva.creado_en);
end;
$function$;

-- Solicitudes pendientes que ya ninguna línea de revisión usa (se quitó el ítem o
-- la línea): salen de Aprobación de insumos / mano de obra / equipo.
create or replace function public._borrar_solicitudes_sin_lineas(p_insumos uuid[], p_mano_obra uuid[], p_equipo uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer := 0;
  v_m integer;
begin
  delete from solicitudes_insumos s
   where s.id = any(coalesce(p_insumos, '{}')) and s.estado = 'pendiente'
     and not exists (select 1 from apu_import_revision r where r.solicitud_id = s.id);
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  delete from solicitudes_mano_obra s
   where s.id = any(coalesce(p_mano_obra, '{}')) and s.estado = 'pendiente'
     and not exists (select 1 from apu_import_revision r where r.solicitud_mano_obra_id = s.id);
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  delete from solicitudes_equipo s
   where s.id = any(coalesce(p_equipo, '{}')) and s.estado = 'pendiente'
     and not exists (select 1 from apu_import_revision r where r.solicitud_equipo_id = s.id);
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  return v_n;
end;
$$;
revoke all on function public._borrar_solicitudes_sin_lineas(uuid[], uuid[], uuid[]) from public, anon, authenticated;

-- 2. Copia + diferencias del Excel ------------------------------------------
create or replace function public.crear_version_con_diferencias(p_presupuesto_id uuid, p_nombre text, p_cambios jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_proyecto uuid;
  v_version jsonb;
  v_vid uuid;
  v_codigo text;
  v_item record;
  v_ids uuid[];
  v_codigos text[];
  v_quitados text[] := '{}';
  v_no_quitados jsonb := '[]'::jsonb;
  v_cambiados int := 0;
  v_nuevos jsonb := '{}'::jsonb;
  v_rehacer jsonb := '[]'::jsonb;
  c record;
  v_padre uuid;
  v_id uuid;
  v_val numeric;
  v_mov boolean;
  v_si uuid[];
  v_sm uuid[];
  v_se uuid[];
  v_sol_borradas integer := 0;
begin
  if v_uid is null or not tiene_accion(v_uid, 'editar_presupuestos') then
    raise exception 'No tienes permiso para editar presupuestos.';
  end if;
  select proyecto_id into v_proyecto from presupuestos where id = p_presupuesto_id;
  if not found or not usuario_puede_ver_proyecto(v_uid, v_proyecto) then
    raise exception 'El presupuesto no existe o no tienes acceso.';
  end if;
  if jsonb_typeof(coalesce(p_cambios, '{}'::jsonb)) <> 'object' then raise exception 'Cambios inválidos.'; end if;

  v_version := crear_nueva_version(p_presupuesto_id, p_nombre);
  v_vid := (v_version->>'id')::uuid;

  -- Quitar (con sus hijos), solo sin requisiciones ni contratos.
  for v_codigo in select jsonb_array_elements_text(coalesce(p_cambios->'quitar', '[]'::jsonb)) loop
    select id into v_id from presupuesto_items where version_id = v_vid and codigo = v_codigo;
    if v_id is null then continue; end if;
    with recursive arbol as (
      select id, codigo from presupuesto_items where id = v_id
      union all
      select h.id, h.codigo from presupuesto_items h join arbol a on h.padre_id = a.id
    ) select array_agg(id), array_agg(codigo) into v_ids, v_codigos from arbol;
    v_mov := exists (select 1 from pedidos_insumos p join presupuesto_items pi on pi.id = p.presupuesto_item_id
                      where pi.presupuesto_id = p_presupuesto_id and pi.codigo = any(v_codigos)
                        and p.estado in ('pendiente', 'aprobado'))
          or exists (select 1 from contrato_anexo_items ai join contratos ct on ct.id = ai.contrato_id
                       join presupuesto_items pi on pi.id = ai.presupuesto_item_id
                      where pi.presupuesto_id = p_presupuesto_id and pi.codigo = any(v_codigos) and ct.estado <> 'rechazada');
    if v_mov then
      v_no_quitados := v_no_quitados || jsonb_build_object('codigo', v_codigo, 'motivo', 'tiene requisiciones o contratos');
      continue;
    end if;
    select array_agg(r.solicitud_id) filter (where r.solicitud_id is not null),
           array_agg(r.solicitud_mano_obra_id) filter (where r.solicitud_mano_obra_id is not null),
           array_agg(r.solicitud_equipo_id) filter (where r.solicitud_equipo_id is not null)
      into v_si, v_sm, v_se
      from apu_import_revision r where r.presupuesto_item_id = any(v_ids);
    delete from presupuesto_items where id = v_id;
    v_sol_borradas := v_sol_borradas + _borrar_solicitudes_sin_lineas(v_si, v_sm, v_se);
    v_quitados := v_quitados || v_codigo;
  end loop;

  -- Cambios de un ítem que ya estaba.
  for c in select * from jsonb_to_recordset(coalesce(p_cambios->'cambios', '[]'::jsonb))
             as x(codigo text, descripcion text, unidad text, cantidad numeric, precio_oficial numeric,
                  trae_descripcion boolean, trae_unidad boolean, trae_cantidad boolean, trae_precio boolean) loop
    select * into v_item from presupuesto_items where version_id = v_vid and codigo = c.codigo;
    if not found then continue; end if;
    update presupuesto_items
       set descripcion = case when c.trae_descripcion then coalesce(nullif(trim(c.descripcion), ''), descripcion) else descripcion end,
           unidad = case when c.trae_unidad then c.unidad else unidad end,
           cantidad = case when c.trae_cantidad then c.cantidad else cantidad end,
           precio_original = case when c.trae_precio then c.precio_oficial else precio_original end
     where id = v_item.id;
    -- Total con la cantidad nueva; un global sin APU vale su precio oficial.
    update presupuesto_items pi
       set valor_unitario = case when pi.apu_id is null and upper(trim(coalesce(pi.unidad, ''))) in ('GL', 'GLB', 'GLOBAL')
                                 then pi.precio_original else pi.valor_unitario end
     where pi.id = v_item.id;
    update presupuesto_items pi
       set valor_total = case when pi.valor_unitario is not null and pi.cantidad is not null
                              then round(pi.valor_unitario * pi.cantidad, 2) end
     where pi.id = v_item.id;
    if c.trae_precio and v_item.modalidad = 'todo_costo'
       and not (select i.con_movimientos from _info_modalidad_item(v_item.id) i)
       and not (c.codigo in (select jsonb_array_elements_text(coalesce(p_cambios->'rehacer', '[]'::jsonb)))) then
      perform _aplicar_modalidad_item(v_item.id, 'todo_costo');
    end if;
    v_cambiados := v_cambiados + 1;
  end loop;

  -- Ítems nuevos, en orden de nivel (el padre ya existe cuando llega el hijo).
  for c in select * from jsonb_to_recordset(coalesce(p_cambios->'nuevos', '[]'::jsonb))
             as x(codigo text, codigo_padre text, nivel int, descripcion text, unidad text, cantidad numeric,
                  precio_oficial numeric, es_global boolean)
           order by x.nivel, x.codigo loop
    if exists (select 1 from presupuesto_items where version_id = v_vid and codigo = c.codigo) then
      raise exception 'El ítem % ya está en el presupuesto.', c.codigo;
    end if;
    v_padre := null;
    if c.codigo_padre is not null then
      select id into v_padre from presupuesto_items where version_id = v_vid and codigo = c.codigo_padre;
      if v_padre is null then raise exception 'No se encontró el capítulo % del ítem nuevo %.', c.codigo_padre, c.codigo; end if;
    end if;
    v_val := case when coalesce(c.es_global, false) then c.precio_oficial end;
    insert into presupuesto_items (presupuesto_id, version_id, padre_id, nivel, codigo, descripcion, unidad, cantidad,
                                   valor_unitario, valor_total, precio_original)
    values (p_presupuesto_id, v_vid, v_padre, coalesce(c.nivel, 1), c.codigo, coalesce(nullif(trim(c.descripcion), ''), c.codigo),
            c.unidad, c.cantidad, v_val,
            case when v_val is not null and c.cantidad is not null then round(v_val * c.cantidad, 2) end,
            c.precio_oficial)
    returning id into v_id;
    v_nuevos := v_nuevos || jsonb_build_object(c.codigo, v_id);
  end loop;

  -- APU que cambian: la app los vuelve a importar.
  for v_codigo in select jsonb_array_elements_text(coalesce(p_cambios->'rehacer', '[]'::jsonb)) loop
    select id, apu_id into v_item from presupuesto_items where version_id = v_vid and codigo = v_codigo;
    if not found then continue; end if;
    v_rehacer := v_rehacer || jsonb_build_object('codigo', v_codigo, 'item_id', v_item.id, 'apu_anterior', v_item.apu_id);
  end loop;

  perform _anotar_historial('presupuesto', p_presupuesto_id, 'version_desde_excel',
    jsonb_build_object('version_id', v_vid, 'quitados', to_jsonb(v_quitados), 'no_quitados', v_no_quitados,
                       'cambiados', v_cambiados, 'nuevos', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(v_nuevos) k),
                       'apu_rehechos', jsonb_array_length(v_rehacer)));

  return jsonb_build_object('version', v_version, 'quitados', to_jsonb(v_quitados), 'no_quitados', v_no_quitados,
                            'cambiados', v_cambiados, 'nuevos', v_nuevos, 'rehacer', v_rehacer,
                            'solicitudes_cerradas', v_sol_borradas);
end;
$$;
revoke all on function public.crear_version_con_diferencias(uuid, text, jsonb) from public, anon;
grant execute on function public.crear_version_con_diferencias(uuid, text, jsonb) to authenticated;

-- 3. Decisiones de la copia para los APU que se volvieron a importar ---------
create or replace function public.reutilizar_decisiones_items(p_presupuesto_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_proyecto uuid;
  v_version uuid;
  v_resueltas int := 0;
  v_solicitudes int := 0;
  v_rechazadas int := 0;
  v_a_mano int := 0;
  v_a_mano_repetidas int := 0;
  v_divisiones int := 0;
  v_divisiones_perdidas int := 0;
  v_mo_modalidad int := 0;
  v_apus uuid[];
  v_filas jsonb;
  v_mod jsonb;
  c record;
  v_ia uuid;
  v_si uuid[];
  v_sm uuid[];
  v_se uuid[];
  v_sol_borradas integer;
begin
  if v_uid is null or not tiene_accion(v_uid, 'editar_presupuestos') then
    raise exception 'No tienes permiso para editar presupuestos.';
  end if;
  select proyecto_id, version_actual_id into v_proyecto, v_version from presupuestos where id = p_presupuesto_id for update;
  if not found or not usuario_puede_ver_proyecto(v_uid, v_proyecto) then
    raise exception 'El presupuesto no existe o no tienes acceso.';
  end if;

  create temp table _rehechos on commit drop as
  select pi.id as item_id, pi.codigo, pi.apu_id as apu_nuevo, (x->>'apu_anterior')::uuid as apu_anterior,
         pi.apu_guardado_id as guardado_anterior, pi.modalidad, pi.mano_obra_oficial, pi.herramienta_menor_pct
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    join presupuesto_items pi on pi.id = (x->>'item_id')::uuid
   where pi.version_id = v_version;

  -- Parejas: línea nueva (APU recién importado) con la de la copia, por texto, tipo y orden.
  create temp table _pares_i on commit drop as
  with n as (
    select r.id, r.tipo, r.cantidad, r.item_apu_id, r.estado, h.item_id, h.apu_nuevo,
           _clave_actividad(r.descripcion_original) as k,
           row_number() over (partition by h.item_id, _clave_actividad(r.descripcion_original), r.tipo order by r.created_at, r.id) as rn
      from apu_import_revision r join _rehechos h on h.item_id = r.presupuesto_item_id
     where r.apu_id = h.apu_nuevo and r.dividida_de is null and not r.agregada_por_modalidad
  ),
  a as (
    select r.*, h.item_id as h_item,
           _clave_actividad(r.descripcion_original) as k,
           row_number() over (partition by h.item_id, _clave_actividad(r.descripcion_original), r.tipo order by r.created_at, r.id) as rn
      from apu_import_revision r join _rehechos h on h.item_id = r.presupuesto_item_id
     where r.apu_id is distinct from h.apu_nuevo and r.dividida_de is null and not r.agregada_por_modalidad
  )
  select n.id as n_id, n.apu_nuevo as n_apu, n.item_apu_id as n_ia, n.cantidad as n_cant, n.estado as n_estado,
         a.estado as a_estado, a.item_apu_id as a_ia, a.insumo_id_asignado, a.mano_obra_categoria_id_asignado,
         a.equipo_categoria_id_asignado, a.solicitud_id, a.solicitud_mano_obra_id, a.solicitud_equipo_id, a.motivo_rechazo
    from n join a on a.h_item = n.item_id and a.k = n.k and a.tipo = n.tipo and a.rn = n.rn;

  create temp table _toma_i on commit drop as
  select p.*,
         case
           when p.a_estado in ('resuelto', 'auto_match', 'no_requerido') and p.a_ia is not null
                and exists (select 1 from item_apu x where x.id = p.a_ia)
                and not (p.a_estado = 'auto_match' and p.n_estado = 'auto_match') then 'linea'
           when coalesce(p.solicitud_id, p.solicitud_mano_obra_id, p.solicitud_equipo_id) is not null then 'solicitud'
           when p.a_estado = 'rechazado' then 'rechazo'
         end as accion
    from _pares_i p;
  delete from _toma_i where accion is null;

  update apu_import_revision r set item_apu_id = null from _toma_i t where r.id = t.n_id and t.n_ia is not null;
  delete from item_apu ia using _toma_i t
   where ia.id = t.n_ia and not exists (select 1 from apu_import_revision r where r.item_apu_id = ia.id);

  for c in select t.n_apu, t.a_ia, min(t.n_cant) as cant from _toma_i t where t.accion = 'linea' group by t.n_apu, t.a_ia loop
    insert into item_apu (apu_id, insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, equipo_categoria_id,
                          transporte_precio_id, cantidad, rendimiento, tipo, precio_unitario_congelado, unidad,
                          factor_unidad, no_aplica, desperdicio_clave)
    select c.n_apu, x.insumo_id, x.mano_obra_categoria_id, x.porcentaje_mano_obra, x.equipo_categoria_id,
           x.transporte_precio_id,
           case when x.mano_obra_categoria_id is not null then coalesce(x.cantidad_base, x.cantidad) else c.cant end,
           x.rendimiento, x.tipo, x.precio_unitario_congelado, x.unidad, x.factor_unidad, x.no_aplica, x.desperdicio_clave
      from item_apu x where x.id = c.a_ia
    returning id into v_ia;
    update apu_import_revision r
       set estado = 'resuelto', item_apu_id = v_ia, insumo_id_asignado = t.insumo_id_asignado,
           mano_obra_categoria_id_asignado = t.mano_obra_categoria_id_asignado,
           equipo_categoria_id_asignado = t.equipo_categoria_id_asignado
      from _toma_i t
     where r.id = t.n_id and t.accion = 'linea' and t.n_apu = c.n_apu and t.a_ia = c.a_ia;
  end loop;
  select count(*) into v_resueltas from _toma_i where accion = 'linea';

  update apu_import_revision r
     set estado = 'solicitud_pendiente', solicitud_id = t.solicitud_id,
         solicitud_mano_obra_id = t.solicitud_mano_obra_id, solicitud_equipo_id = t.solicitud_equipo_id
    from _toma_i t where r.id = t.n_id and t.accion = 'solicitud';
  select count(*) into v_solicitudes from _toma_i where accion = 'solicitud';

  update apu_import_revision r set estado = 'rechazado', motivo_rechazo = t.motivo_rechazo
    from _toma_i t where r.id = t.n_id and t.accion = 'rechazo';
  select count(*) into v_rechazadas from _toma_i where accion = 'rechazo';

  -- Qué trae el APU nuevo (lo recién importado del Excel) de mano de obra.
  create temp table _mo_nueva on commit drop as
  select h.item_id,
         exists (select 1 from apu_import_revision r
                  where r.presupuesto_item_id = h.item_id and r.apu_id = h.apu_nuevo and r.tipo = 'MO'
                    and r.dividida_de is null and not r.agregada_por_modalidad) as trae_mo,
         exists (select 1 from apu_import_revision r
                  where r.presupuesto_item_id = h.item_id and r.apu_id is distinct from h.apu_nuevo
                    and r.dividida_de is not null and not r.agregada_por_modalidad) as dividida,
         exists (select 1 from apu_import_revision r
                  where r.presupuesto_item_id = h.item_id and r.apu_id is distinct from h.apu_nuevo
                    and r.agregada_por_modalidad) as con_agregada
    from _rehechos h;

  -- Mano de obra dividida en trabajos: sigue si el Excel trae mano de obra. Las
  -- líneas de mano de obra del Excel quedan 'dividido' (con la categoría que
  -- tenían, para "Juntar otra vez") y los trabajos pasan al APU nuevo.
  update apu_import_revision r
     set estado = 'dividido', solicitud_mano_obra_id = null, item_apu_id = null,
         mano_obra_categoria_id_asignado = (select p.mano_obra_categoria_id_asignado from _pares_i p
                                             where p.n_id = r.id and p.a_estado = 'dividido')
    from _rehechos h join _mo_nueva m on m.item_id = h.item_id
   where m.dividida and m.trae_mo
     and r.presupuesto_item_id = h.item_id and r.apu_id = h.apu_nuevo and r.tipo = 'MO'
     and r.dividida_de is null and not r.agregada_por_modalidad;
  delete from item_apu ia using _rehechos h join _mo_nueva m on m.item_id = h.item_id
   where m.dividida and m.trae_mo and ia.apu_id = h.apu_nuevo and ia.mano_obra_categoria_id is not null
     and not exists (select 1 from apu_import_revision r where r.item_apu_id = ia.id);
  update item_apu ia set apu_id = h.apu_nuevo
    from apu_import_revision r, _rehechos h, _mo_nueva m
   where m.item_id = h.item_id and m.dividida and m.trae_mo
     and r.presupuesto_item_id = h.item_id and r.apu_id is distinct from h.apu_nuevo
     and r.dividida_de is not null and not r.agregada_por_modalidad and ia.id = r.item_apu_id;
  update apu_import_revision r set apu_id = h.apu_nuevo
    from _rehechos h, _mo_nueva m
   where m.item_id = h.item_id and m.dividida and m.trae_mo
     and r.presupuesto_item_id = h.item_id and r.apu_id is distinct from h.apu_nuevo
     and r.dividida_de is not null and not r.agregada_por_modalidad;
  select count(*) filter (where trae_mo), count(*) filter (where not trae_mo)
    into v_divisiones, v_divisiones_perdidas from _mo_nueva where dividida;

  -- Mano de obra que pide la modalidad (y sus trabajos si se dividió): sigue si
  -- el Excel sigue sin traer mano de obra. Con mano de obra en el Excel ya no
  -- hace falta y sale con la copia.
  update item_apu ia set apu_id = h.apu_nuevo
    from apu_import_revision r, _rehechos h, _mo_nueva m
   where m.item_id = h.item_id and m.con_agregada and not m.trae_mo
     and r.presupuesto_item_id = h.item_id and r.apu_id is distinct from h.apu_nuevo
     and r.agregada_por_modalidad and ia.id = r.item_apu_id;
  update apu_import_revision r set apu_id = h.apu_nuevo
    from _rehechos h, _mo_nueva m
   where m.item_id = h.item_id and m.con_agregada and not m.trae_mo
     and r.presupuesto_item_id = h.item_id and r.apu_id is distinct from h.apu_nuevo and r.agregada_por_modalidad;
  get diagnostics v_mo_modalidad = row_count;

  -- Líneas puestas a mano en el editor (sin línea del Excel): pasan tal cual
  -- al APU nuevo (con su cantidad), salvo que el Excel ya traiga ese recurso.
  create temp table _a_mano on commit drop as
  select ia.id, h.apu_nuevo,
         exists (select 1 from item_apu y
                  where y.apu_id = h.apu_nuevo and y.concepto_fijo is null
                    and y.insumo_id is not distinct from ia.insumo_id
                    and y.mano_obra_categoria_id is not distinct from ia.mano_obra_categoria_id
                    and y.equipo_categoria_id is not distinct from ia.equipo_categoria_id
                    and y.transporte_precio_id is not distinct from ia.transporte_precio_id
                    and (y.porcentaje_mano_obra is null) = (ia.porcentaje_mano_obra is null)
                    and _clave_actividad(coalesce(y.no_aplica, '')) = _clave_actividad(coalesce(ia.no_aplica, ''))) as repetida
    from item_apu ia join _rehechos h on ia.apu_id in (h.apu_anterior, h.guardado_anterior)
   where ia.concepto_fijo is null
     and not exists (select 1 from apu_import_revision r where r.item_apu_id = ia.id);
  update item_apu ia set apu_id = m.apu_nuevo from _a_mano m where ia.id = m.id and not m.repetida;
  select count(*) filter (where not repetida), count(*) filter (where repetida)
    into v_a_mano, v_a_mano_repetidas from _a_mano;

  -- Fuera el APU de la copia (con sus líneas de revisión). La modalidad se
  -- vuelve a aplicar sobre el APU nuevo (más abajo).
  update presupuesto_items pi set apu_guardado_id = null from _rehechos h where pi.id = h.item_id;
  select array_agg(r.solicitud_id) filter (where r.solicitud_id is not null),
         array_agg(r.solicitud_mano_obra_id) filter (where r.solicitud_mano_obra_id is not null),
         array_agg(r.solicitud_equipo_id) filter (where r.solicitud_equipo_id is not null)
    into v_si, v_sm, v_se
    from apu_import_revision r join _rehechos h on h.item_id = r.presupuesto_item_id
   where r.apu_id is distinct from h.apu_nuevo;
  delete from apu_import_revision r using _rehechos h
   where r.presupuesto_item_id = h.item_id and r.apu_id is distinct from h.apu_nuevo;
  delete from apu where id in (select apu_anterior from _rehechos where apu_anterior is not null
                               union select guardado_anterior from _rehechos where guardado_anterior is not null);
  -- Las solicitudes de líneas que ya no vienen en el Excel quedan sin uso.
  v_sol_borradas := _borrar_solicitudes_sin_lineas(v_si, v_sm, v_se);

  select array_agg(distinct apu_nuevo) into v_apus from _rehechos where apu_nuevo is not null;
  if v_apus is not null then
    perform _aplicar_desperdicio_apus(v_apus);
    perform recalcular_valor_apus(v_apus);
  end if;

  -- La misma modalidad otra vez (_aplicar_modalidad_item es idempotente y,
  -- a diferencia de fijar_modalidades_presupuesto, sirve también para ítems
  -- con requisiciones o contratos: la modalidad no cambia).
  v_mod := '[]'::jsonb;
  for c in select item_id, codigo, modalidad from _rehechos where modalidad is not null order by codigo loop
    begin
      perform _aplicar_modalidad_item(c.item_id, c.modalidad);
      v_filas := coalesce(v_filas, '[]'::jsonb) || to_jsonb(c.codigo);
    exception when others then
      v_mod := v_mod || jsonb_build_object('codigo', c.codigo, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('resueltas', v_resueltas, 'solicitudes', v_solicitudes, 'rechazadas', v_rechazadas,
                            'lineas_a_mano', v_a_mano, 'lineas_a_mano_repetidas', v_a_mano_repetidas,
                            'divisiones', v_divisiones, 'divisiones_perdidas', v_divisiones_perdidas,
                            'mo_modalidad', v_mo_modalidad, 'modalidades', coalesce(jsonb_array_length(v_filas), 0),
                            'errores_modalidades', v_mod, 'solicitudes_cerradas', v_sol_borradas);
end;
$$;
revoke all on function public.reutilizar_decisiones_items(uuid, jsonb) from public, anon;
grant execute on function public.reutilizar_decisiones_items(uuid, jsonb) to authenticated;

commit;
