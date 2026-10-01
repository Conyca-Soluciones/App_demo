import { obtenerPermisosRol } from "@/lib/permisos"
import { ProveedoresView } from "@/components/proveedores-view"

// El acceso a la ruta lo controla la pestaña almacen.proveedores (middleware).
// Crear y editar exigen además la acción 'editar_proveedores' (o ser
// Administrador), igual que las políticas proveedores_update/insert.
export default async function ProveedoresPage() {
  const permisos = await obtenerPermisosRol()
  const puedeEditar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("editar_proveedores"))

  return <ProveedoresView puedeEditar={puedeEditar} />
}
