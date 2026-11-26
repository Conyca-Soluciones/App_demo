import { MarcoPagina } from "@/components/encabezado-pagina"
import { RequisicionesAdminPagina } from "@/components/requisiciones-admin-pagina"

// Ruta libre (no es de ninguna pestaña de la matriz): los pagos
// administrativos (antes "requisiciones administrativas") los hace cualquier
// usuario con sesión. ?ver=<id> abre uno (aviso de la campanita o Mis pendientes).
// ?caja_menor=<id> abre una legalización de caja menor (o "nueva", el formulario).
export default async function PagosAdministrativosPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; caja_menor?: string }>
}) {
  const { ver, caja_menor } = await searchParams
  return (
    <MarcoPagina titulo="Pagos administrativos" subtitulo="Cuadro de pagos (GF-F-018) o caja menor; pasan a Gerencia, Aprobación de pagos">
      <RequisicionesAdminPagina verInicial={ver ?? null} cajaMenorInicial={caja_menor ?? null} />
    </MarcoPagina>
  )
}
