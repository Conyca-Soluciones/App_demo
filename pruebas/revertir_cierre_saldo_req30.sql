-- Revierte el "Cerrar saldo" que Claude hizo por error sobre la requisición #30
-- (Estuario Casa, insumo 3913 AMARRE TEJA) el 2026-10-07 a las 10:19 (hora
-- Colombia), durante las pruebas. Deja la línea como estaba: comprada a medias
-- (12 pedidas, 10 compradas) y visible otra vez en Saldos pendientes.
-- Correr completo en el SQL Editor de Supabase.

begin;

update public.pedidos_insumos
   set saldo_cerrado_at      = null,
       saldo_cerrado_por     = null,
       rechazado_compras_at  = null,
       rechazado_compras_por = null,
       observaciones_compras = null
 where id = '4d2a4ef3-0639-4870-b23c-e29a6826c862'
   and saldo_cerrado_at = '2026-10-07 15:19:32.275843+00';

-- La notificación "Saldo de requisición cerrado" que le llegó al ingeniero.
delete from public.notificaciones
 where id = 'aac88c0c-081e-4b66-99fe-31604dafb11c';

-- El evento del historial ("rechazado_por_compras"). El historial es
-- inmutable a propósito; se borra solo porque este evento fue un error de prueba.
delete from public.historial_eventos
 where id = 'a2943a98-cdee-42af-9227-c15f972d8239';

-- Debe devolver 1 fila con saldo_cerrado_at y rechazado_compras_at en null.
select id, cantidad, saldo_cerrado_at, rechazado_compras_at
  from public.pedidos_insumos
 where id = '4d2a4ef3-0639-4870-b23c-e29a6826c862';

commit;
