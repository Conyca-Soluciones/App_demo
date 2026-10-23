import { notFound } from "next/navigation"
import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { ConsolidadoPagosView } from "@/components/consolidado-pagos-view"
import { CONSOLIDADOS, esClaveConsolidado } from "@/lib/pagos"

// Un consolidado por pestaña (ayf.consolidado_<clave>, middleware y RLS).
// Preparar (enviar a liquidar, responder, elegir tercero y cuenta) exige además
// 'gestionar_pagos' y liquidar, 'liquidar_pagos'; la base las vuelve a exigir.
export default async function ConsolidadoPage({ params }: { params: Promise<{ clave: string }> }) {
  const { clave } = await params
  if (!esClaveConsolidado(clave)) notFound()
  const permisos = await obtenerPermisosRol()
  const puedeGestionar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("gestionar_pagos"))
  const puedeLiquidar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("liquidar_pagos"))
  const titulo = CONSOLIDADOS.find((c) => c.clave === clave)!.titulo

  return (
    <MarcoPagina titulo={titulo} subtitulo="Pagos aprobados: preparación, liquidación y pago">
      <ConsolidadoPagosView key={clave} clave={clave} puedeGestionar={puedeGestionar} puedeLiquidar={puedeLiquidar} />
    </MarcoPagina>
  )
}
