import { redirect } from "next/navigation"
import { obtenerPermisosRol } from "@/lib/permisos"
import { CONSOLIDADOS, PESTANA_CONSOLIDADO } from "@/lib/pagos"

// La ruta de antes (enlaces viejos, Mis pendientes): lleva al primer
// consolidado que la persona tenga.
export default async function ConsolidadoInicio() {
  const permisos = await obtenerPermisosRol()
  const primero = CONSOLIDADOS.find(
    (c) => permisos?.esAdministrador || (!permisos?.sinRol && permisos?.pestanas.includes(PESTANA_CONSOLIDADO(c.clave)))
  )
  redirect(primero ? `/ayf/consolidado/${primero.clave}` : "/inicio?error=no-autorizado")
}
