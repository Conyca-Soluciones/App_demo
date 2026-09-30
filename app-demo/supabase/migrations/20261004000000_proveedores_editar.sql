-- Página de Proveedores (/almacen/proveedores): edición en línea.
--
-- Hasta ahora proveedores solo tenía política de SELECT (rol_compras o
-- es_admin). Se agrega UPDATE con la MISMA regla -- quien puede ver la tabla
-- en Compras puede corregirla. rol_compras() ya resuelve la acción 'comprar'
-- del rol (o la bandera anterior si el usuario no tiene rol), ver
-- 20261001000000_roles_permisos.sql.
--
-- No se agrega INSERT ni DELETE: la página solo edita proveedores existentes.

drop policy if exists proveedores_update on public.proveedores;
create policy proveedores_update on public.proveedores
  for update
  using (public.rol_compras(auth.uid()) or public.es_admin(auth.uid()))
  with check (public.rol_compras(auth.uid()) or public.es_admin(auth.uid()));
