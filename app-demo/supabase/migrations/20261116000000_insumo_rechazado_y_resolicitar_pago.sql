-- Hallazgos de la prueba completa del 15-oct-2026 (decisiones del usuario).
--
-- 1. Insumo nuevo rechazado: avisa a quien lo pidió (campanita), con el
--    motivo. Antes la solicitud rechazada se borraba (borrar_solicitud_resuelta)
--    y nadie se enteraba. Lo hace un disparador sobre solicitudes_insumos, así
--    cubre el rechazo desde cualquier pantalla. No avisa si quien rechaza es
--    quien pidió.
-- 2. solicitudes_insumos.cantidad: cantidad por unidad del ítem con la que
--    entra la línea al APU al aprobar una solicitud hecha desde el editor de APU
--    (en el import la cantidad sale de la línea del Excel). Antes entraba con 1.
-- 3. resolicitar_pago: un pago de orden de compra rechazado en A&F se puede
--    volver a solicitar (acción aprobar_pagos o gestionar_pagos). Se crea un
--    pago NUEVO en "solicitado" con los mismos datos; el rechazado queda como
--    registro. Los pagos de actas no: se corrige el acta y se envía otra vez.
-- Se puede correr más de una vez.

-- ---------------------------------------------------------------- 2
alter table public.solicitudes_insumos add column if not exists cantidad numeric(18,4);
alter table public.solicitudes_insumos drop constraint if exists solicitudes_insumos_cantidad_check;
alter table public.solicitudes_insumos add constraint solicitudes_insumos_cantidad_check
  check (cantidad is null or cantidad > 0);

-- ---------------------------------------------------------------- 1
alter table public.notificaciones drop constraint if exists notificaciones_entidad_tipo_check;
alter table public.notificaciones add constraint notificaciones_entidad_tipo_check
  check (entidad_tipo = any (array['pedido_insumo', 'orden_compra', 'requisicion', 'contrato', 'acta', 'presupuesto']))
  not valid;
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo = any (array[
    'pedido_rechazado', 'pedido_aprobado', 'orden_compra_rechazada', 'orden_compra_aprobada',
    'insumo_sobre_presupuesto', 'orden_compra_precio_sobre_efectivo', 'contrato_por_revisar',
    'contrato_aprobado', 'contrato_devuelto', 'contrato_rechazado', 'acta_aprobada', 'acta_rechazada',
    'minuta_por_revisar', 'minuta_aprobada', 'minuta_devuelta', 'contrato_vencido',
    'contrato_vencido_juridica', 'insumo_rechazado']))
  not valid;

create or replace function public._notificar_insumo_rechazado()
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
  if not (old.estado = 'pendiente' and new.estado = 'rechazado') then
    return new;
  end if;
  if new.solicitado_por is null or new.solicitado_por = new.resuelto_por then
    return new;
  end if;

  -- El ítem: el de la solicitud o, si vino del import, el de su primera línea.
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
    'insumo_rechazado',
    'presupuesto',
    coalesce(v_presupuesto, new.id),
    'Insumo nuevo rechazado',
    '"' || new.descripcion || '"'
      || coalesce(' (ítem ' || v_codigo || coalesce(' de ' || v_proyecto, '') || ')', '')
      || ' fue rechazado.'
      || coalesce(' Motivo: ' || nullif(btrim(new.motivo_rechazo), ''), '')
  );
  return new;
end;
$$;
revoke all on function public._notificar_insumo_rechazado() from public, anon, authenticated;

drop trigger if exists trg_notificar_insumo_rechazado on public.solicitudes_insumos;
create trigger trg_notificar_insumo_rechazado
  after update of estado on public.solicitudes_insumos
  for each row execute function public._notificar_insumo_rechazado();

-- ---------------------------------------------------------------- 3
create or replace function public.resolicitar_pago(p_pago_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_id uuid;
begin
  if not (public.tiene_accion(auth.uid(), 'aprobar_pagos') or public.tiene_accion(auth.uid(), 'gestionar_pagos')) then
    raise exception 'No autorizado -- no tienes permiso para gestionar pagos.';
  end if;

  select p.*, oc.estado as oc_estado
    into v
  from pagos p
  left join ordenes_compra oc on oc.id = p.orden_compra_id
  where p.id = p_pago_id
  for update of p;
  if not found then
    raise exception 'El pago no existe.';
  end if;
  if v.estado <> 'rechazado' then
    raise exception 'Solo se vuelve a solicitar un pago rechazado.';
  end if;
  if v.fuente <> 'orden_compra' then
    raise exception 'El pago de un acta se vuelve a solicitar corrigiendo el acta y enviándola otra vez.';
  end if;
  if v.oc_estado is distinct from 'aprobada' then
    raise exception 'La orden de compra ya no está aprobada.';
  end if;
  if exists (
    select 1 from pagos
    where orden_compra_id = v.orden_compra_id and tipo = v.tipo and estado not in ('anulado', 'rechazado')
  ) then
    raise exception 'Esta orden ya tiene otro pago de este tipo en curso.';
  end if;

  insert into pagos (
    fuente, orden_compra_id, tipo, proyecto_id, empresa_id, consolidado_id,
    tercero_id, cuenta_tercero_id, concepto, valor, numero_factura, estado, solicitado_en
  ) values (
    'orden_compra', v.orden_compra_id, v.tipo, v.proyecto_id, v.empresa_id, v.consolidado_id,
    v.tercero_id, v.cuenta_tercero_id, v.concepto, v.valor, v.numero_factura, 'solicitado', now()
  )
  returning id into v_id;

  perform public._pago_actualizar_novedad(v_id);
  return v_id;
end;
$$;
revoke all on function public.resolicitar_pago(uuid) from public, anon;
grant execute on function public.resolicitar_pago(uuid) to authenticated;
