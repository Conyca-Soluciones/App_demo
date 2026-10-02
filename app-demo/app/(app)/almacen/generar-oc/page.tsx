import { GenerarOCView } from "@/components/generar-oc-view"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { obtenerPermisosRol } from "@/lib/permisos"

export default async function GenerarOCPage() {
  // Editar los datos del proveedor desde la tarjeta: acción
  // `editar_proveedores` o Administrador (la base lo vuelve a exigir con RLS).
  const permisos = await obtenerPermisosRol()
  const puedeEditarProveedor = Boolean(
    permisos?.esAdministrador || permisos?.acciones.includes("editar_proveedores")
  )

  return (
    <MarcoPagina titulo="Generar orden de compra">
      <GenerarOCView puedeEditarProveedor={puedeEditarProveedor} />
    </MarcoPagina>
  )
}
