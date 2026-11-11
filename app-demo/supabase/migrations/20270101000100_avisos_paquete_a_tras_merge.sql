-- Ajuste al unir el Paquete A (20261231999400) con la rama de insumos
-- (20261231999900, que rehace la lista de tipos de aviso sin los del Paquete A).
-- Se puede correr más de una vez; no cambia datos.
--
-- 1. La lista completa de tipos de aviso (las dos ramas). En la base en vivo ya
--    está así; esto es para que, corriendo las migraciones en orden, no se
--    pierdan los del Paquete A.
-- 2. Aviso de insumo aprobado: "Ya puedes hacer la requisición" solo cuando se
--    pidió sin ítem (requisición administrativa). Si vino del presupuesto, el
--    texto no lo dice: puede que falte la conversión (insumo_por_convertir avisa aparte).

begin;

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo = any (array[
  'acta_por_facturar', 'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
  'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar', 'contrato_aprobado',
  'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada', 'minuta_por_revisar',
  'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido', 'contrato_vencido_juridica', 'insumo_rechazado',
  'otrosi_por_revisar', 'otrosi_por_aprobar', 'otrosi_devuelto', 'otrosi_rechazado', 'otrosi_aprobado',
  'otrosi_devuelto_subgerencia', 'poliza_pendiente', 'poliza_por_revisar', 'poliza_aprobada', 'poliza_devuelta',
  'requisicion_admin_aprobada', 'requisicion_admin_rechazada', 'requisicion_extraordinaria',
  'requisicion_administrativa', 'insumo_por_convertir',
  'requisicion_administrativa_por_aprobar', 'requisicion_administrativa_aprobada',
  'requisicion_administrativa_rechazada', 'insumo_aprobado'
])) not valid;

create or replace function public._notificar_insumo_aprobado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_presupuesto uuid;
  v_codigo text;
  v_proyecto text;
begin
  if not (old.estado = 'pendiente' and new.estado = 'aprobado') then
    return new;
  end if;
  if new.solicitado_por is null or new.solicitado_por = new.resuelto_por then
    return new;
  end if;

  select pi.presupuesto_id, pi.codigo, py.nombre
    into v_presupuesto, v_codigo, v_proyecto
  from presupuesto_items pi
  join presupuestos p on p.id = pi.presupuesto_id
  left join proyectos py on py.id = p.proyecto_id
  where pi.id = coalesce(
    new.presupuesto_item_id,
    (select r.presupuesto_item_id from apu_import_revision r where r.solicitud_id = new.id limit 1)
  );

  perform public.notificar_una(
    new.solicitado_por,
    'insumo_aprobado',
    case when v_presupuesto is null then 'pedido_insumo' else 'presupuesto' end,
    coalesce(v_presupuesto, new.id),
    'Insumo nuevo aprobado',
    '"' || new.descripcion || '"'
      || coalesce(' (ítem ' || v_codigo || coalesce(' de ' || v_proyecto, '') || ')', '')
      || ' fue aprobado'
      || coalesce(' con el código ' || new.codigo_maestro_asignado::text, '')
      || case when v_presupuesto is null then '. Ya puedes hacer la requisición.' else '. Ya está en el maestro de insumos.' end
  );
  return new;
end;
$$;
revoke all on function public._notificar_insumo_aprobado() from public, anon, authenticated;

commit;
