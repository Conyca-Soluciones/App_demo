-- Revisión de rendimiento (2026-11-09): la única llave foránea sin índice que
-- se usa en lecturas (contrato_polizas.proyecto_id: políticas y listados por
-- proyecto). Las otras sin índice apuntan a perfiles (quién lo hizo) y no se
-- filtran por ahí.
create index if not exists idx_contrato_polizas_proyecto on public.contrato_polizas (proyecto_id);
