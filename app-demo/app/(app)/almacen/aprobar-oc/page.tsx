import { AprobarOCView } from "@/components/aprobar-oc-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default function AprobarOCPage() {
  return (
    <MarcoPagina
      titulo="Aprobación de órdenes de compra"
      subtitulo="Órdenes de compra de todos los proyectos. Con “Solo por Aprobar” ves únicamente las que esperan aprobación."
    >
      <AprobarOCView />
    </MarcoPagina>
  )
}
