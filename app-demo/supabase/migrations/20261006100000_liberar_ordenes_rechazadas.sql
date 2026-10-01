-- Las líneas de órdenes de compra RECHAZADAS ya no cuentan como "ya comprado".
--
-- Problema (reportado): si una orden de compra era rechazada, la cantidad de
-- la requisición seguía contando como comprada y no se podía volver a comprar.
-- Ej. requisición de 12 con 6 en una orden rechazada: disponible 0 (debía ser 6).
-- Una orden rechazada no puede volver a activarse (aprobar_orden_compra solo
-- actúa sobre pendiente_aprobacion; desaprobar solo sobre aprobada), así que
-- liberarla no permite comprar dos veces lo mismo.
--
-- Mismo criterio en todos los lugares que calculan "ya comprado":
--   oc.estado NOT IN ('cancelada', 'rechazada')
-- (en el código: mapPedidoParaComprar en comprar-pedidos/actions.ts).

-- ---- 1 y 2. crear_orden_compra y desaprobar_pedido --------------------------
-- Se cambia SOLO esa condición sobre la definición que está hoy en la base
-- (aplicada fuera del registro de migraciones), sin reescribir el resto de la
-- función. Falla si no encuentra el texto, para no aplicar a ciegas.
do $$
declare
  v_func text;
  v_def text;
  v_nueva text;
begin
  foreach v_func in array array[
    'public.crear_orden_compra(uuid,uuid,text,date,text,text,text,text,text,text,jsonb)',
    'public.desaprobar_pedido(uuid,text)'
  ]
  loop
    v_def := pg_get_functiondef(v_func::regprocedure);
    v_nueva := replace(v_def, 'oc.estado <> ''cancelada''', 'oc.estado not in (''cancelada'', ''rechazada'')');
    if v_nueva = v_def then
      raise exception 'No se encontró la condición a cambiar en %', v_func;
    end if;
    execute v_nueva;
  end loop;
end;
$$;

-- ---- 3. cancelar_pedido -----------------------------------------------------
-- La versión que había en la base solo dejaba cancelar a quien hizo la
-- requisición y solo si estaba pendiente; el botón "Cancelar" de Aprobación
-- de requisiciones (acción cancelar_pedidos) fallaba siempre. Se restaura la
-- versión de 20261003000000_historial_y_pedidos.sql, con el mismo criterio de
-- órdenes rechazadas y los textos en "requisición".
create or replace function public.cancelar_pedido(p_pedido_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_puede boolean := public.tiene_accion(auth.uid(), 'cancelar_pedidos');
begin
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo de cancelación es obligatorio.';
  end if;

  select id, estado, solicitado_por into v from pedidos_insumos where id = p_pedido_id for update;
  if not found then
    raise exception 'La requisición no existe.';
  end if;

  if v.estado = 'pendiente' then
    if not (v.solicitado_por = auth.uid() or v_puede) then
      raise exception 'Solo quien hizo la requisición, o quien tenga permiso de cancelar requisiciones, puede cancelarla.';
    end if;
  elsif v.estado = 'aprobado' then
    if not v_puede then
      raise exception 'No tienes permiso para cancelar una requisición ya aprobada.';
    end if;
    if exists (
      select 1
      from ordenes_compra_items oci
      join ordenes_compra oc on oc.id = oci.orden_compra_id
      where oci.pedido_insumo_id = p_pedido_id and oc.estado not in ('cancelada', 'rechazada')
    ) then
      raise exception 'La requisición ya está en una orden de compra vigente. Cancela primero la orden.';
    end if;
  else
    raise exception 'Solo se puede cancelar una requisición pendiente o aprobada.';
  end if;

  update pedidos_insumos
     set estado = 'cancelado', cancelado_por = auth.uid(), cancelado_at = now(),
         motivo_cancelacion = trim(p_motivo)
   where id = p_pedido_id;
end;
$$;

revoke all on function public.cancelar_pedido(uuid, text) from public, anon;
grant execute on function public.cancelar_pedido(uuid, text) to authenticated;
