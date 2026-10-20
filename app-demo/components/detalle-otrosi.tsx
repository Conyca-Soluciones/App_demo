"use client"

import { useEffect, useState } from "react"
import { Eye, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { HistorialTimeline } from "@/components/historial-timeline"
import { VerContratoOtrosi } from "@/components/ver-contrato-otrosi"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { formatearFechaSinHora } from "@/lib/fechas"
import { nombreTipoContrato, pesos } from "@/lib/contratos"
import { CLASE_ESTADO_OTROSI, ETIQUETA_ESTADO_OTROSI, type OtrosiDetalle } from "@/lib/otrosi"
import { obtenerOtrosi } from "@/app/(app)/contratos/otrosi/actions"

// ---------------------------------------------------------------------------
// Detalle de un otrosí, compartido por Solicitud de otrosí (el ingeniero) y
// Aprobación de otrosí (Jurídica y Subgerencia). Primera pestaña: la solicitud
// (contrato, cláusulas pedidas, justificación, historial). Con `documento`
// suma la segunda: el otrosí (vista previa y, para Jurídica, el editor). Cada
// pantalla pone sus botones con `acciones`, que salen en las dos pestañas.
// ---------------------------------------------------------------------------

export function DetalleOtrosi({
  id,
  onCerrar,
  acciones,
  documento,
}: {
  id: string | null
  onCerrar: () => void
  acciones?: (detalle: OtrosiDetalle) => React.ReactNode
  documento?: (detalle: OtrosiDetalle) => React.ReactNode
}) {
  const [cargado, setCargado] = useState<{ id: string; detalle: OtrosiDetalle } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pestana, setPestana] = useState<"solicitud" | "documento">("solicitud")
  const [verContrato, setVerContrato] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelado = false
    obtenerOtrosi(id)
      .then((d: OtrosiDetalle) => !cancelado && setCargado({ id, detalle: d }))
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudo cargar el otrosí."))
    return () => {
      cancelado = true
    }
  }, [id])

  const detalle = cargado && cargado.id === id ? cargado.detalle : null

  function cerrar() {
    setCargado(null)
    setError(null)
    setPestana("solicitud")
    setVerContrato(false)
    onCerrar()
  }

  return (
    <>
      <Dialog open={id !== null} onOpenChange={(abierto) => !abierto && cerrar()}>
        <DialogContent
          className={
            documento
              ? "flex h-[96svh] max-h-[96svh] w-[calc(100vw-1rem)] max-w-none flex-col gap-4 overflow-hidden sm:max-w-none"
              : "max-h-[92svh] overflow-y-auto sm:max-w-3xl"
          }
        >
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detalle
                ? `${detalle.numero !== null ? `Otrosí N° ${detalle.numero}` : "Solicitud de otrosí"} · contrato ${detalle.numeroContrato}`
                : "Otrosí"}
              {detalle && (
                <Badge variant="outline" className={CLASE_ESTADO_OTROSI[detalle.estado]}>
                  {ETIQUETA_ESTADO_OTROSI[detalle.estado]}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}

          {documento && detalle && (
            <div className="-mt-1 flex gap-1 border-b" role="tablist" aria-label="Secciones">
              {(
                [
                  ["solicitud", "Solicitud"],
                  ["documento", "Otrosí"],
                ] as const
              ).map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  role="tab"
                  aria-selected={pestana === valor}
                  onClick={() => setPestana(valor)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                    pestana === valor ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          )}

          <div className={documento ? "-mx-2 min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-gutter:stable] [scrollbar-width:thin]" : "contents"}>
            {!detalle && !error ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Cargando...
              </div>
            ) : (
              detalle && (
                <div className="space-y-5 text-sm">
                  <AvisoMotivo detalle={detalle} />
                  {documento && pestana === "documento" ? (
                    documento(detalle)
                  ) : (
                    <>
                      <Tabla
                        titulo="Contrato"
                        filas={[
                          ["Contrato", `${detalle.numeroContrato} · ${nombreTipoContrato(detalle)}`],
                          ["Proyecto", [detalle.proyectoCodigo, detalle.proyectoNombre].filter(Boolean).join(" — ")],
                          ["Contratista", detalle.contratistaNombre],
                          ["Objeto", detalle.objeto],
                          ["Valor vigente", pesos(detalle.valor)],
                          ["Fin del plazo vigente", detalle.fechaFin ? formatearFechaSinHora(detalle.fechaFin) : "Sin fecha (sin inicio definido)"],
                        ]}
                      />
                      <Button size="sm" variant="outline" onClick={() => setVerContrato(true)}>
                        <Eye className="size-4" /> Ver contrato
                      </Button>
                      <Tabla
                        titulo="Solicitud"
                        filas={[
                          ["Solicitado por", `${detalle.solicitadoPorNombre ?? "—"} · enviado el ${fechaContrato(detalle.enviadoAt)}`],
                          ["Justificación", <span key="j" className="whitespace-pre-line">{detalle.justificacion}</span>],
                          [
                            "Extiende la fecha",
                            detalle.nuevaFechaFin
                              ? `Sí, hasta el ${formatearFechaSinHora(detalle.nuevaFechaFin)}${detalle.estado === "aprobada" ? "" : " (cuando se apruebe)"}`
                              : "No",
                          ],
                          [
                            "Cambia el valor",
                            detalle.nuevoValor !== null
                              ? `Sí, a ${pesos(detalle.nuevoValor)}${detalle.estado === "aprobada" ? "" : " (cuando se apruebe)"}`
                              : "No",
                          ],
                          ...(detalle.numero !== null && detalle.aprobadoAt
                            ? ([["Aprobado", `${detalle.aprobadoPorNombre ?? "—"} · ${fechaContrato(detalle.aprobadoAt)}`]] as [string, React.ReactNode][])
                            : []),
                        ]}
                      />
                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase">Cláusulas que se modifican</h3>
                        <ol className="space-y-2">
                          {detalle.modificaciones.map((m, i) => (
                            <li key={i} className="rounded-md border p-3">
                              <p className="font-medium">
                                {i + 1}. {m.clausula}
                              </p>
                              <p className="mt-1 whitespace-pre-line text-muted-foreground">{m.redaccion}</p>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase">Historial</h3>
                        <HistorialTimeline tipo="otrosi" id={detalle.id} />
                      </div>
                    </>
                  )}
                  {acciones && <div className="flex flex-wrap justify-end gap-2 border-t pt-4">{acciones(detalle)}</div>}
                </div>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
      <VerContratoOtrosi
        contrato={verContrato && detalle ? { id: detalle.contratoId, numeroContrato: detalle.numeroContrato } : null}
        onCerrar={() => setVerContrato(false)}
      />
    </>
  )
}

// Última devolución o rechazo, con su motivo.
function AvisoMotivo({ detalle }: { detalle: OtrosiDetalle }) {
  if (!detalle.motivo || !["devuelta", "rechazada", "devuelta_subgerencia"].includes(detalle.estado)) return null
  const rojo = detalle.estado === "rechazada"
  return (
    <div className={`rounded-md border px-3 py-2 ${rojo ? "border-red-300 bg-red-50 text-red-900" : "border-orange-300 bg-orange-50 text-orange-900"}`}>
      <p className="font-medium">
        {ETIQUETA_ESTADO_OTROSI[detalle.estado]}
        {detalle.resueltoPorNombre && ` por ${detalle.resueltoPorNombre}`}
        {detalle.resueltoAt && ` el ${fechaContrato(detalle.resueltoAt)}`}
      </p>
      <p className="whitespace-pre-line">Motivo: {detalle.motivo}</p>
    </div>
  )
}

function Tabla({ titulo, filas }: { titulo: string; filas: [string, React.ReactNode][] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase">{titulo}</h3>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full">
          <tbody>
            {filas.map(([etiqueta, valor]) => (
              <tr key={etiqueta} className="border-t first:border-t-0">
                <th className="w-44 bg-muted/40 px-3 py-1.5 text-left align-top text-xs font-medium text-muted-foreground">{etiqueta}</th>
                <td className="px-3 py-1.5">{valor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
