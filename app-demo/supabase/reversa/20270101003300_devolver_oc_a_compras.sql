-- Reversa de 20270101003300_devolver_oc_a_compras.sql. Las columnas devuelta_compras_* y el
-- tipo de aviso se dejan (las órdenes ya devueltas conservan su registro).

begin;

drop trigger if exists trg_oc_quitar_devuelta on public.pagos;
drop function if exists public._oc_quitar_devuelta();
drop function if exists public.devolver_orden_a_compras(uuid, text);
update public.ajustes_correo set tipos = array_remove(tipos, 'orden_compra_devuelta') where id;

commit;
