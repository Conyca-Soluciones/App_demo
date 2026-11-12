-- Las políticas de lectura de storage.objects se evalúan juntas para todos los
-- buckets: si una llama una función sin EXECUTE para authenticated, Postgres
-- puede ejecutarla aunque el archivo sea de otro bucket y la consulta falla
-- ("permission denied for function ..."). Pasó al firmar el enlace de una póliza
-- (Storage respondía 400; en pantalla "React error #441") y al borrar un RUT.
--   _puede_ver_rut -> terceros_rut_select (Paquete E, 20270101000300)
--   _ve_balances   -> balances_soportes_select (Balances, 20270101001200)
-- Las dos solo responden sí/no sobre permisos de un usuario, como tiene_accion
-- y tiene_pestana, que ya tienen el permiso. Son SECURITY DEFINER: lo que llaman
-- por dentro (p. ej. _puede_revisar_cuentas) sigue sin permiso para usuarios.
-- Regla: toda función que use una política RLS necesita EXECUTE para authenticated.

grant execute on function public._puede_ver_rut(uuid) to authenticated;
grant execute on function public._ve_balances(uuid) to authenticated;
