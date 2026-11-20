-- Versión nueva desde el Excel sin perder lo decidido (decisión del usuario,
-- 2026-11-20; caso: el Malecón con los APU recompuestos y los precios
-- ajustados a la propuesta).
--
-- Subir el Excel a un proyecto que ya tiene presupuesto crea una versión nueva
-- y el import arma sus APU desde cero. Al terminar, la app llama
-- reutilizar_decisiones_version(presupuesto): cada línea del APU nuevo que ya
-- estaba en la versión anterior (mismo código de ítem, mismo nombre de línea
-- sin mayúsculas ni espacios de más, mismo tipo y, si se repite, el mismo
-- orden) toma la decisión de antes:
-- - resuelta (o automática que en la nueva no salió automática): la misma
--   línea del APU (insumo / categoría / equipo / "No aplica", unidad,
--   conversión y precio congelado) con la CANTIDAD NUEVA del Excel. La mano de
--   obra sigue siendo 1 por unidad del ítem.
-- - esperando aprobación: queda colgada de la MISMA solicitud (no se pide otra
--   vez) y la línea de la versión anterior se suelta, así al aprobarla el
--   insumo entra a la versión nueva y no a la congelada.
-- - rechazada: rechazada con el mismo motivo (se elige otra).
-- Lo que no estaba (líneas nuevas) se queda como lo dejó el import. También
-- pasan el desperdicio (general y excepciones) y, si la versión anterior tenía
-- modalidades, las modalidades (con fijar_modalidades_presupuesto). La versión
-- anterior queda congelada como historial. Se hace una sola vez por versión.
--
-- Va ANTES del código. Reversa en supabase/reversa/.

begin;
set local lock_timeout = '10s';

alter table public.presupuesto_versiones add column if not exists decisiones_reutilizadas_at timestamptz;

create or replace function public.reutilizar_decisiones_version(p_presupuesto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_proyecto uuid;
  v_nueva uuid;
  v_anterior uuid;
  v_numero integer;
  v_resueltas integer := 0;
  v_solicitudes integer := 0;
  v_rechazadas integer := 0;
  v_nuevas integer;
  v_quitadas integer;
  v_apus uuid[];
  v_filas jsonb;
  v_modalidades jsonb;
  c record;
  v_ia uuid;
begin
  if v_uid is null or not public.tiene_accion(v_uid, 'editar_presupuestos') then
    raise exception 'No tienes permiso para editar presupuestos.';
  end if;
  select p.proyecto_id, p.version_actual_id into v_proyecto, v_nueva
    from presupuestos p where p.id = p_presupuesto_id for update;
  if not found or not public.usuario_puede_ver_proyecto(v_uid, v_proyecto) then
    raise exception 'El presupuesto no existe o no tienes acceso.';
  end if;
  select numero into v_numero from presupuesto_versiones where id = v_nueva;
  if exists (select 1 from presupuesto_versiones where id = v_nueva and decisiones_reutilizadas_at is not null) then
    raise exception 'Esta versión ya tomó las decisiones de la anterior.';
  end if;
  select id into v_anterior from presupuesto_versiones
   where presupuesto_id = p_presupuesto_id and numero < v_numero order by numero desc limit 1;
  if v_anterior is null then
    raise exception 'El presupuesto no tiene una versión anterior.';
  end if;

  -- Desperdicio de la versión anterior.
  update presupuesto_versiones n set desperdicio_pct = a.desperdicio_pct
    from presupuesto_versiones a where n.id = v_nueva and a.id = v_anterior;
  insert into presupuesto_desperdicios (version_id, clave, porcentaje, actualizado_por, actualizado_at)
  select v_nueva, d.clave, d.porcentaje, v_uid, now() from presupuesto_desperdicios d where d.version_id = v_anterior
  on conflict (version_id, clave) do nothing;

  -- Parejas de líneas: misma clave (código del ítem, nombre de la línea, tipo, orden).
  create temp table _pares on commit drop as
  with n as (
    select r.id, r.tipo, r.cantidad, r.item_apu_id, r.estado, pi.codigo, pi.apu_id,
           public._clave_actividad(r.descripcion_original) as k,
           row_number() over (partition by pi.codigo, public._clave_actividad(r.descripcion_original), r.tipo
                              order by r.created_at, r.id) as rn
      from apu_import_revision r join presupuesto_items pi on pi.id = r.presupuesto_item_id
     where pi.version_id = v_nueva and r.dividida_de is null and not r.agregada_por_modalidad
  ),
  a as (
    select r.*, pi.codigo,
           public._clave_actividad(r.descripcion_original) as k,
           row_number() over (partition by pi.codigo, public._clave_actividad(r.descripcion_original), r.tipo
                              order by r.created_at, r.id) as rn
      from apu_import_revision r join presupuesto_items pi on pi.id = r.presupuesto_item_id
     where pi.version_id = v_anterior and r.dividida_de is null and not r.agregada_por_modalidad
  )
  select n.id as n_id, n.apu_id as n_apu, n.item_apu_id as n_ia, n.cantidad as n_cant, n.estado as n_estado,
         a.id as a_id, a.estado as a_estado, a.item_apu_id as a_ia,
         a.insumo_id_asignado, a.mano_obra_categoria_id_asignado, a.equipo_categoria_id_asignado,
         a.solicitud_id, a.solicitud_mano_obra_id, a.solicitud_equipo_id, a.motivo_rechazo
    from n join a on a.codigo = n.codigo and a.k = n.k and a.tipo = n.tipo and a.rn = n.rn;

  -- Qué se toma de cada pareja.
  create temp table _toma on commit drop as
  select p.*,
         case
           when p.a_estado in ('resuelto', 'auto_match') and p.a_ia is not null
                and exists (select 1 from item_apu x where x.id = p.a_ia)
                and not (p.a_estado = 'auto_match' and p.n_estado = 'auto_match') then 'linea'
           when p.a_estado = 'solicitud_pendiente'
                and coalesce(p.solicitud_id, p.solicitud_mano_obra_id, p.solicitud_equipo_id) is not null then 'solicitud'
           when p.a_estado = 'rechazado' then 'rechazo'
         end as accion
    from _pares p;
  delete from _toma where accion is null;

  -- Las líneas que el import puso en la versión nueva para esas parejas se
  -- quitan (se reemplazan por lo decidido antes).
  update apu_import_revision r set item_apu_id = null from _toma t where r.id = t.n_id and t.n_ia is not null;
  delete from item_apu ia using _toma t
   where ia.id = t.n_ia
     and not exists (select 1 from apu_import_revision r where r.item_apu_id = ia.id);

  -- Resueltas: la misma línea con la cantidad nueva (una por APU nuevo y línea
  -- vieja: la mano de obra de varias líneas del Excel va en una sola).
  for c in
    select t.n_apu, t.a_ia, min(t.n_cant) as cant from _toma t where t.accion = 'linea' group by t.n_apu, t.a_ia
  loop
    insert into item_apu (apu_id, insumo_id, mano_obra_categoria_id, porcentaje_mano_obra, equipo_categoria_id,
                          transporte_precio_id, cantidad, rendimiento, tipo, precio_unitario_congelado, unidad,
                          factor_unidad, no_aplica, concepto_fijo, desperdicio_clave)
    select c.n_apu, x.insumo_id, x.mano_obra_categoria_id, x.porcentaje_mano_obra, x.equipo_categoria_id,
           x.transporte_precio_id,
           case when x.mano_obra_categoria_id is not null then x.cantidad else c.cant end,
           x.rendimiento, x.tipo, x.precio_unitario_congelado, x.unidad, x.factor_unidad, x.no_aplica, x.concepto_fijo,
           x.desperdicio_clave
      from item_apu x where x.id = c.a_ia
    returning id into v_ia;
    update apu_import_revision r
       set estado = 'resuelto', item_apu_id = v_ia,
           insumo_id_asignado = t.insumo_id_asignado,
           mano_obra_categoria_id_asignado = t.mano_obra_categoria_id_asignado,
           equipo_categoria_id_asignado = t.equipo_categoria_id_asignado
      from _toma t
     where r.id = t.n_id and t.accion = 'linea' and t.n_apu = c.n_apu and t.a_ia = c.a_ia;
  end loop;
  select count(*) into v_resueltas from _toma where accion = 'linea';

  -- Esperando aprobación: la misma solicitud, ahora de la versión nueva.
  update apu_import_revision r
     set estado = 'solicitud_pendiente', solicitud_id = t.solicitud_id,
         solicitud_mano_obra_id = t.solicitud_mano_obra_id, solicitud_equipo_id = t.solicitud_equipo_id
    from _toma t
   where r.id = t.n_id and t.accion = 'solicitud';
  update apu_import_revision r
     set solicitud_id = null, solicitud_mano_obra_id = null, solicitud_equipo_id = null
    from _toma t
   where r.id = t.a_id and t.accion = 'solicitud';
  select count(*) into v_solicitudes from _toma where accion = 'solicitud';

  -- Rechazadas: siguen rechazadas, con su motivo.
  update apu_import_revision r
     set estado = 'rechazado', motivo_rechazo = t.motivo_rechazo
    from _toma t
   where r.id = t.n_id and t.accion = 'rechazo';
  select count(*) into v_rechazadas from _toma where accion = 'rechazo';

  select count(*) into v_nuevas
    from apu_import_revision r join presupuesto_items pi on pi.id = r.presupuesto_item_id
   where pi.version_id = v_nueva and r.dividida_de is null and not r.agregada_por_modalidad
     and not exists (select 1 from _pares p where p.n_id = r.id);
  select count(*) into v_quitadas
    from apu_import_revision r join presupuesto_items pi on pi.id = r.presupuesto_item_id
   where pi.version_id = v_anterior and r.dividida_de is null and not r.agregada_por_modalidad
     and not exists (select 1 from _pares p where p.a_id = r.id);

  -- Desperdicio y valores de la versión nueva.
  select array_agg(distinct pi.apu_id) into v_apus
    from presupuesto_items pi where pi.version_id = v_nueva and pi.apu_id is not null;
  if v_apus is not null then
    perform public._aplicar_desperdicio_apus(v_apus);
    perform public.recalcular_valor_apus(v_apus);
  end if;

  -- Modalidades de la versión anterior (si tenía).
  select jsonb_agg(jsonb_build_object('codigo', a.codigo, 'modalidad', a.modalidad,
                                      'mano_obra_oficial', a.mano_obra_oficial,
                                      'herramienta_menor_pct', a.herramienta_menor_pct))
    into v_filas
    from presupuesto_items a
   where a.version_id = v_anterior and a.modalidad is not null
     and exists (select 1 from presupuesto_items n where n.version_id = v_nueva and n.codigo = a.codigo);
  if v_filas is not null then
    v_modalidades := public.fijar_modalidades_presupuesto(v_nueva, v_filas, true);
  end if;

  update presupuesto_versiones set decisiones_reutilizadas_at = now() where id = v_nueva;
  perform public._anotar_historial('presupuesto', p_presupuesto_id, 'decisiones_reutilizadas',
    jsonb_build_object('version_id', v_nueva, 'version_anterior_id', v_anterior, 'resueltas', v_resueltas,
                       'solicitudes', v_solicitudes, 'rechazadas', v_rechazadas, 'nuevas', v_nuevas,
                       'quitadas', v_quitadas,
                       'modalidades', coalesce(jsonb_array_length(v_filas), 0)));

  return jsonb_build_object('resueltas', v_resueltas, 'solicitudes', v_solicitudes, 'rechazadas', v_rechazadas,
                            'nuevas', v_nuevas, 'quitadas', v_quitadas,
                            'modalidades', coalesce(jsonb_array_length(v_filas), 0),
                            'errores_modalidades', coalesce(v_modalidades->'errores', '[]'::jsonb));
end;
$function$;

revoke execute on function public.reutilizar_decisiones_version(uuid) from public;
grant execute on function public.reutilizar_decisiones_version(uuid) to authenticated;

commit;
