import { MarcoPagina } from "@/components/encabezado-pagina"
import { CuadrosSincoView } from "@/components/cuadros-sinco-view"
import { puedeCargarCuadrosSinco } from "./actions"

// Cuadros de pagos de SINCO (20270101002500). Ruta libre: Financiera (acción
// cargar_cuadros_sinco) carga y ve todos; las personas elegidas, los suyos (la base decide).
export default async function CuadrosSincoPage() {
  const puedeCargar = await puedeCargarCuadrosSinco()
  return (
    <MarcoPagina titulo="Cuadros de SINCO" subtitulo="Pagos aprobados en SINCO que se pagan desde 360, con sus soportes." scroll>
      <CuadrosSincoView puedeCargar={puedeCargar} />
    </MarcoPagina>
  )
}
