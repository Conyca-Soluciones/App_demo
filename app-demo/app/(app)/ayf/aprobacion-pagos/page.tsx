import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { AprobacionPagosPagina } from "@/components/aprobacion-pagos-pagina"

// El acceso a la ruta lo controla la pestaña ayf.aprobacion_pagos (middleware
// y RLS). Aprobar y rechazar exige además la acción 'aprobar_pagos'; la base la
// vuelve a exigir. ?vista=requisiciones abre las requisiciones administrativas
// (Mis pendientes).
export default async function AprobacionPagosPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const [permisos, { vista }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeAprobar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_pagos"))
  // Volver a solicitar un pago de OC rechazado: aprobar_pagos o gestionar_pagos.
  const puedeResolicitar = puedeAprobar || Boolean(permisos?.acciones.includes("gestionar_pagos"))

  return (
    <MarcoPagina titulo="Aprobación de pagos" subtitulo="Saldos de órdenes de compra, pagos de actas y requisiciones administrativas por aprobar">
      <AprobacionPagosPagina
        puedeAprobar={puedeAprobar}
        puedeResolicitar={puedeResolicitar}
        vistaInicial={vista === "requisiciones" ? "requisiciones" : "pagos"}
      />
    </MarcoPagina>
  )
}
