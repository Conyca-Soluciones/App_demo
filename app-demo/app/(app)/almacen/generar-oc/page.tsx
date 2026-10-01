import { GenerarOCView } from "@/components/generar-oc-view"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { obtenerPermisosRol } from "@/lib/permisos"

export default async function GenerarOCPage() {
  // Editar los datos del proveedor desde la tarjeta: acción
  // `editar_proveedores` o Administrador (la base lo vuelve a exigir con RLS).
  const permisos = await obtenerPermisosRol()
  const puedeEditarProveedor = Boolean(
    permisos?.esAdministrador || permisos?.acciones.includes("editar_proveedores")
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <SidebarTrigger />
      <div className="min-h-0 flex-1">
        <GenerarOCView puedeEditarProveedor={puedeEditarProveedor} />
      </div>
    </div>
  )
}
