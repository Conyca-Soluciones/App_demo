-- Acción nueva del rol: editar_proveedores.
--
-- Crear proveedores y corregir sus datos (en /almacen/proveedores y desde la
-- tarjeta del proveedor en Generar orden de compra). Antes cualquiera con la
-- acción `comprar` podía editar proveedores; ahora es un permiso aparte que se
-- asigna en Roles y permisos. El Administrador siempre lo tiene (tiene_accion).
--
-- Usuarios sin rol (banderas anteriores): tiene_accion ya resuelve cualquier
-- acción que no está en su lista como "solo es_admin", así que no hace falta
-- tocar esa función.
--
-- Leer proveedores sigue igual (proveedores_select: compras o admin).

drop policy if exists proveedores_update on public.proveedores;
create policy proveedores_update on public.proveedores
  for update to authenticated
  using (public.tiene_accion((select auth.uid()), 'editar_proveedores'))
  with check (public.tiene_accion((select auth.uid()), 'editar_proveedores'));

drop policy if exists proveedores_insert on public.proveedores;
create policy proveedores_insert on public.proveedores
  for insert to authenticated
  with check (public.tiene_accion((select auth.uid()), 'editar_proveedores'));

-- Por defecto se le da a Líder Compras (se puede quitar o dar a otros roles
-- en Roles y permisos).
insert into public.rol_permisos (rol_id, permiso)
select r.id, 'accion.editar_proveedores'
from public.roles r
where r.clave = 'lider_compras'
  and not exists (
    select 1 from public.rol_permisos rp
    where rp.rol_id = r.id and rp.permiso = 'accion.editar_proveedores'
  );
