import { notFound } from "next/navigation"
import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { ConsolidadoPagosView } from "@/components/consolidado-pagos-view"
import { CONSOLIDADOS, ETAPAS_CONSOLIDADO, esClaveConsolidado, type EtapaConsolidado } from "@/lib/pagos"

// Un consolidado por pestaña (ayf.consolidado_<clave>, middleware y RLS).
// Preparar (enviar a liquidar, responder, elegir tercero y cuenta) exige además
// 'gestionar_pagos' y liquidar, 'liquidar_pagos'; la base las vuelve a exigir.
// ?etapa=<etapa> (enlaces de Mis pendientes) abre esa pestaña ya consultada.
export default async function ConsolidadoPage({
  params,
  searchParams,
}: {
  params: Promise<{ clave: string }>
  searchParams: Promise<{ etapa?: string }>
}) {
  const [{ clave }, { etapa }] = await Promise.all([params, searchParams])
  const etapaInicial = ETAPAS_CONSOLIDADO.some((e) => e.clave === etapa) ? (etapa as EtapaConsolidado) : null
  if (!esClaveConsolidado(clave)) notFound()
  const permisos = await obtenerPermisosRol()
  const puedeGestionar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("gestionar_pagos"))
  const puedeLiquidar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("liquidar_pagos"))
  const puedePagarPse = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("pagar_pse"))
  const titulo = CONSOLIDADOS.find((c) => c.clave === clave)!.titulo

  return (
    <MarcoPagina titulo={titulo} subtitulo="Pagos aprobados: preparación, liquidación y pago">
      <ConsolidadoPagosView key={clave} clave={clave} puedeGestionar={puedeGestionar} puedeLiquidar={puedeLiquidar} puedePagarPse={puedePagarPse} etapaInicial={etapaInicial} />
    </MarcoPagina>
  )
}
