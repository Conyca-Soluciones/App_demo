-- Reversa de 20270101004900_solicitud_insumo_origen_proyecto.sql: quita las
-- columnas origen y proyecto_id de solicitudes_insumos (el código que las lee
-- tiene que salir antes).

begin;
set local lock_timeout = '10s';
drop index if exists public.solicitudes_insumos_proyecto_id_idx;
alter table public.solicitudes_insumos drop constraint if exists solicitudes_insumos_origen_check;
alter table public.solicitudes_insumos drop column if exists proyecto_id, drop column if exists origen;
commit;
