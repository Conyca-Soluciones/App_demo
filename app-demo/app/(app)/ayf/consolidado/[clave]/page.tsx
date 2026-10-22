import { notFound } from "next/navigation"
import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { ConsolidadoPagosView } from "@/components/consolidado-pagos-view"
import { CONSOLIDADOS, esClaveConsolidado } from "@/lib/pagos"

// Un consolidado por pestaña (ayf.consolidado_<clave>, middleware y RLS).
// Resolver novedades (elegir tercero y cuenta) exige además la acción
// 'gestionar_pagos'; la base la vuelve a exigir.
export default async function ConsolidadoPage({ params }: { params: Promise<{ clave: string }> }) {
  const { clave } = await params
  if (!esClaveConsolidado(clave)) notFound()
  const permisos = await obtenerPermisosRol()
  const puedeGestionar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("gestionar_pagos"))
  const titulo = CONSOLIDADOS.find((c) => c.clave === clave)!.titulo

  return (
    <MarcoPagina titulo={titulo} subtitulo="Pagos aprobados de la semana, con su ITEM">
      <ConsolidadoPagosView key={clave} clave={clave} puedeGestionar={puedeGestionar} />
    </MarcoPagina>
  )
}
