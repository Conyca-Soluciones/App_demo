import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { AprobacionPagosView } from "@/components/aprobacion-pagos-view"

// El acceso a la ruta lo controla la pestaña ayf.aprobacion_pagos (middleware
// y RLS). Aprobar y rechazar exige además la acción 'aprobar_pagos'; la base la
// vuelve a exigir.
export default async function AprobacionPagosPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  // ?estado=saldo_acta: desde Mis pendientes ("Saldos de actas por pagar").
  const { estado } = await searchParams
  const permisos = await obtenerPermisosRol()
  const puedeAprobar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_pagos"))
  // Volver a solicitar un pago de OC rechazado: aprobar_pagos o gestionar_pagos.
  const puedeResolicitar = puedeAprobar || Boolean(permisos?.acciones.includes("gestionar_pagos"))

  return (
    <MarcoPagina titulo="Aprobación de pagos" subtitulo="Pagos de órdenes de compra (contado, anticipo, saldo y crédito), de actas de contratos (completas o por avance) y pagos administrativos por aprobar">
      <AprobacionPagosView
        puedeAprobar={puedeAprobar}
        puedeResolicitar={puedeResolicitar}
        estadoInicial={estado === "saldo_acta" ? "saldo_acta" : undefined}
      />
    </MarcoPagina>
  )
}
