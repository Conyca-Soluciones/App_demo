import { MarcoPagina } from "@/components/encabezado-pagina"
import { RequisicionesAdminPagina } from "@/components/requisiciones-admin-pagina"

// Ruta libre (no es de ninguna pestaña de la matriz): las requisiciones
// administrativas las hace cualquier usuario con sesión. ?ver=<id> abre una
// (aviso de la campanita o Mis pendientes).
export default async function RequisicionesAdministrativasPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams
  return (
    <MarcoPagina titulo="Requisiciones administrativas" subtitulo="Relación de pagos (GF-F-018): pasa directo a A&F, Aprobación de pagos">
      <RequisicionesAdminPagina verInicial={ver ?? null} />
    </MarcoPagina>
  )
}
