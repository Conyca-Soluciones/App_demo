-- Reversa de 20270101007700: la relación de caja menor vuelve a salir sin firmas.
begin;
drop function if exists public.firmas_caja_menor(uuid);
commit;
