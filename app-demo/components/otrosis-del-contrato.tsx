"use client"

import { useEffect, useState } from "react"
import { Eye, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PanelVistaPrevia, useVistaPreviaMinuta } from "@/components/minuta-comun"
import { ZONA_HORARIA, formatearFechaSinHora } from "@/lib/fechas"
import { pesos } from "@/lib/contratos"
import { CLASE_ESTADO_OTROSI, ETIQUETA_ESTADO_OTROSI, type OtrosiDeContrato } from "@/lib/otrosi"
import { otrosisDeContrato } from "@/app/(app)/contratos/otrosi/actions"

// ---------------------------------------------------------------------------
// Rastro de los otrosí en el contrato: la lista de los otrosí de un contrato
// (aprobados con su número y los que están en trámite) con "Ver" para abrir
// su PDF. Va en el detalle del contrato (components/detalle-solicitud-contrato.tsx)
// y en Actas por grupos. El otrosí es documento; solo la prórroga y el nuevo
// valor aprobados cambian el fin vigente y el tope de las actas.
// ---------------------------------------------------------------------------

// Sin importar de detalle-solicitud-contrato (que importa este archivo).
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { timeZone: ZONA_HORARIA, day: "2-digit", month: "2-digit", year: "numeric" })

export function OtrosisDelContrato({ contratoId }: { contratoId: string }) {
  const [carga, setCarga] = useState<{ id: string; otrosis: OtrosiDeContrato[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viendo, setViendo] = useState<OtrosiDeContrato | null>(null)

  useEffect(() => {
    let cancelado = false
    otrosisDeContrato(contratoId)
      .then((l: OtrosiDeContrato[]) => !cancelado && setCarga({ id: contratoId, otrosis: l }))
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudieron cargar los otrosí."))
    return () => {
      cancelado = true
    }
  }, [contratoId])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  const otrosis = carga && carga.id === contratoId ? carga.otrosis : null
  if (!otrosis) {
    return (
      <p className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Cargando otrosí...
      </p>
    )
  }
  if (otrosis.length === 0) return <p className="text-sm text-muted-foreground">Este contrato no tiene otrosí.</p>

  return (
    <>
      <ul className="divide-y rounded-md border">
        {otrosis.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="font-medium">{o.numero !== null ? `Otrosí N° ${o.numero}` : "Otrosí en trámite"}</span>
            <Badge variant="outline" className={CLASE_ESTADO_OTROSI[o.estado]}>
              {ETIQUETA_ESTADO_OTROSI[o.estado]}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={o.clausulas}>
              {o.clausulas}
            </span>
            {o.nuevaFechaFin && (
              <span className="text-xs tabular-nums">prórroga hasta {formatearFechaSinHora(o.nuevaFechaFin)}</span>
            )}
            {o.nuevoValor !== null && <span className="text-xs tabular-nums">nuevo valor {pesos(o.nuevoValor)}</span>}
            <span className="text-xs text-muted-foreground tabular-nums">
              {o.aprobadoAt ? `aprobado el ${fecha(o.aprobadoAt)}` : `pedido el ${fecha(o.createdAt)}`}
            </span>
            <Button size="xs" variant="outline" onClick={() => setViendo(o)}>
              <Eye className="size-3.5" /> Ver
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={viendo !== null} onOpenChange={(abierto) => !abierto && setViendo(null)}>
        <DialogContent className="flex h-[96svh] max-h-[96svh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-3 overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {viendo?.numero != null ? `Otrosí N° ${viendo.numero}` : "Otrosí en trámite (borrador)"}
              {viendo && (
                <Badge variant="outline" className={CLASE_ESTADO_OTROSI[viendo.estado]}>
                  {ETIQUETA_ESTADO_OTROSI[viendo.estado]}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {viendo && <PdfOtrosi id={viendo.id} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

const SIN_CAMBIOS = {}
function PdfOtrosi({ id }: { id: string }) {
  const vista = useVistaPreviaMinuta(id, SIN_CAMBIOS, null, `/contratos/otrosi-pdf/${id}`)
  return (
    <div className="min-h-0 flex-1">
      <PanelVistaPrevia {...vista} />
    </div>
  )
}
