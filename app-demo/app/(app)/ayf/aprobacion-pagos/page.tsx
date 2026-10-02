import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { AprobacionPagosView } from "@/components/aprobacion-pagos-view"

// El acceso a la ruta lo controla la pestaña ayf.aprobacion_pagos (middleware
// y RLS). Aprobar y rechazar exige además la acción 'aprobar_pagos'; la base la
// vuelve a exigir.
export default async function AprobacionPagosPage() {
  const permisos = await obtenerPermisosRol()
  const puedeAprobar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_pagos"))

  return (
    <MarcoPagina titulo="Aprobación de pagos" subtitulo="Saldos de órdenes de compra por aprobar">
      <AprobacionPagosView puedeAprobar={puedeAprobar} />
    </MarcoPagina>
  )
}
