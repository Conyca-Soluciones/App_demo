import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { BalancesView } from "@/components/balances-view"
import { ACCION_REGISTRAR_MOVIMIENTOS } from "@/lib/balances"

// Pestaña ayf.balances (middleware y RLS). Registrar saldos de inicio y
// movimientos exige además la acción registrar_movimientos_bancarios.
export default async function BalancesPage() {
  const permisos = await obtenerPermisosRol()
  const puedeRegistrar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes(ACCION_REGISTRAR_MOVIMIENTOS))
  return (
    <MarcoPagina titulo="Balances" subtitulo="Saldos de las cuentas bancarias y movimientos">
      <BalancesView puedeRegistrar={puedeRegistrar} />
    </MarcoPagina>
  )
}
