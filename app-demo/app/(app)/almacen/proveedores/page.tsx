import { obtenerPermisosRol } from "@/lib/permisos"
import { ProveedoresView } from "@/components/proveedores-view"

// El acceso a la ruta lo controla la pestaña almacen.proveedores (middleware).
// Editar exige además la acción 'comprar' (o ser Administrador), igual que la
// política proveedores_update de la base.
export default async function ProveedoresPage() {
  const permisos = await obtenerPermisosRol()
  const puedeEditar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("comprar"))

  return <ProveedoresView puedeEditar={puedeEditar} />
}
