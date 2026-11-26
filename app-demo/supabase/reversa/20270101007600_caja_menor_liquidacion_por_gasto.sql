-- Reversa de 20270101007600: el pago de caja menor vuelve a liquidarse directo (un
-- solo valor). Se pierde la liquidación guardada en cada gasto.
begin;
do $$
declare
  v text;
begin
  v := pg_get_functiondef('public.liquidar_pagos_lote(jsonb)'::regprocedure);
  execute replace(v,
       E'          if public._legalizacion_de_pago(v) is not null\n'
    || E'             and coalesce(current_setting(''app.liquidando_caja_menor'', true), '''') <> ''on'' then\n'
    || E'            raise exception ''Es el reembolso de una caja menor: se liquida gasto por gasto (botón «Liquidar gastos» en la ventana del pago).'';\n'
    || E'          end if;\n', '');
end;
$$;
drop function if exists public.liquidar_gastos_caja_menor(uuid, jsonb);
drop function if exists public._legalizacion_de_pago(public.pagos);
-- detalle_legalizacion_caja_menor: vuelve a correr su definición de 20270101007400 si hace falta
-- (la de 007600 solo agrega 'liquidacion' a cada gasto y 'pago'; la app vieja los ignora).
alter table public.caja_menor_gastos
  drop column if exists liq_base, drop column if exists liq_iva, drop column if exists retefuente,
  drop column if exists reteiva, drop column if exists reteica, drop column if exists valor_a_pagar,
  drop column if exists liquidado_en, drop column if exists liquidado_por;
commit;
