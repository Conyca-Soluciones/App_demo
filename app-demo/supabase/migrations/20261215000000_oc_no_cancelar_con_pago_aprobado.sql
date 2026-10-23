-- Una OC no se puede cancelar después de que A&F aprobó su pago (decisión del
-- usuario, 2026-10-23). Caso real: la OC 54 se aprobó en Aprobación de pagos
-- (ITEM 7 del consolidado), se canceló, su pago quedó anulado pero con su ITEM
-- (un ITEM nunca se reutiliza), y al volver a crear la misma orden (OC 55,
-- ITEM 8) el consolidado mostraba dos pagos de la misma compra.
-- Desde 20261204000000 una OC solo queda aprobada cuando se aprueba su pago, así
-- que en la práctica una OC aprobada ya no se cancela. Retirar una pendiente
-- (pago todavía por aprobar, sin ITEM) sigue igual.
-- Cuenta como aprobado: aprobado, liquidado, en dispersión o dispersado.

create or replace function public._cancelar_orden_compra_sin_proyecto(p_orden_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o record;
  v_puede boolean := public.tiene_accion(auth.uid(), 'cancelar_oc');
begin
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;

  select estado, estado_entrega, created_by into v_o
    from ordenes_compra where id = p_orden_id for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;

  if v_o.estado = 'pendiente_aprobacion' then
    if not (v_puede or v_o.created_by = auth.uid()) then
      raise exception 'Solo quien creó la orden, o quien tenga permiso de cancelar órdenes, puede retirarla.';
    end if;
  elsif v_o.estado = 'aprobada' then
    if not v_puede then
      raise exception 'No autorizado -- no tienes permiso para cancelar órdenes de compra.';
    end if;
    if exists (
      select 1 from pagos
       where orden_compra_id = p_orden_id
         and estado in ('aprobado', 'liquidado', 'en_dispersion', 'dispersado')
    ) then
      raise exception 'No se puede cancelar: el pago de la orden ya fue aprobado en Aprobación de pagos.';
    end if;
    if v_o.estado_entrega <> 'sin_entregar' then
      raise exception 'No se puede cancelar: la orden ya tiene material recibido (entrega parcial o entregada).';
    end if;
    if exists (
      select 1 from entradas_almacen e
      where e.orden_compra_id = p_orden_id and e.anulada_at is null
    ) then
      raise exception 'No se puede cancelar: la orden tiene entradas de almacén registradas. Anúlalas primero.';
    end if;
  else
    raise exception 'Solo se puede cancelar una orden pendiente de aprobación o aprobada.';
  end if;

  update ordenes_compra
     set estado = 'cancelada',
         cancelada_por = auth.uid(),
         cancelada_at = now(),
         motivo_cancelacion = trim(p_motivo)
   where id = p_orden_id;
end;
$$;

-- Interna: solo la llama el envoltorio cancelar_orden_compra (revisa el proyecto).
revoke execute on function public._cancelar_orden_compra_sin_proyecto(uuid, text) from public, anon, authenticated;
