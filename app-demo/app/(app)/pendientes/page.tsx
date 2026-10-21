import { MarcoPagina } from "@/components/encabezado-pagina"
import { MisPendientesView } from "@/components/mis-pendientes-view"

export default function PendientesPage() {
  return (
    <MarcoPagina
      titulo="Mis pendientes"
      subtitulo="Lo que te toca hacer, de todos tus proyectos: cuánto lleva esperando y de quién viene."
      scroll
    >
      <MisPendientesView />
    </MarcoPagina>
  )
}
