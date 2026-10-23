"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { OrdenCompraDetalleView } from "@/components/orden-compra-detalle-view"
import { DetalleActa } from "@/components/detalle-acta"
import { VentanaDetalle, type CampoDetalle } from "@/components/ventana-detalle"
import { obtenerRequisicionAdminDePago } from "@/app/(app)/ayf/origen-pago-actions"
import { formatearFechaHora } from "@/lib/fechas"
import {
  CLASE_ESTADO_PAGO,
  ETIQUETA_ESTADO_PAGO,
  ETIQUETA_TIPO_PAGO,
  formatoMoneda,
  type EstadoPago,
  type Pago,
  type RequisicionAdminDePago,
  textoCuentaPago,
} from "@/lib/pagos"

// ---------------------------------------------------------------------------
// Doble clic en un pago (Consolidado y Aprobación de pagos): se abre el
// documento de donde sale, completo -- la orden de compra con sus insumos, el
// acta, o el ítem de la requisición administrativa --, con el pago y los
// botones de la fila abajo. Sin documento, la ventana común con `camposPago`.
// ---------------------------------------------------------------------------

export function EtiquetaEstadoPago({ estado }: { estado: EstadoPago }) {
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_PAGO[estado]}`}>
      {ETIQUETA_ESTADO_PAGO[estado]}
    </Badge>
  )
}

// El pago y los mismos botones de la fila. Un botón abre su propio paso
// (confirmar, motivo...) y el detalle se cierra.
export function BarraPago({ pago, acciones, onCerrar }: { pago: Pago; acciones: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="flex w-full shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-sm">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">
          {pago.item != null ? `ITEM ${pago.item} · ` : ""}
          {ETIQUETA_TIPO_PAGO[pago.tipo]}
        </span>
        <span className="tabular-nums">
          {formatoMoneda(pago.valor)}
          {pago.actaBruto != null && pago.actaBruto !== pago.valor && (
            <span className="text-muted-foreground"> (bruto del acta {formatoMoneda(pago.actaBruto)})</span>
          )}
        </span>
        <EtiquetaEstadoPago estado={pago.estado} />
        <span className="min-w-0 truncate text-muted-foreground" title={pago.cuentaTexto ?? undefined}>
          {pago.terceroNombre ?? "Sin tercero"}
          {textoCuentaPago(pago) ? ` · ${textoCuentaPago(pago)}` : ""}
        </span>
        {pago.pagoObservaciones && (
          <span className="min-w-0 basis-full truncate text-muted-foreground" title={pago.pagoObservaciones}>
            Observaciones: {pago.pagoObservaciones}
          </span>
        )}
        {pago.novedad && (
          <span className="flex items-center gap-1 text-amber-700">
            <AlertTriangle className="h-4 w-4" /> {pago.novedad}
          </span>
        )}
      </div>
      <div
        className="flex flex-wrap items-center justify-end gap-2"
        // Después del onClick del botón (que abre su paso). Se frena el clic
        // para que no llegue al documento: si llega, la confirmación recién
        // abierta lo toma como un clic afuera y se cierra sola.
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, a")) return
          e.stopPropagation()
          onCerrar()
        }}
      >
        {acciones}
      </div>
    </div>
  )
}

const ETIQUETA_ESTADO_REQ: Record<string, string> = {
  por_aprobar: "Por aprobar",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
}

export function DetalleOrigenPago({
  pago,
  acciones,
  camposPago,
  onCerrar,
}: {
  pago: Pago | null
  acciones: React.ReactNode
  camposPago: CampoDetalle[]
  onCerrar: () => void
}) {
  const ordenId = pago?.ordenCompraId ?? null
  const actaId = !ordenId ? (pago?.actaId ?? null) : null
  const itemId = !ordenId && !actaId ? (pago?.requisicionAdminItemId ?? null) : null

  return (
    <>
      <Dialog open={ordenId != null} onOpenChange={(abierto) => !abierto && onCerrar()}>
        <DialogContent className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col overflow-hidden sm:w-[90vw] sm:max-w-none">
          <DialogTitle className="sr-only">Orden de compra del pago</DialogTitle>
          {pago && ordenId && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <OrdenCompraDetalleView ordenId={ordenId} onCerrar={onCerrar} />
              </div>
              <BarraPago pago={pago} acciones={acciones} onCerrar={onCerrar} />
            </>
          )}
        </DialogContent>
      </Dialog>

      <DetalleActa
        id={actaId}
        onCerrar={onCerrar}
        acciones={() => pago && <BarraPago pago={pago} acciones={acciones} onCerrar={onCerrar} />}
      />

      {pago && itemId && (
        <DetalleRequisicionAdmin key={itemId} pago={pago} itemId={itemId} acciones={acciones} onCerrar={onCerrar} />
      )}

      <VentanaDetalle
        abierta={pago !== null && !ordenId && !actaId && !itemId}
        onCerrar={onCerrar}
        titulo={pago ? (pago.terceroNombre ?? "Pago") : ""}
        subtitulo={pago ? `${pago.origen || "—"} · ${ETIQUETA_TIPO_PAGO[pago.tipo]}` : undefined}
        campos={camposPago}
        acciones={acciones}
      />
    </>
  )
}

function DetalleRequisicionAdmin({
  pago,
  itemId,
  acciones,
  onCerrar,
}: {
  pago: Pago
  itemId: string
  acciones: React.ReactNode
  onCerrar: () => void
}) {
  const [req, setReq] = useState<RequisicionAdminDePago | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    obtenerRequisicionAdminDePago(itemId)
      .then((r: RequisicionAdminDePago) => vigente && setReq(r))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudo cargar la requisición."))
    return () => {
      vigente = false
    }
  }, [itemId])

  const campos: CampoDetalle[] = req
    ? [
        { etiqueta: "Concepto", valor: req.concepto, ancho: "completo" },
        { etiqueta: "Empresa que paga", valor: req.empresa ?? "" },
        { etiqueta: "Proyecto", valor: req.proyecto ?? "" },
        { etiqueta: "Quien factura", valor: `${req.facturaNombre} · NIT/CC ${req.facturaNit}` },
        { etiqueta: "Titular de la cuenta", valor: `${req.titularNombre} · ${req.titularDocumento}` },
        { etiqueta: "Cuenta", valor: req.cuentaTexto ?? "" },
        { etiqueta: "Valor", valor: formatoMoneda(req.valor) },
        { etiqueta: "Método", valor: req.metodo === "pse" ? "PSE" : "Transferencia" },
        { etiqueta: "Estado de la requisición", valor: ETIQUETA_ESTADO_REQ[req.estado] ?? req.estado },
        { etiqueta: "Solicitada por", valor: req.creadoPorNombre ?? "" },
        { etiqueta: "Enviada", valor: req.enviadaEn ? formatearFechaHora(req.enviadaEn) : "" },
        { etiqueta: "Resuelta", valor: req.resueltaEn ? formatearFechaHora(req.resueltaEn) : "" },
        { etiqueta: "Observaciones", valor: req.observaciones ?? "", ancho: "completo" },
      ]
    : []

  return (
    <VentanaDetalle
      abierta
      onCerrar={onCerrar}
      ancha
      titulo={req ? `Requisición administrativa${req.numero != null ? ` N° ${req.numero}` : ""}` : "Requisición administrativa"}
      subtitulo={pago.item != null ? `ITEM ${pago.item} del consolidado` : undefined}
      campos={campos}
    >
      {!req && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando la requisición...
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <BarraPago pago={pago} acciones={acciones} onCerrar={onCerrar} />
    </VentanaDetalle>
  )
}
