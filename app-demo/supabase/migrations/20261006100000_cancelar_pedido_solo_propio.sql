-- Cancelar una requisición: solo quien la hizo, y solo mientras está pendiente.
-- Antes también podía cancelar quien tuviera la acción cancelar_pedidos (otras
-- personas, o requisiciones ya aprobadas); eso se quitó.
create or replace function public.cancelar_pedido(p_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;

  select id, estado, solicitado_por into v from pedidos_insumos where id = p_pedido_id for update;
  if not found then
    raise exception 'El pedido no existe.';
  end if;
  if v.solicitado_por is distinct from auth.uid() then
    raise exception 'Solo quien hizo la requisición puede cancelarla.';
  end if;
  if v.estado <> 'pendiente' then
    raise exception 'Solo se puede cancelar una requisición pendiente de aprobación.';
  end if;

  update pedidos_insumos
     set estado = 'cancelado', cancelado_por = auth.uid(), cancelado_at = now(),
         motivo_cancelacion = trim(p_motivo)
   where id = p_pedido_id;
end;
$$;
