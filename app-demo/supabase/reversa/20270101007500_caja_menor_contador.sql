-- Reversa de 20270101007500: solo si no hay contadores de caja menor (si los hay, falla el CHECK).
begin;
alter table public.contadores_proyecto drop constraint if exists contadores_proyecto_tipo_check;
alter table public.contadores_proyecto add constraint contadores_proyecto_tipo_check
  check (tipo = any (array['contrato', 'oc', 'pago', 'pago_admin', 'requisicion']));
commit;
