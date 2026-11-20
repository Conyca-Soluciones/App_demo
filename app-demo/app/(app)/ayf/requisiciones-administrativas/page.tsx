import { MarcoPagina } from "@/components/encabezado-pagina"
import { RequisicionesAdministrativasPagina } from "@/components/requisiciones-administrativas-pagina"

// Ruta libre (no es de ninguna pestaña de la matriz): las requisiciones
// administrativas de FUNCIONAMIENTO las hace cualquier usuario con sesión
// (20261231900000). ?ver=<id> abre una; ?espera=1 abre Mis requisiciones
// (las que esperan insumos nuevos van arriba).
export default async function RequisicionesAdministrativasPage({ searchParams }: { searchParams: Promise<{ ver?: string; espera?: string }> }) {
  const { ver, espera } = await searchParams
  return (
    <MarcoPagina titulo="Requisiciones administrativas" subtitulo="Lo que compra Compras para la empresa (FUNCIONAMIENTO) o un proyecto, sin presupuesto. Las aprueba Subgerencia">
      <RequisicionesAdministrativasPagina verInicial={ver ?? null} enEspera={Boolean(espera)} />
    </MarcoPagina>
  )
}
