import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { ConsolidadoPagosView } from "@/components/consolidado-pagos-view"

// El acceso a la ruta lo controla la pestaña ayf.consolidado (middleware y
// RLS). Resolver novedades (elegir tercero y cuenta) exige la acción
// 'gestionar_pagos'; la base la vuelve a exigir.
export default async function ConsolidadoPage() {
  const permisos = await obtenerPermisosRol()
  const puedeGestionar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("gestionar_pagos"))

  return (
    <MarcoPagina titulo="Consolidado de pagos" subtitulo="Pagos aprobados de la semana, con su ITEM">
      <ConsolidadoPagosView puedeGestionar={puedeGestionar} />
    </MarcoPagina>
  )
}
