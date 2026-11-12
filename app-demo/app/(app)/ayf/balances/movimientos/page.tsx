import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { RegistrarMovimientosView } from "@/components/balances-view"
import { ACCION_REGISTRAR_MOVIMIENTOS } from "@/lib/balances"

// Balances › Registrar movimientos (pestaña ayf.balances_movimientos).
// Registrar exige además la acción registrar_movimientos_bancarios (la base la vuelve a exigir).
export default async function RegistrarMovimientosPage() {
  const permisos = await obtenerPermisosRol()
  const puedeRegistrar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes(ACCION_REGISTRAR_MOVIMIENTOS))
  return (
    <MarcoPagina titulo="Registrar movimientos" subtitulo="Saldos de inicio, ingresos, egresos externos y traslados internos">
      <RegistrarMovimientosView puedeRegistrar={puedeRegistrar} />
    </MarcoPagina>
  )
}
