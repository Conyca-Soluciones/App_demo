import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { LiquidacionPagosView } from "@/components/liquidacion-pagos-view"

// El acceso a la ruta lo controla la pestaña ayf.liquidacion (middleware y
// RLS). Liquidar exige la acción 'liquidar_pagos'; la base la vuelve a exigir.
export default async function LiquidacionPage() {
  const permisos = await obtenerPermisosRol()
  const puedeLiquidar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("liquidar_pagos"))

  return (
    <MarcoPagina titulo="Liquidación de pagos" subtitulo="Retenciones de cada pago aprobado y el neto que se dispersa">
      <LiquidacionPagosView puedeLiquidar={puedeLiquidar} />
    </MarcoPagina>
  )
}
