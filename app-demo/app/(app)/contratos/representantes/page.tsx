import { MarcoPagina } from "@/components/encabezado-pagina"
import { RepresentantesLegalesView } from "@/components/representantes-legales-view"
import { obtenerPermisosRol } from "@/lib/permisos"

// Acceso a la ruta: pestaña contratos.representantes (middleware). Poner la
// firma: acción aprobar_minutas (la base lo vuelve a revisar). Los
// representantes se registran en Admin › Empresas.
export default async function RepresentantesPage() {
  const permisos = await obtenerPermisosRol()
  const puedeEditar = Boolean(permisos?.esAdministrador || permisos?.acciones?.includes("aprobar_minutas"))
  return (
    <MarcoPagina
      titulo="Firmas de representantes"
      subtitulo="La firma del representante legal y del suplente de cada empresa. Se pone en el contrato cuando Subgerencia aprueba la minuta."
      scroll
    >
      <RepresentantesLegalesView puedeEditar={puedeEditar} />
    </MarcoPagina>
  )
}
