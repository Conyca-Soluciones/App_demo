-- "Nuevo proveedor" en /almacen/proveedores.
--
-- * INSERT con la misma regla que SELECT/UPDATE (compras o admin).
-- * UNIQUE en id_prov: el ID (PV0001...) lo genera crearProveedor como
--   "siguiente número"; si dos personas crean a la vez, el segundo INSERT
--   choca acá (23505) y la action reintenta con el número siguiente, en vez
--   de dejar dos proveedores con el mismo ID. Los 394 existentes ya eran
--   únicos al crear el índice (verificado antes de aplicar).

drop policy if exists proveedores_insert on public.proveedores;
create policy proveedores_insert on public.proveedores
  for insert
  with check (public.rol_compras(auth.uid()) or public.es_admin(auth.uid()));

create unique index if not exists proveedores_id_prov_key on public.proveedores (id_prov);
