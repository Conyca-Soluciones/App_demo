-- Retirar una orden de compra PENDIENTE de aprobación.
--
-- Antes cancelar_orden_compra solo aceptaba órdenes APROBADAS (con la acción
-- cancelar_oc). Si quien creó la orden se equivocaba, tenía que esperar a que
-- un aprobador la rechazara. Ahora una orden pendiente la puede cancelar
-- quien la creó o quien tenga cancelar_oc, con motivo obligatorio. Sus
-- cantidades vuelven a la cola de Compras (las líneas de órdenes canceladas
-- no cuentan como compradas, ver 20261006100000). Las reglas de órdenes
-- aprobadas no cambian.

create or replace function public.cancelar_orden_compra(p_orden_id uuid, p_motivo text)
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

revoke all on function public.cancelar_orden_compra(uuid, text) from public, anon;
grant execute on function public.cancelar_orden_compra(uuid, text) to authenticated;
