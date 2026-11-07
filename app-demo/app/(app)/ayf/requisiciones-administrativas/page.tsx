import { MarcoPagina } from "@/components/encabezado-pagina"
import { RequisicionesAdministrativasPagina } from "@/components/requisiciones-administrativas-pagina"

// Ruta libre (no es de ninguna pestaña de la matriz): las requisiciones
// administrativas de FUNCIONAMIENTO las hace cualquier usuario con sesión
// (20261231900000). ?ver=<id> abre una.
export default async function RequisicionesAdministrativasPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams
  return (
    <MarcoPagina titulo="Requisiciones administrativas" subtitulo="Lo que compra Compras para la empresa (FUNCIONAMIENTO), sin presupuesto ni aprobación">
      <RequisicionesAdministrativasPagina verInicial={ver ?? null} />
    </MarcoPagina>
  )
}
