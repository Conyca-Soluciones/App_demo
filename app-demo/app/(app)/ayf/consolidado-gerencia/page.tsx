import { MarcoPagina } from "@/components/encabezado-pagina"
import { ConsolidadoGerenciaView } from "@/components/consolidado-gerencia-view"

// Pestaña ayf.consolidado_gerencia (middleware y RLS): los pagos de los tres
// consolidados, para control de Gerencia. Solo consulta.
export default function ConsolidadoGerenciaPage() {
  return (
    <MarcoPagina titulo="Consolidado Gerencia" subtitulo="Los pagos de todos los consolidados, con su soporte">
      <ConsolidadoGerenciaView />
    </MarcoPagina>
  )
}
