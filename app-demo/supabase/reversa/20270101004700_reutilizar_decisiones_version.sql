-- Reversa de 20270101004700_reutilizar_decisiones_version.sql.
-- Quita la función. Lo que ya se pasó a una versión nueva se queda (son datos:
-- líneas del APU y solicitudes colgadas de la versión nueva). La columna
-- presupuesto_versiones.decisiones_reutilizadas_at se deja.

begin;
drop function if exists public.reutilizar_decisiones_version(uuid);
commit;
