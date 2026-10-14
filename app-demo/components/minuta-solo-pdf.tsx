"use client"

import { useEffect, useState } from "react"
import { PanelVistaPrevia, useVistaPreviaMinuta } from "@/components/minuta-comun"
import { obtenerMinutaParaRevision } from "@/app/(app)/contratos/pre-aprobacion/actions"

// Minuta solo en PDF, sin el panel de edición de Jurídica (Aprobación de
// contratos, Subgerencia). Muestra lo guardado: lo que Jurídica envió.
export function MinutaSoloPdf({ id }: { id: string }) {
  const [minuta, setMinuta] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const vistaPrevia = useVistaPreviaMinuta(id, minuta)

  useEffect(() => {
    let cancelado = false
    obtenerMinutaParaRevision(id)
      .then((m: unknown) => !cancelado && setMinuta(m))
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudo cargar la minuta."))
    return () => {
      cancelado = true
    }
  }, [id])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  return <PanelVistaPrevia {...vistaPrevia} />
}
