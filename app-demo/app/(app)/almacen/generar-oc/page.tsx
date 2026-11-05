import { GenerarOCView } from "@/components/generar-oc-view"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { obtenerPermisosRol } from "@/lib/permisos"

// ?modificar=<id>: la misma pantalla, llena con esa orden (20261231400000).
export default async function GenerarOCPage({
  searchParams,
}: {
  searchParams: Promise<{ modificar?: string }>
}) {
  const { modificar } = await searchParams
  const ordenId = modificar && /^[0-9a-f-]{36}$/i.test(modificar) ? modificar : undefined
  // Editar los datos del proveedor desde la tarjeta: acción
  // `editar_proveedores` o Administrador (la base lo vuelve a exigir con RLS).
  const permisos = await obtenerPermisosRol()
  const puedeEditarProveedor = Boolean(
    permisos?.esAdministrador || permisos?.acciones.includes("editar_proveedores")
  )

  return (
    <MarcoPagina titulo={ordenId ? "Modificar orden de compra" : "Generar orden de compra"}>
      <GenerarOCView key={ordenId ?? "nueva"} puedeEditarProveedor={puedeEditarProveedor} ordenId={ordenId} />
    </MarcoPagina>
  )
}
