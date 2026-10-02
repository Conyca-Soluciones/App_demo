"use client"

import { useEffect, useState } from "react"
import { Eye, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { VisorDocumento } from "@/components/visor-documento"
import { HistorialTimeline } from "@/components/historial-timeline"
import { ZONA_HORARIA, formatearFechaSinHora } from "@/lib/fechas"
import {
  CLASE_ESTADO_CONTRATO,
  ETIQUETA_ESTADO_CONTRATO,
  TIPO_CONTRATO_POR_VALOR,
  numero,
  pesos,
  plazoTexto,
  type SolicitudContratoDetalle,
} from "@/lib/contratos"
import { DOCUMENTOS_POR_PERSONA } from "@/lib/contratistas"
import { enlaceDocumentoContrato, obtenerSolicitudContrato } from "@/app/(app)/contratos/solicitar/actions"
import { enlaceDocumentoContratista } from "@/app/(app)/contratos/contratistas/actions"

// ---------------------------------------------------------------------------
// Detalle de una solicitud de contrato, compartido por Solicitud de contratos
// (el director) y Pre-aprobación (Jurídica). Cada pantalla pone sus botones
// con `acciones` (corregir y reenviar / aprobar, devolver, rechazar).
// ---------------------------------------------------------------------------

export const fechaContrato = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { timeZone: ZONA_HORARIA, day: "2-digit", month: "2-digit", year: "numeric" })

export const tituloTipoContrato = (t: string) => TIPO_CONTRATO_POR_VALOR.get(t as never)?.titulo ?? t

type DocumentoAbierto = { titulo: string; nombreArchivo: string; mime: string; cargarUrl: () => Promise<string> }

export function DetalleSolicitudContrato({
  id,
  onCerrar,
  acciones,
}: {
  id: string | null
  onCerrar: () => void
  acciones?: (detalle: SolicitudContratoDetalle) => React.ReactNode
}) {
  const [detalle, setDetalle] = useState<SolicitudContratoDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viendo, setViendo] = useState<DocumentoAbierto | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelado = false
    obtenerSolicitudContrato(id)
      .then((d: SolicitudContratoDetalle) => !cancelado && setDetalle(d))
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudo cargar la solicitud."))
    return () => {
      cancelado = true
    }
  }, [id])

  const tipo = detalle ? TIPO_CONTRATO_POR_VALOR.get(detalle.tipo) : null
  const docPorTipo = new Map(detalle?.documentos.map((d) => [d.tipo, d]) ?? [])
  const docContratistaPorTipo = new Map(detalle?.contratistaDocumentos.map((d) => [d.tipo, d]) ?? [])

  function cerrar() {
    setDetalle(null)
    setError(null)
    setViendo(null)
    onCerrar()
  }

  return (
    <Dialog open={id !== null} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className={`max-h-[92svh] overflow-y-auto ${viendo ? "sm:max-w-5xl" : "sm:max-w-3xl"}`}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {detalle ? `Solicitud N° ${detalle.numero} · ${tituloTipoContrato(detalle.tipo)}` : "Solicitud de contrato"}
            {detalle && (
              <Badge variant="outline" className={CLASE_ESTADO_CONTRATO[detalle.estado]}>
                {ETIQUETA_ESTADO_CONTRATO[detalle.estado]}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {viendo ? (
          <VisorDocumento
            titulo={viendo.titulo}
            nombreArchivo={viendo.nombreArchivo}
            mime={viendo.mime}
            cargarUrl={viendo.cargarUrl}
            onVolver={() => setViendo(null)}
          />
        ) : !detalle && !error ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando...
          </div>
        ) : (
          detalle && (
            <div className="space-y-5 text-sm">
              {(detalle.estado === "devuelta" || detalle.estado === "rechazada") && detalle.motivoResolucion && (
                <div
                  className={`rounded-md border px-3 py-2 ${
                    detalle.estado === "devuelta" ? "border-orange-300 bg-orange-50 text-orange-900" : "border-red-300 bg-red-50 text-red-900"
                  }`}
                >
                  <p className="font-medium">
                    {detalle.estado === "devuelta" ? "Devuelta para corregir" : "Rechazada"}
                    {detalle.resueltoPorNombre && ` por ${detalle.resueltoPorNombre}`}
                    {detalle.resueltoAt && ` el ${fechaContrato(detalle.resueltoAt)}`}
                  </p>
                  <p className="whitespace-pre-line">Motivo: {detalle.motivoResolucion}</p>
                </div>
              )}

              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {(
                  [
                    ["Proyecto", [detalle.proyectoCodigo, detalle.proyectoNombre].filter(Boolean).join(" — ")],
                    ["Contratista", `${detalle.contratistaNombre} · ${detalle.contratistaDocumento}`],
                    ["Valor", `${pesos(detalle.valor)} (${detalle.anexoTipo === "valor_global" ? "valor global" : "valores unitarios"})`],
                    [
                      "Anticipo",
                      detalle.tieneAnticipo
                        ? `${numero(detalle.anticipoPorcentaje ?? 0)} % = ${pesos((detalle.valor * (detalle.anticipoPorcentaje ?? 0)) / 100)}`
                        : "No",
                    ],
                    [
                      "Plazo",
                      plazoTexto(detalle, formatearFechaSinHora) +
                        (detalle.plazoTipo === "duracion" && detalle.fechaInicio ? ` desde ${formatearFechaSinHora(detalle.fechaInicio)} (estimado)` : ""),
                    ],
                    ["Correo de notificación", detalle.correoNotificacion],
                    ["Solicitado por", `${detalle.solicitadoPorNombre ?? "—"} · enviado el ${fechaContrato(detalle.enviadoAt)}`],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>

              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Objeto</h3>
                <p className="whitespace-pre-line">{detalle.objeto}</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Forma de pago</h3>
                <p className="whitespace-pre-line">{detalle.formaPago}</p>
              </div>

              {detalle.items.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr className="bg-muted/60 text-left text-xs">
                        <th className="px-2 py-1.5">Ítem del presupuesto</th>
                        <th className="px-2 py-1.5">Unidad</th>
                        <th className="px-2 py-1.5 text-right">Cantidad</th>
                        <th className="px-2 py-1.5 text-right">Valor unitario</th>
                        <th className="px-2 py-1.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalle.items.map((it, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1.5">
                            {it.codigo && <span className="font-medium tabular-nums">{it.codigo} </span>}
                            {it.actividad}
                          </td>
                          <td className="px-2 py-1.5">{it.unidad}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{numero(it.cantidad)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{pesos(it.valorUnitario)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{pesos(it.cantidad * it.valorUnitario)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(
                [
                  ["Obligaciones específicas", detalle.obligaciones],
                  ["Entregables", detalle.entregables],
                ] as [string, string[]][]
              ).map(
                ([titulo, lista]) =>
                  lista.length > 0 && (
                    <div key={titulo}>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase">{titulo}</h3>
                      <ol className="list-decimal space-y-1 pl-5">
                        {lista.map((t, i) => (
                          <li key={i} className="whitespace-pre-line">
                            {t}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )
              )}

              {detalle.observaciones && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Observaciones</h3>
                  <p className="whitespace-pre-line">{detalle.observaciones}</p>
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Documentos del contrato</h3>
                <ul className="divide-y rounded-md border">
                  {tipo?.documentos.map((req) => {
                    const doc = docPorTipo.get(req.tipo)
                    return (
                      <FilaDocumento
                        key={req.tipo}
                        titulo={req.titulo}
                        nombreArchivo={doc?.nombreArchivo}
                        sinArchivo="No aplica"
                        onVer={
                          doc
                            ? () =>
                                setViendo({
                                  titulo: req.titulo,
                                  nombreArchivo: doc.nombreArchivo,
                                  mime: doc.mime,
                                  cargarUrl: () => enlaceDocumentoContrato(doc.id),
                                })
                            : undefined
                        }
                      />
                    )
                  })}
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Documentos generales del contratista</h3>
                <ul className="divide-y rounded-md border">
                  {DOCUMENTOS_POR_PERSONA[detalle.contratistaTipoPersona].map((req) => {
                    const doc = docContratistaPorTipo.get(req.tipo)
                    return (
                      <FilaDocumento
                        key={req.tipo}
                        titulo={req.titulo}
                        nombreArchivo={doc?.nombreArchivo}
                        sinArchivo={req.obligatorio ? "Falta" : "No aplica"}
                        onVer={
                          doc
                            ? () =>
                                setViendo({
                                  titulo: req.titulo,
                                  nombreArchivo: doc.nombreArchivo,
                                  mime: doc.mime,
                                  cargarUrl: () => enlaceDocumentoContratista(doc.id),
                                })
                            : undefined
                        }
                      />
                    )
                  })}
                </ul>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Historial</h3>
                <HistorialTimeline tipo="contrato" id={detalle.id} />
              </div>

              {acciones && <div className="flex flex-wrap justify-end gap-2 border-t pt-4">{acciones(detalle)}</div>}
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}

function FilaDocumento({
  titulo,
  nombreArchivo,
  sinArchivo,
  onVer,
}: {
  titulo: string
  nombreArchivo?: string
  sinArchivo: string
  onVer?: () => void
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p>{titulo}</p>
        {nombreArchivo && (
          <p className="truncate text-xs text-muted-foreground" title={nombreArchivo}>
            {nombreArchivo}
          </p>
        )}
      </div>
      {onVer ? (
        <Button size="sm" variant="outline" onClick={onVer}>
          <Eye className="size-4" /> Ver
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">{sinArchivo}</span>
      )}
    </li>
  )
}
