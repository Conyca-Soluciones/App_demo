import { TodasLasOrdenesView } from "@/components/todas-las-ordenes-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default function OrdenesCompraPage() {
  return (
    <MarcoPagina
      titulo="Órdenes de compra"
    >
      <TodasLasOrdenesView />
    </MarcoPagina>
  )
}
