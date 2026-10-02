"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Eye, Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { SolicitudContratoForm } from "@/components/solicitud-contrato-form"
import { VisorDocumento } from "@/components/visor-documento"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import { ZONA_HORARIA, formatearFechaSinHora } from "@/lib/fechas"
import { ETIQUETA_ESTADO_CONTRATO, TIPO_CONTRATO_POR_VALOR, numero, pesos, plazoTexto } from "@/lib/contratos"
import {
  enlaceDocumentoContrato,
  listarSolicitudesContrato,
  obtenerSolicitudContrato,
  type SolicitudContratoDetalle,
  type SolicitudContratoFila,
} from "@/app/(app)/contratos/solicitar/actions"

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { timeZone: ZONA_HORARIA, day: "2-digit", month: "2-digit", year: "numeric" })
const tituloTipo = (t: string) => TIPO_CONTRATO_POR_VALOR.get(t as never)?.titulo ?? t


export function SolicitudesContratosView({ puedeSolicitar }: { puedeSolicitar: boolean }) {
  const proyecto = useProyectoActual().proyecto
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina
        titulo="Solicitud de contratos"
        subtitulo="Arma la solicitud del contrato y mándala a pre-aprobación de Jurídica."
        conProyecto
      />
      {proyecto ? (
        // key: al cambiar de proyecto se limpia todo (lista y formulario a medias).
        <Solicitudes key={proyecto.id} proyectoId={proyecto.id} proyectoNombre={proyecto.nombre} puedeSolicitar={puedeSolicitar} />
      ) : (
        <div className="p-4 sm:p-6">
          <SinProyecto />
        </div>
      )}
    </div>
  )
}

function Solicitudes({
  proyectoId,
  proyectoNombre,
  puedeSolicitar,
}: {
  proyectoId: string
  proyectoNombre: string
  puedeSolicitar: boolean
}) {
  const [solicitudes, setSolicitudes] = useState<SolicitudContratoFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formulario, setFormulario] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  function cargar() {
    listarSolicitudesContrato(proyectoId)
      .then((lista: SolicitudContratoFila[]) => setSolicitudes(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las solicitudes."))
  }
  useEffect(cargar, [proyectoId])

  const columnas: ColumnaExcel<SolicitudContratoFila>[] = useMemo(
    () => [
      { clave: "numero", titulo: "N°", ancho: 70, fija: true, alinear: "right", texto: (s) => String(s.numero), claseCelda: "tabular-nums" },
      { clave: "tipo", titulo: "Tipo", ancho: 170, texto: (s) => tituloTipo(s.tipo) },
      { clave: "contratista", titulo: "Contratista", ancho: 220, texto: (s) => s.contratistaNombre },
      { clave: "objeto", titulo: "Objeto", ancho: 260, flexible: true, texto: (s) => s.objeto },
      { clave: "valor", titulo: "Valor", ancho: 150, alinear: "right", texto: (s) => pesos(s.valor), claseCelda: "tabular-nums" },
      { clave: "plazo", titulo: "Plazo", ancho: 190, texto: (s) => plazoTexto(s, formatearFechaSinHora) },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 150,
        alinear: "center",
        texto: (s) => ETIQUETA_ESTADO_CONTRATO[s.estado],
        celda: (s) => (
          <Badge variant="outline" className="border-transparent bg-amber-100 text-amber-800">
            {ETIQUETA_ESTADO_CONTRATO[s.estado]}
          </Badge>
        ),
      },
      { clave: "solicitante", titulo: "Solicitado por", ancho: 150, texto: (s) => s.solicitadoPorNombre ?? "" },
      { clave: "fecha", titulo: "Fecha", ancho: 110, texto: (s) => fechaHora(s.createdAt), claseCelda: "tabular-nums" },
    ],
    []
  )

  if (formulario) {
    return (
      <main className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4 sm:p-6">
        <SolicitudContratoForm
          proyectoId={proyectoId}
          proyectoNombre={proyectoNombre}
          onCancelar={() => setFormulario(false)}
          onEnviada={(n) => {
            setFormulario(false)
            setAviso(`Solicitud N° ${n} enviada a pre-aprobación.`)
            cargar()
          }}
        />
      </main>
    )
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        {solicitudes && <span className="text-sm text-muted-foreground tabular-nums">{solicitudes.length} {solicitudes.length === 1 ? "solicitud" : "solicitudes"}</span>}
        {puedeSolicitar && (
          <Button className="ml-auto" onClick={() => { setAviso(null); setFormulario(true) }}>
            <Plus className="size-4" /> Nueva solicitud
          </Button>
        )}
      </div>

      {aviso && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="size-4" /> {aviso}
        </div>
      )}
      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

      {solicitudes === null && !error ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Cargando solicitudes...
        </div>
      ) : solicitudes && solicitudes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p>Este proyecto todavía no tiene solicitudes de contrato.</p>
          {puedeSolicitar && (
            <Button variant="outline" onClick={() => setFormulario(true)}>
              <Plus className="size-4" /> Crear la primera
            </Button>
          )}
        </div>
      ) : (
        solicitudes && (
          <TablaExcel
            filas={solicitudes}
            columnas={columnas}
            claveFila={(s) => s.id}
            onDobleClickFila={(s) => setDetalleId(s.id)}
            tituloFila="Doble clic para ver la solicitud"
            tarjeta={{
              titulo: (s) => (
                <button type="button" className="text-left hover:underline" onClick={() => setDetalleId(s.id)}>
                  N° {s.numero} · {s.contratistaNombre}
                </button>
              ),
              subtitulo: (s) => tituloTipo(s.tipo),
              esquina: (s) => columnas.find((c) => c.clave === "estado")!.celda!(s),
              campos: ["objeto", "valor", "plazo", "solicitante"],
            }}
          />
        )
      )}

      <DetalleSolicitud id={detalleId} onCerrar={() => setDetalleId(null)} />
    </main>
  )
}

function DetalleSolicitud({ id, onCerrar }: { id: string | null; onCerrar: () => void }) {
  const [detalle, setDetalle] = useState<SolicitudContratoDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Documento abierto en el visor (dentro del mismo diálogo).
  const [viendo, setViendo] = useState<{ id: string; titulo: string; nombreArchivo: string; mime: string } | null>(null)

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

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(abierto) => {
        if (!abierto) {
          setDetalle(null)
          setError(null)
          setViendo(null)
          onCerrar()
        }
      }}
    >
      <DialogContent className={`max-h-[92svh] overflow-y-auto ${viendo ? "sm:max-w-5xl" : "sm:max-w-3xl"}`}>
        <DialogHeader>
          <DialogTitle>{detalle ? `Solicitud N° ${detalle.numero} · ${tituloTipo(detalle.tipo)}` : "Solicitud de contrato"}</DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {viendo ? (
          <VisorDocumento
            titulo={viendo.titulo}
            nombreArchivo={viendo.nombreArchivo}
            mime={viendo.mime}
            cargarUrl={() => enlaceDocumentoContrato(viendo.id)}
            onVolver={() => setViendo(null)}
          />
        ) : !detalle && !error ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando...
          </div>
        ) : (
          detalle && (
            <div className="space-y-5 text-sm">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {(
                  [
                    ["Estado", ETIQUETA_ESTADO_CONTRATO[detalle.estado]],
                    ["Contratista", `${detalle.contratistaNombre} · ${detalle.contratistaDocumento}`],
                    ["Valor", `${pesos(detalle.valor)} (${detalle.anexoTipo === "valor_global" ? "valor global" : "valores unitarios"})`],
                    ["Anticipo", detalle.tieneAnticipo ? `${numero(detalle.anticipoPorcentaje ?? 0)} % = ${pesos((detalle.valor * (detalle.anticipoPorcentaje ?? 0)) / 100)}` : "No"],
                    ["Plazo", plazoTexto(detalle, formatearFechaSinHora) + (detalle.plazoTipo === "duracion" && detalle.fechaInicio ? ` desde ${formatearFechaSinHora(detalle.fechaInicio)} (estimado)` : "")],
                    ["Correo de notificación", detalle.correoNotificacion],
                    ["Solicitado por", `${detalle.solicitadoPorNombre ?? "—"} el ${fechaHora(detalle.createdAt)}`],
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
                  <table className="w-full min-w-[520px]">
                    <thead>
                      <tr className="bg-muted/60 text-left text-xs">
                        <th className="px-2 py-1.5">Actividad</th>
                        <th className="px-2 py-1.5">Unidad</th>
                        <th className="px-2 py-1.5 text-right">Cantidad</th>
                        <th className="px-2 py-1.5 text-right">Valor unitario</th>
                        <th className="px-2 py-1.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalle.items.map((it, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-2 py-1.5">{it.actividad}</td>
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
                      <li key={req.tipo} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p>{req.titulo}</p>
                          {doc && <p className="truncate text-xs text-muted-foreground" title={doc.nombreArchivo}>{doc.nombreArchivo}</p>}
                        </div>
                        {doc ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setViendo({ id: doc.id, titulo: req.titulo, nombreArchivo: doc.nombreArchivo, mime: doc.mime })}
                          >
                            <Eye className="size-4" />
                            Ver
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">No aplica</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
