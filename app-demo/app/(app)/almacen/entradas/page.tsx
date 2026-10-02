import { EntradasView } from "@/components/entradas-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default function EntradasPage() {
  return (
    <MarcoPagina
      titulo="Entradas"
      subtitulo="Consulta las órdenes de compra aprobadas del proyecto y selecciona una para registrar el material recibido en bodega."
      conProyecto
    >
      <EntradasView />
    </MarcoPagina>
  )
}
