import { MarcoPagina } from "@/components/encabezado-pagina"
import { RepresentantesLegalesView } from "@/components/representantes-legales-view"
import { obtenerPermisosRol } from "@/lib/permisos"

// Acceso a la ruta: pestaña contratos.representantes (middleware). Registrar y
// cambiar: acción aprobar_minutas (la base lo vuelve a revisar).
export default async function RepresentantesPage() {
  const permisos = await obtenerPermisosRol()
  const puedeEditar = Boolean(permisos?.esAdministrador || permisos?.acciones?.includes("aprobar_minutas"))
  return (
    <MarcoPagina
      titulo="Representantes legales"
      subtitulo="Principal y suplentes de cada empresa. Su firma se pone en el contrato cuando Subgerencia aprueba la minuta."
      scroll
    >
      <RepresentantesLegalesView puedeEditar={puedeEditar} />
    </MarcoPagina>
  )
}
