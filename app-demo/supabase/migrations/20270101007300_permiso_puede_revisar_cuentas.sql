-- La política terceros_cuentas_select (20270101007200) llama a
-- _puede_revisar_cuentas, que no tenía EXECUTE para authenticated: abrir
-- Terceros fallaba con "permission denied for function _puede_revisar_cuentas"
-- (2026-11-26). Una función usada dentro de una política necesita el permiso
-- aunque empiece por "_" (la política se evalúa con los permisos de quien consulta).
grant execute on function public._puede_revisar_cuentas(uuid) to authenticated;
