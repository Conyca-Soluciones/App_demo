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
  CLASE_ETAPA_CONTRATO,
  ETIQUETA_ETAPA_CONTRATO,
  etapaContrato,
  TIPO_CONTRATO_POR_VALOR,
  anticipoEnLetras,
  numero,
  pesosEnLetras,
  pesos,
  datosTipoParaMostrar,
  nombreTipoContrato,
  plazoTexto,
  type SolicitudContratoDetalle,
} from "@/lib/contratos"
import { DOCUMENTOS_POR_PERSONA } from "@/lib/contratistas"
import { enlaceDocumentoContrato, obtenerSolicitudContrato } from "@/app/(app)/contratos/solicitar/actions"
import { enlaceDocumentoContratista } from "@/app/(app)/contratos/contratistas/actions"

// ---------------------------------------------------------------------------
// Detalle de una solicitud de contrato, compartido por Solicitud de contratos
// (el director), Pre-aprobación (Jurídica) y Aprobación de minutas
// (Subgerencia). Cada pantalla pone sus botones con `acciones` (corregir y
// reenviar / aprobar, devolver, rechazar, enviar a Subgerencia), que salen en
// las dos pestañas. Con `minuta` el diálogo se agranda y suma la pestaña
// "Minuta" junto a "Solicitud".
// ---------------------------------------------------------------------------

export const fechaContrato = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { timeZone: ZONA_HORARIA, day: "2-digit", month: "2-digit", year: "numeric" })

// Los generales guardan "servicios" u "otro" (con su detalle, ver nombreTipoContrato).
export const tituloTipoContrato = (t: string) => (t === "servicios" ? "Servicios" : t === "otro" ? "Otro" : TIPO_CONTRATO_POR_VALOR.get(t as never)?.titulo ?? t)

type DocumentoAbierto = { titulo: string; nombreArchivo: string; mime: string; cargarUrl: () => Promise<string> }

export function DetalleSolicitudContrato({
  id,
  onCerrar,
  acciones,
  minuta,
  resumen = false,
}: {
  id: string | null
  onCerrar: () => void
  // Solo datos generales, objeto y alcance, valor e historial (sin documentos).
  resumen?: boolean
  acciones?: (detalle: SolicitudContratoDetalle) => React.ReactNode
  minuta?: (detalle: SolicitudContratoDetalle) => React.ReactNode
}) {
  const [detalle, setDetalle] = useState<SolicitudContratoDetalle | null>(null)
  const [pestana, setPestana] = useState<"solicitud" | "minuta">("solicitud")
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
  // Contrato general: sin minuta ni ítems; lleva referencia y retenciones.
  const general = detalle?.clase === "general"
  const docPorTipo = new Map(detalle?.documentos.map((d) => [d.tipo, d]) ?? [])
  const docContratistaPorTipo = new Map(detalle?.contratistaDocumentos.map((d) => [d.tipo, d]) ?? [])

  function cerrar() {
    setDetalle(null)
    setError(null)
    setViendo(null)
    setPestana("solicitud")
    onCerrar()
  }

  return (
    <Dialog open={id !== null} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent
        className={
          minuta
            ? "flex h-[96svh] max-h-[96svh] w-[calc(100vw-1rem)] max-w-none flex-col gap-4 overflow-hidden sm:max-w-none"
            : `max-h-[92svh] overflow-y-auto ${viendo ? "sm:max-w-5xl" : "sm:max-w-3xl"}`
        }
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {detalle
              ? `${detalle.clase === "general" ? "Contrato general" : "Solicitud"} N° ${detalle.numero} · ${nombreTipoContrato(detalle)}`
              : "Solicitud de contrato"}
            {detalle && (
              <Badge variant="outline" className={CLASE_ETAPA_CONTRATO[etapaContrato(detalle)]}>
                {ETIQUETA_ETAPA_CONTRATO[etapaContrato(detalle)]}
              </Badge>
            )}
            {detalle?.numeroContrato && <span className="text-sm font-normal text-muted-foreground">Contrato {detalle.numeroContrato}</span>}
          </DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {minuta && detalle && !viendo && (
          <div className="-mt-1 flex gap-1 border-b" role="tablist" aria-label="Secciones">
            {(
              [
                ["solicitud", general ? "Contrato" : "Solicitud"],
                ["minuta", general ? "Hoja en PDF" : "Minuta"],
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

        {/* Con minuta (Pre-aprobación) el encabezado y las pestañas quedan fijos y
            el cuerpo hace scroll por dentro del borde redondeado. */}
        <div className={minuta ? "-mx-2 min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-gutter:stable] [scrollbar-width:thin]" : "contents"}>
        {minuta && detalle && !viendo && pestana === "minuta" ? (
          <>
            <AvisoMinutaDevuelta detalle={detalle} />
            {minuta(detalle)}
            {acciones && <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">{acciones(detalle)}</div>}
          </>
        ) : viendo ? (
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

              <AvisoMinutaDevuelta detalle={detalle} />

              <TablaDatos
                titulo="Datos generales"
                filas={[
                  ["Tipo de contrato", nombreTipoContrato(detalle)],
                  ["Proyecto", [detalle.proyectoCodigo, detalle.proyectoNombre].filter(Boolean).join(" — ")],
                  ["Contratista", `${detalle.contratistaNombre} · ${detalle.contratistaDocumento}`],
                  ["Correo de notificación", detalle.correoNotificacion],
                  ...(general
                    ? ([["Referencia", detalle.referencia ?? "—"]] as FilaDatos[])
                    : ([
                        ["Domicilio del contrato (departamento)", detalle.domicilioDepartamento ?? "—"],
                        ...datosTipoParaMostrar(detalle.tipo, detalle.datosTipo),
                      ] as FilaDatos[])),
                  ["Solicitado por", `${detalle.solicitadoPorNombre ?? "—"} · enviado el ${fechaContrato(detalle.enviadoAt)}`],
                ]}
              />

              <TablaDatos
                titulo={general ? "Descripción" : "Objeto y alcance"}
                filas={
                  general
                    ? [
                        ["Descripción", detalle.objeto],
                        ["Observaciones", detalle.observaciones ?? "—"],
                      ]
                    : [
                        ["Objeto", detalle.objeto],
                        ["Obligaciones específicas", <ListaNumerada key="o" items={detalle.obligaciones} />],
                        ["Entregables", <ListaNumerada key="e" items={detalle.entregables} />],
                        ...(detalle.observaciones ? ([["Observaciones", detalle.observaciones]] as FilaDatos[]) : []),
                      ]
                }
              />

              <TablaDatos
                titulo="Valor y pago"
                filas={[
                  ["Valor", <span key="v" className="font-medium tabular-nums">{pesos(detalle.valor)}</span>],
                  ["Modalidad", detalle.anexoTipo === "valor_global" ? "Valor global" : "Valores unitarios (anexo abajo)"],
                  ...(detalle.valorMensual !== null ? ([["Pago mensual", pesosEnLetras(detalle.valorMensual)]] as FilaDatos[]) : []),
                  ...(general
                    ? ([
                        [
                          "Retenciones",
                          `Garantías ${porcentajeTexto(detalle.retencionGarantiaPct)} · Anticipo ${porcentajeTexto(detalle.retencionAnticipoPct)} · FIC ${porcentajeTexto(detalle.retencionFicPct)}`,
                        ],
                      ] as FilaDatos[])
                    : ([["Anticipo", detalle.tieneAnticipo ? anticipoEnLetras(detalle.anticipoPorcentaje ?? 0, detalle.valor) : "No"]] as FilaDatos[])),
                  ["Forma de pago", detalle.formaPago],
                  [
                    "Plazo",
                    plazoTexto(detalle, formatearFechaSinHora) +
                      (detalle.plazoTipo === "duracion" && detalle.fechaInicio ? ` desde ${formatearFechaSinHora(detalle.fechaInicio)} (estimado)` : ""),
                  ],
                ]}
              />

              {detalle.items.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Anexo de valores unitarios</h3>
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
                      <tfoot>
                        <tr className="border-t bg-muted/40 font-medium">
                          <td className="px-2 py-1.5" colSpan={4}>
                            Total
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {pesos(detalle.items.reduce((suma, it) => suma + it.cantidad * it.valorUnitario, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}


              {/* En modo resumen (Control del proyecto) no salen los documentos. */}
              {/* Sin documentos: en modo resumen (Control del proyecto) y en los
                  contratos generales, que son solo una hoja con datos. */}
              {!resumen && !general && (
                <>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Documentos del contrato</h3>
                  <TablaDocumentos>
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
                  </TablaDocumentos>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Documentos generales del contratista</h3>
                  <TablaDocumentos>
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
                  </TablaDocumentos>
                </div>
                </>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Historial</h3>
                <HistorialTimeline tipo="contrato" id={detalle.id} />
              </div>

              {acciones && <div className="flex flex-wrap justify-end gap-2 border-t pt-4">{acciones(detalle)}</div>}
            </div>
          )
        )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Subgerencia devolvió la minuta: el motivo, para que Jurídica la corrija.
function AvisoMinutaDevuelta({ detalle }: { detalle: SolicitudContratoDetalle }) {
  if (detalle.minutaEstado !== "devuelta" || !detalle.minutaMotivo) return null
  return (
    <div className="mb-4 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">
      <p className="font-medium">
        Minuta devuelta por Subgerencia
        {detalle.minutaResueltaPorNombre && ` (${detalle.minutaResueltaPorNombre})`}
        {detalle.minutaResueltaAt && ` el ${fechaContrato(detalle.minutaResueltaAt)}`}
      </p>
      <p className="whitespace-pre-line">Motivo: {detalle.minutaMotivo}</p>
    </div>
  )
}

type FilaDatos = [string, React.ReactNode]

const porcentajeTexto = (v: number) => `${String(v).replace(".", ",")} %`

// Tabla de dos columnas (dato | valor) con su título; la columna del dato es
// fija y gris para leer rápido de arriba abajo.
function TablaDatos({ titulo, filas }: { titulo: string; filas: FilaDatos[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase">{titulo}</h3>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full table-fixed">
          <tbody>
            {filas.map(([dato, valor]) => (
              <tr key={dato} className="border-t first:border-t-0">
                <th scope="row" className="w-2/5 bg-muted/50 px-3 py-2 text-left align-top text-xs font-medium text-muted-foreground sm:w-56">
                  {dato}
                </th>
                <td className="px-3 py-2 align-top break-words whitespace-pre-line">{valor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ListaNumerada({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <ol className="list-decimal space-y-1 pl-5">
      {items.map((t, i) => (
        <li key={i} className="whitespace-pre-line">
          {t}
        </li>
      ))}
    </ol>
  )
}

function TablaDocumentos({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full">
        <thead>
          <tr className="bg-muted/60 text-left text-xs">
            <th className="px-3 py-1.5">Documento</th>
            <th className="px-3 py-1.5">Archivo</th>
            <th className="w-24 px-3 py-1.5 text-center">Estado</th>
            <th className="w-20 px-3 py-1.5" />
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
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
    <tr className="border-t">
      <td className="px-3 py-2">{titulo}</td>
      <td className="max-w-0 px-3 py-2">
        <p className="truncate text-xs text-muted-foreground" title={nombreArchivo}>
          {nombreArchivo ?? "—"}
        </p>
      </td>
      <td className="px-3 py-2 text-center">
        {onVer ? (
          <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-800">
            Adjunto
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={sinArchivo === "Falta" ? "border-transparent bg-red-100 text-red-800" : "border-transparent bg-slate-100 text-slate-700"}
          >
            {sinArchivo}
          </Badge>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {onVer && (
          <Button size="sm" variant="outline" onClick={onVer}>
            <Eye className="size-4" /> Ver
          </Button>
        )}
      </td>
    </tr>
  )
}
