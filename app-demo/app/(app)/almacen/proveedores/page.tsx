import { obtenerPermisosRol } from "@/lib/permisos"
import { ProveedoresView } from "@/components/proveedores-view"

// El acceso a la ruta lo controla la pestaña almacen.proveedores (middleware).
// Crear y editar exigen además la acción 'editar_proveedores' (o ser
// Administrador), igual que las políticas proveedores_update/insert.
export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<{ revisar?: string }> }) {
  const permisos = await obtenerPermisosRol()
  const puedeEditar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("editar_proveedores"))
  // Marcar como revisado un proveedor cuyo tercero cambió (20270101006100).
  const puedeRevisar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("revisar_proveedores"))

  // ?revisar=<id> (Mis pendientes): se lee aquí y no en el navegador, porque al llegar
  // navegando la página se dibuja antes de que cambie la dirección.
  const { revisar } = await searchParams

  return <ProveedoresView puedeEditar={puedeEditar} puedeRevisar={puedeRevisar} revisar={revisar ?? null} />
}
