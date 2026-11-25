import { MarcoPagina } from "@/components/encabezado-pagina"
import { InformesPagosView } from "@/components/informes-pagos-view"

// Pestaña ayf.informes (middleware). Qué dispersores se ven lo decide la base.
export default function InformesPagosPage() {
  return (
    <MarcoPagina titulo="Informes" subtitulo="Informes de pagos">
      <InformesPagosView />
    </MarcoPagina>
  )
}
