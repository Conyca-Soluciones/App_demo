-- Insumo nuevo aprobado en una unidad de compra distinta a la del
-- presupuesto (decisión del usuario, 2026-11-11). Ejemplo: el presupuesto
-- pide "Tela verde" en m y se aprueba "TELA VERDE ... ROLLO X 100 M" por
-- rollo. El maestro queda en lo que se compra; la conversión (1 rollo =
-- 100 m) la confirma el ingeniero en SU presupuesto.
--
-- Al aprobar, aprobarSolicitudInsumo llama devolver_lineas_para_conversion
-- con las líneas que no están en esa unidad ANTES de pasar la solicitud a
-- aprobada: se sueltan de la solicitud (el disparador ya no las mete al APU
-- con la cantidad en otra unidad) y vuelven a "pendiente" con el insumo
-- nuevo como único candidato y la marca convertir_insumo_id. En Revisar
-- pendientes salen en "Falta conversión" (amarillo); al guardar con la
-- conversión quedan resueltas y la marca deja de importar.
--
-- Avisos: campanita a quien pidió el insumo (insumo_por_convertir) y Mis
-- pendientes (insumo_por_convertir) a quien puede editar ese presupuesto.

alter table public.apu_import_revision
  add column if not exists convertir_insumo_id uuid references public.maestro_insumos(id) on delete set null;

create index if not exists apu_import_revision_convertir_idx
  on public.apu_import_revision (convertir_insumo_id)
  where convertir_insumo_id is not null and estado = 'pendiente';

-- Tipo de aviso nuevo (misma lista de antes + insumo_por_convertir).
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo = any (array[
  'acta_por_facturar', 'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
  'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar', 'contrato_aprobado',
  'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada', 'minuta_por_revisar',
  'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido', 'contrato_vencido_juridica', 'insumo_rechazado',
  'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado',
  'otrosi_devuelto_subgerencia', 'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta',
  'requisicion_admin_aprobada', 'requisicion_admin_rechazada', 'requisicion_extraordinaria',
  'requisicion_administrativa', 'insumo_por_convertir'
]::text[])) not valid;

create or replace function public.devolver_lineas_para_conversion(
  p_solicitud uuid,
  p_insumo uuid,
  p_revision_ids uuid[]
)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_insumo record;
  v_solicitud record;
  v_candidato jsonb;
  v_n integer;
  v_presupuesto uuid;
  v_unidad_linea text;
begin
  if v_uid is null then
    raise exception 'Necesitas iniciar sesión.';
  end if;
  if not public.tiene_accion(v_uid, 'aprobar_insumos') then
    raise exception 'No tienes permiso para aprobar insumos.';
  end if;
  if p_revision_ids is null or cardinality(p_revision_ids) = 0 then
    return 0;
  end if;

  select * into v_insumo from public.maestro_insumos where id = p_insumo;
  if not found then
    raise exception 'No se encontró el insumo aprobado.';
  end if;
  select * into v_solicitud from public.solicitudes_insumos where id = p_solicitud;

  -- Mismo formato que los candidatos del import (la fila del maestro + similitud).
  v_candidato := to_jsonb(v_insumo) || jsonb_build_object('similitud', 1, 'medidaDistinta', false, 'unidadDistinta', true);

  update public.apu_import_revision r
  set solicitud_id = null,
      estado = 'pendiente',
      insumo_id_asignado = null,
      candidatos = jsonb_build_array(v_candidato),
      convertir_insumo_id = p_insumo
  where r.id = any(p_revision_ids)
    and r.solicitud_id = p_solicitud
    and r.item_apu_id is null;
  get diagnostics v_n = row_count;

  if v_n > 0 and v_solicitud.solicitado_por is not null then
    select pi.presupuesto_id, r.unidad into v_presupuesto, v_unidad_linea
    from public.apu_import_revision r
    join public.presupuesto_items pi on pi.id = r.presupuesto_item_id
    where r.id = any(p_revision_ids)
    limit 1;

    perform public.notificar_una(
      v_solicitud.solicitado_por,
      'insumo_por_convertir',
      'presupuesto',
      coalesce(v_presupuesto, p_solicitud),
      'Insumo aprobado: falta la conversión',
      '"' || v_insumo.descripcion || '" se aprobó por ' || lower(split_part(coalesce(v_insumo.u_m, 'unidad'), ' - ', 1))
        || '. Confirma cuántos ' || coalesce(nullif(v_unidad_linea, ''), 'unidades') || ' trae cada uno en Revisar pendientes ('
        || v_n || case when v_n = 1 then ' línea' else ' líneas' end || ').'
    );
  end if;

  return v_n;
end;
$function$;

revoke execute on function public.devolver_lineas_para_conversion(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.devolver_lineas_para_conversion(uuid, uuid, uuid[]) to authenticated;

-- Mis pendientes: una fila por presupuesto e insumo. Parche sobre la versión
-- VIVA de _pendientes_de (reemplazo de texto exacto; falla si no lo encuentra).
do $parche$
declare
  v_src text;
  v_def text;
  v_buscar text := $b$   where v_revisar_polizas and o.estado = 'por_revisar' and c.proyecto_id = any(v_proys);$b$;
  v_nuevo text := $n$   where v_revisar_polizas and o.estado = 'por_revisar' and c.proyecto_id = any(v_proys)

  -- ------------------------------------------------ Insumos aprobados en otra unidad: falta la conversión (20261231999900)
  union all
  select 'insumo_por_convertir', 'hacer', (array_agg(r.id order by r.id))[1], pr.proyecto_id,
         m.descripcion,
         'Se compra por ' || lower(split_part(coalesce(m.u_m, 'unidad'), ' - ', 1)) || ' · '
           || count(*) || case when count(*) = 1 then ' línea' else ' líneas' end || ' en ' || coalesce(min(r.unidad), '—'),
         null::numeric, m.created_at, null::uuid, null::date, '/presupuestos?revisar=1'
    from apu_import_revision r
    join maestro_insumos m on m.id = r.convertir_insumo_id
    join presupuesto_items pi on pi.id = r.presupuesto_item_id
    join presupuestos pr on pr.id = pi.presupuesto_id and pr.version_actual_id = pi.version_id
   where r.convertir_insumo_id is not null and r.estado = 'pendiente'
     and (select public.tiene_accion(p_uid, 'editar_presupuestos'))
     and pr.proyecto_id in (select public.proyectos_editables(p_uid))
   group by pr.id, pr.proyecto_id, m.id, m.descripcion, m.u_m, m.created_at;$n$;
begin
  select pg_get_functiondef(p.oid), p.prosrc into v_def, v_src
  from pg_proc p where p.proname = '_pendientes_de' and p.pronamespace = 'public'::regnamespace;
  if position(v_buscar in v_def) = 0 then
    raise exception '_pendientes_de cambió: no se encontró el texto a reemplazar';
  end if;
  execute replace(v_def, v_buscar, v_nuevo);
end
$parche$;
