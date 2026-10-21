-- Quién puede leer proveedores, con el mínimo acceso (hallazgo E2 de la
-- revisión por roles, decisión del usuario 2026-10-20: "dar acceso a las tablas
-- únicamente a las personas que lo necesitan").
--
-- Antes: solo Compras (acción comprar) y Administrador. Registro y Aprobación
-- de órdenes de compra y Control del proyecto leen el proveedor directo de la
-- tabla, así que el Almacenista y Gerencia veían "(proveedor eliminado)", y al
-- filtrar el Registro por proveedor (join !inner) sus órdenes desaparecían.
--
-- Ahora, dos políticas de lectura (se suman):
--   1. proveedores_select: TODOS los proveedores para quien trabaja con ellos:
--      Comprar, Editar proveedores, la pestaña Proveedores o Administrador.
--   2. proveedores_select_de_ordenes: SOLO los proveedores de las órdenes de
--      compra que la persona ya puede ver (la subconsulta aplica la política de
--      ordenes_compra), y solo si tiene Registro de órdenes de compra,
--      Aprobación de órdenes de compra o Control del proyecto. Con eso el
--      Almacenista, el Director y Gerencia ven el proveedor de sus órdenes,
--      no la lista completa.
-- Entradas no la necesita: lee el proveedor con una función SECURITY DEFINER.
-- Crear y editar no cambian (editar_proveedores). informacion_bancaria (datos
-- bancarios del proveedor) NO se toca: sigue solo para Compras y Administrador.

-- Sin sesión no hay nada que leer (antes la política era "to public" y solo la
-- frenaba que auth.uid() fuera null).
revoke select on public.proveedores from anon;

drop policy if exists proveedores_select on public.proveedores;
create policy proveedores_select on public.proveedores
  for select to authenticated
  using (
    (select public.rol_compras((select auth.uid())))
    or (select public.es_admin((select auth.uid())))
    or (select public.tiene_accion((select auth.uid()), 'editar_proveedores'))
    or (select public.tiene_pestana((select auth.uid()), 'almacen.proveedores'))
  );

drop policy if exists proveedores_select_de_ordenes on public.proveedores;
create policy proveedores_select_de_ordenes on public.proveedores
  for select to authenticated
  using (
    (select public.tiene_pestana((select auth.uid()), 'compras.ordenes')
            or public.tiene_pestana((select auth.uid()), 'compras.aprobar_oc')
            or public.tiene_pestana((select auth.uid()), 'admin.visualizacion'))
    and unique_id in (select o.proveedor_id from public.ordenes_compra o)
  );
