-- Reversa de 20270101003400_sinco_exige_rut.sql: quita el disparador. Los parches de
-- _pago_novedad y enviar_pagos_a_liquidar se quitan a mano (quitar las líneas del RUT); la
-- función de detalle puede quedar (sin_rut solo informa).

begin;

drop trigger if exists trg_tercero_rut_novedad_sinco on public.terceros;
drop function if exists public._tercero_rut_novedad_sinco();

commit;
