"use client"

import { useEffect, useState } from "react"
import { FileDown, Loader2, Paperclip } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { VisorDocumento } from "@/components/visor-documento"
import { HistorialTimeline } from "@/components/historial-timeline"
import { tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { formatearFechaSinHora } from "@/lib/fechas"
import { numero, pesos } from "@/lib/contratos"
import {
  CLASE_ESTADO_ACTA,
  ETIQUETA_ESTADO_ACTA,
  ETIQUETA_SOPORTE,
  ETIQUETA_TIPO_ACTA,
  saldoContrato,
  type ActaDetalle,
  type SoporteActa,
} from "@/lib/actas"
import { enlaceSoporteActa, obtenerActa } from "@/app/(app)/contratos/actas/actions"

// Detalle de un acta en un diálogo (Actas por grupos y Aprobación de actas):
// el contrato con su cupo, lo ejecutado (actividades o % de avance), los
// descuentos y el neto, los soportes, el pago en A&F, el historial y el PDF.
// Cada pantalla pone sus botones.
export function DetalleActa({
  id,
  onCerrar,
  acciones,
}: {
  id: string | null
  onCerrar: () => void
  acciones?: (acta: ActaDetalle) => React.ReactNode
}) {
  const [acta, setActa] = useState<ActaDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viendo, setViendo] = useState<SoporteActa | null>(null)

  useEffect(() => {
    if (!id) return
    let vigente = true
    obtenerActa(id)
      .then((a) => vigente && setActa(a))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudo cargar el acta."))
    return () => {
      vigente = false
    }
  }, [id])

  function cerrar() {
    setActa(null)
    setError(null)
    setViendo(null)
    onCerrar()
  }

  const v = acta && acta.id === id ? acta : null
  // Cupo visto desde esta acta: lo que usan las demás + esta (si no está rechazada).
  const usado = v ? v.otrasActas + (v.estado === "rechazada" ? 0 : v.valorBruto) : 0
  const conActividades = v ? v.actividades.filter((a) => a.cantidad != null) : []

  return (
    <Dialog open={id !== null} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto [scrollbar-width:thin] sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {v ? `${ETIQUETA_TIPO_ACTA[v.tipo]} N° ${v.numero} · ${v.numeroContrato}` : "Acta"}
            {v && <Badge className={`h-6 px-3 text-xs ${CLASE_ESTADO_ACTA[v.estado]}`}>{ETIQUETA_ESTADO_ACTA[v.estado]}</Badge>}
            {v && (
              <a
                href={`/contratos/acta-pdf/${v.id}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-normal hover:bg-accent"
              >
                <FileDown className="h-4 w-4" /> PDF del acta
              </a>
            )}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !v ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando acta...
          </p>
        ) : viendo ? (
          <VisorDocumento
            titulo={ETIQUETA_SOPORTE[viendo.tipo]}
            nombreArchivo={viendo.nombreArchivo}
            mime={viendo.mime ?? ""}
            cargarUrl={() => enlaceSoporteActa(viendo.ruta)}
            onVolver={() => setViendo(null)}
          />
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Dato titulo="Contratista">
                {v.contratistaNombre} <span className="text-muted-foreground">({v.contratistaDocumento})</span>
              </Dato>
              <Dato titulo="Proyecto">
                {v.proyectoCodigo} · {v.proyectoNombre}
              </Dato>
              <Dato titulo="Tipo de contrato">{tituloTipoContrato(v.tipoContrato)}</Dato>
              <Dato titulo="Período">
                {v.periodoDesde || v.periodoHasta
                  ? `${v.periodoDesde ? formatearFechaSinHora(v.periodoDesde) : "…"} a ${v.periodoHasta ? formatearFechaSinHora(v.periodoHasta) : "…"}`
                  : "—"}
              </Dato>
              <Dato titulo="Elaborada">
                {formatearFechaSinHora(v.createdAt)}
                {v.creadoPorNombre ? ` por ${v.creadoPorNombre}` : ""}
              </Dato>
              {v.editadaAt && (
                <Dato titulo="Última edición">
                  {formatearFechaSinHora(v.editadaAt)}
                  {v.editadaPorNombre ? ` por ${v.editadaPorNombre}` : ""}
                </Dato>
              )}
              {v.resueltoAt && (
                <Dato titulo={v.estado === "aprobada" ? "Aprobada" : "Rechazada"}>
                  {formatearFechaSinHora(v.resueltoAt)}
                  {v.resueltoPorNombre ? ` por ${v.resueltoPorNombre}` : ""}
                </Dato>
              )}
              {v.motivoResolucion && <Dato titulo="Motivo">{v.motivoResolucion}</Dato>}
              <div className="sm:col-span-2">
                <Dato titulo="Objeto">{v.objeto}</Dato>
              </div>
              {v.observaciones && (
                <div className="sm:col-span-2">
                  <Dato titulo="Observaciones">{v.observaciones}</Dato>
                </div>
              )}
            </div>

            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
              <Cifra titulo="Valor del contrato" valor={v.contratoValor} />
              <Cifra titulo="Actas anteriores" valor={v.otrasActas} />
              <Cifra titulo="Esta acta (bruto)" valor={v.valorBruto} fuerte />
              <Cifra titulo="Saldo del contrato" valor={saldoContrato(v.contratoValor, usado)} />
            </div>

            {/* Lo ejecutado */}
            {v.tipo !== "liquidacion" && v.anexoTipo === "valores_unitarios" && conActividades.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
                      <th>Actividad</th>
                      <th>Unidad</th>
                      <th className="text-right">Contratada</th>
                      <th className="text-right">Acumulado anterior</th>
                      <th className="text-right">Esta acta</th>
                      <th className="text-right">Acumulado</th>
                      <th className="text-right">Valor unitario</th>
                      <th className="text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conActividades.map((a) => (
                      <tr key={a.id} className="border-t [&_td]:px-3 [&_td]:py-2">
                        <td>{a.actividad}</td>
                        <td className="text-muted-foreground">{a.unidad}</td>
                        <td className="text-right tabular-nums">{numero(a.cantidadContratada)}</td>
                        <td className="text-right tabular-nums">{numero(a.acumuladoAnterior)}</td>
                        <td className="text-right font-medium tabular-nums">{numero(a.cantidad ?? 0)}</td>
                        <td className="text-right tabular-nums">{numero(a.acumuladoAnterior + (a.cantidad ?? 0))}</td>
                        <td className="text-right tabular-nums">{pesos(a.valorUnitario)}</td>
                        <td className="text-right font-medium tabular-nums">{pesos(a.valor ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {v.tipo !== "liquidacion" && v.porcentajeAvance != null && (
              <div className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-3">
                <Texto titulo="Avance anterior" texto={`${numero(v.avanceAnterior)} %`} />
                <Texto titulo="Avance de esta acta" texto={`${numero(v.porcentajeAvance)} %`} />
                <Texto titulo="Avance acumulado" texto={`${numero(v.avanceAnterior + v.porcentajeAvance)} %`} />
              </div>
            )}
            {v.lineasAnteriores.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <p className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Acta del formato anterior (líneas de ítem e insumo del APU).
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    {v.lineasAnteriores.map((l) => (
                      <tr key={l.orden} className="border-t [&_td]:px-3 [&_td]:py-2">
                        <td>
                          <span className="font-medium">{l.itemCodigo}</span> {l.itemDescripcion}
                        </td>
                        <td>{l.insumoDescripcion}</td>
                        <td className="text-right tabular-nums">
                          {numero(l.cantidad)} {l.unidad}
                        </td>
                        <td className="text-right tabular-nums">{pesos(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Resumen */}
            <div className="ml-auto w-full max-w-md rounded-lg border text-sm">
              <table className="w-full [&_td]:px-3 [&_td]:py-1.5">
                <tbody>
                  {v.tipo === "liquidacion" ? (
                    <>
                      <Fila titulo="Devolución de la retención en garantía" valor={v.devolucionRetencion} />
                      <Fila titulo="Anticipo por amortizar" valor={-v.amortizacion} />
                    </>
                  ) : (
                    <>
                      <Fila titulo="Valor bruto del acta" valor={v.valorBruto} />
                      <Fila
                        titulo={`Amortización del anticipo${v.anticipoPorcentaje ? ` (${numero(v.anticipoPorcentaje)} %)` : ""}`}
                        valor={-v.amortizacion}
                      />
                      <Fila
                        titulo={`Retención en garantía${v.retencionPorcentaje ? ` (${numero(v.retencionPorcentaje)} %)` : ""}`}
                        valor={-v.retencion}
                      />
                    </>
                  )}
                  {v.descuentos.map((d, i) => (
                    <Fila key={i} titulo={d.concepto} valor={-d.valor} />
                  ))}
                  <tr className="border-t bg-muted/30 font-semibold">
                    <td>Neto a pagar</td>
                    <td className="text-right text-base tabular-nums">{pesos(v.neto)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {v.pago && (
              <p
                className={`rounded-md border px-3 py-2 text-sm ${
                  v.pago.estado === "solicitado" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
                }`}
              >
                {v.pago.estado === "solicitado"
                  ? `Pago por ${pesos(v.pago.valor)} por aprobar en A&F (Aprobación de pagos). Al aprobarlo, el acta queda aprobada.`
                  : `Pago aprobado en A&F por ${pesos(v.pago.valor)}`}
                {v.pago.item != null ? ` · ITEM ${v.pago.item} de la semana ${v.pago.semana} de ${v.pago.anio}` : ""}
                {v.pago.novedad ? ` · ${v.pago.novedad}` : ""}
              </p>
            )}

            {v.soportes.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Soportes</p>
                {v.soportes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setViendo(s)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent"
                  >
                    <Paperclip className="h-4 w-4 shrink-0" />
                    <span className="truncate text-primary underline underline-offset-2">{s.nombreArchivo}</span>
                    <span className="text-xs text-muted-foreground">({ETIQUETA_SOPORTE[s.tipo]})</span>
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Historial</p>
              <HistorialTimeline tipo="acta" id={v.id} />
            </div>

            {acciones && <DialogFooter>{acciones(v)}</DialogFooter>}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p>{children}</p>
    </div>
  )
}

function Cifra({ titulo, valor, fuerte }: { titulo: string; valor: number; fuerte?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={`tabular-nums ${fuerte ? "font-semibold" : ""} ${valor < 0 ? "text-destructive" : ""}`}>{pesos(valor)}</p>
    </div>
  )
}

function Texto({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="tabular-nums">{texto}</p>
    </div>
  )
}

function Fila({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <tr>
      <td>{titulo}</td>
      <td className="text-right tabular-nums">{valor === 0 ? "—" : pesos(valor)}</td>
    </tr>
  )
}

