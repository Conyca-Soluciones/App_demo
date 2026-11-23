-- Reversa de 20270101005900: quita eliminar_soporte_orden (los soportes no cambian).
begin;
drop function if exists public.eliminar_soporte_orden(uuid);
commit;
