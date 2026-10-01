-- Al unir spr con lcpr quedaron dos juegos de triggers que notifican el mismo
-- rechazo: los viejos (aplicados a mano, sin migración) y
-- trg_notificar_resolucion_pedido / trg_notificar_resolucion_oc
-- (20261007000000), que ya cubren los mismos casos con el motivo incluido.
-- Como los mensajes son distintos, notificar_una no los detecta como
-- duplicados y cada rechazo llegaba dos veces a la campanita. Se quitan los
-- viejos.
--
--   trg_notificar_pedido_rechazado          -> rechazo de Compras
--   trg_notificar_pedido_rechazado_tecnico  -> rechazo de subgerencia técnica
--   trg_notificar_orden_compra_rechazada    -> orden de compra rechazada

drop trigger if exists trg_notificar_pedido_rechazado on public.pedidos_insumos;
drop trigger if exists trg_notificar_pedido_rechazado_tecnico on public.pedidos_insumos;
drop trigger if exists trg_notificar_orden_compra_rechazada on public.ordenes_compra;

drop function if exists public.notificar_pedido_rechazado();
drop function if exists public.notificar_pedido_rechazado_tecnico();
drop function if exists public.notificar_orden_compra_rechazada();
