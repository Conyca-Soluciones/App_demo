import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { RealizarPagosView } from "@/components/realizar-pagos-view"

// Pestaña ayf.realizar_pagos (middleware y RLS). Asignar, confirmar y generar
// exigen además 'generar_dispersores'; la base la vuelve a exigir.
export default async function RealizarPagosPage() {
  const permisos = await obtenerPermisosRol()
  const puedeGenerar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("generar_dispersores"))
  return (
    <MarcoPagina titulo="Realizar Pagos" subtitulo="Dispersores de los pagos liquidados y otros pagos pendientes">
      <RealizarPagosView puedeGenerar={puedeGenerar} />
    </MarcoPagina>
  )
}
