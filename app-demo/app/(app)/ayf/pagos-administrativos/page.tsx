import { MarcoPagina } from "@/components/encabezado-pagina"
import { RequisicionesAdminPagina } from "@/components/requisiciones-admin-pagina"

// Ruta libre (no es de ninguna pestaña de la matriz): los pagos
// administrativos (antes "requisiciones administrativas") los hace cualquier
// usuario con sesión. ?ver=<id> abre uno (aviso de la campanita o Mis pendientes).
export default async function PagosAdministrativosPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams
  return (
    <MarcoPagina titulo="Pagos administrativos" subtitulo="Relación de pagos (GF-F-018): cada ítem por transferencia o PSE; pasa directo a A&F, Aprobación de pagos">
      <RequisicionesAdminPagina verInicial={ver ?? null} />
    </MarcoPagina>
  )
}
