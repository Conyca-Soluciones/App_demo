"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, FileText, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { VisorDocumento } from "@/components/visor-documento"
import { AYUDA_DOBLE_CLIC } from "@/components/ventana-detalle"
import { formatearFechaHora } from "@/lib/fechas"
import { pesos } from "@/lib/contratos"
import {
  ETIQUETA_AUTORIZACION_TERCERO,
  ETIQUETA_TIPO_ACTA,
  numeroActa,
  type AutorizacionTercero,
  type EstadoAutorizacionTercero,
} from "@/lib/actas"
import {
  enlaceAutorizacionTercero,
  listarAutorizacionesTercero,
  resolverAutorizacionTercero,
} from "@/app/(app)/contratos/autorizaciones-terceros/actions"

// ---------------------------------------------------------------------------
// Autorizaciones de pago a otro tercero (20270101000700): cuando un acta pide
// depositar a un tercero distinto del contratista (y del que estipula el
// contrato), Jurídica revisa la autorización firmada y la aprueba (el pago
// pasa a Aprobación de pagos) o la rechaza con motivo (el acta queda
// rechazada y quien la hizo la corrige). ?ver=<acta> la abre (campanita).
// ---------------------------------------------------------------------------

type Filtro = EstadoAutorizacionTercero | "todas"
const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "por_revisar", etiqueta: "Por revisar" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: "todas", etiqueta: "Todas" },
]

const CLASE_ESTADO: Record<EstadoAutorizacionTercero, string> = {
  por_revisar: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  aprobada: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  rechazada: "bg-red-100 text-red-800 hover:bg-red-100",
}

const nombreActa = (a: AutorizacionTercero) => `${ETIQUETA_TIPO_ACTA[a.tipo]} ${numeroActa(a.numero)}`

export function AutorizacionesTerceroView({ puedeResolver, verInicial }: { puedeResolver: boolean; verInicial: string | null }) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<Filtro>(verInicial ? "todas" : "por_revisar")
  const [filas, setFilas] = useState<AutorizacionTercero[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(verInicial)

  function cargar() {
    listarAutorizacionesTercero(filtro === "todas" ? null : filtro)
      .then((l: AutorizacionTercero[]) => setFilas(l))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las autorizaciones."))
  }
  useEffect(cargar, [filtro])

  const detalle = abierta ? (filas ?? []).find((f) => f.actaId === abierta) ?? null : null

  function cerrar() {
    setAbierta(null)
    if (verInicial) router.replace("/contratos/autorizaciones-terceros")
  }

  const columnas: ColumnaExcel<AutorizacionTercero>[] = [
    { clave: "acta", titulo: "Acta", ancho: 110, fija: true, texto: nombreActa, valorOrden: (a) => a.numero },
    { clave: "contrato", titulo: "Contrato", ancho: 150, texto: (a) => a.numeroContrato },
    { clave: "proyecto", titulo: "Proyecto", ancho: 150, texto: (a) => a.proyecto ?? "" },
    { clave: "contratista", titulo: "Contratista", ancho: 220, texto: (a) => a.contratista },
    { clave: "tercero", titulo: "Depositar a", ancho: 240, flexible: true, texto: (a) => a.terceroNombre ?? "" },
    { clave: "neto", titulo: "Neto", ancho: 130, alinear: "right", texto: (a) => pesos(a.neto), valorOrden: (a) => a.neto },
    { clave: "fecha", titulo: "Solicitada", ancho: 150, texto: (a) => formatearFechaHora(a.solicitadaAt), valorOrden: (a) => a.solicitadaAt },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 190,
      alinear: "center",
      texto: (a) => ETIQUETA_AUTORIZACION_TERCERO[a.estado],
      celda: (a) => <Badge className={`min-h-6 px-3 text-xs ${CLASE_ESTADO[a.estado]}`}>{ETIQUETA_AUTORIZACION_TERCERO[a.estado]}</Badge>,
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina
        titulo="Autorizaciones de pago a otro tercero"
        subtitulo="Actas que piden depositar el pago a un tercero distinto del contratista. Al aprobar, el pago pasa a Aprobación de pagos."
      />
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Estado de la autorización">
            {FILTROS.map((f) => (
              <Button
                key={f.valor}
                size="sm"
                role="tab"
                aria-selected={filtro === f.valor}
                variant={filtro === f.valor ? "default" : "outline"}
                onClick={() => {
                  setFilas(null)
                  setError(null)
                  setFiltro(f.valor)
                }}
              >
                {f.etiqueta}
              </Button>
            ))}
          </div>
          {filas && (
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {filas.length} {filas.length === 1 ? "acta" : "actas"}
            </span>
          )}
        </div>
        {aviso && <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!filas ? (
          !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </p>
          )
        ) : filas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay autorizaciones en este estado.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{AYUDA_DOBLE_CLIC}</p>
            <TablaExcel filas={filas} columnas={columnas} claveFila={(a) => a.actaId} onDobleClickFila={(a) => setAbierta(a.actaId)}
              tarjeta={{
                titulo: (a) => `${nombreActa(a)} · ${a.numeroContrato}`,
                subtitulo: (a) => a.contratista,
                esquina: (a) => <Badge className={`min-h-6 px-3 text-xs ${CLASE_ESTADO[a.estado]}`}>{ETIQUETA_AUTORIZACION_TERCERO[a.estado]}</Badge>,
                campos: ["tercero", "neto", "fecha"],
              }}
            />
          </>
        )}
      </main>
      {detalle && (
        <DetalleAutorizacion
          a={detalle}
          puedeResolver={puedeResolver}
          onCerrar={cerrar}
          onResuelta={(texto) => {
            cerrar()
            setAviso(texto)
            setFilas(null)
            cargar()
          }}
        />
      )}
    </div>
  )
}

function DetalleAutorizacion({
  a,
  puedeResolver,
  onCerrar,
  onResuelta,
}: {
  a: AutorizacionTercero
  puedeResolver: boolean
  onCerrar: () => void
  onResuelta: (aviso: string) => void
}) {
  const [verSoporte, setVerSoporte] = useState<AutorizacionTercero["soportes"][number] | null>(a.soportes[0] ?? null)
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const porRevisar = a.estado === "por_revisar" && a.estadoActa === "pendiente"

  async function resolver(accion: "aprobar" | "rechazar") {
    if (accion === "rechazar" && !motivo.trim()) {
      setError("Escribe el motivo del rechazo.")
      return
    }
    setGuardando(true)
    setError(null)
    try {
      await resolverAutorizacionTercero(a.actaId, accion, accion === "rechazar" ? motivo.trim() : undefined)
      onResuelta(
        accion === "aprobar"
          ? `${nombreActa(a)} (${a.numeroContrato}): autorizada. El pago pasó a Aprobación de pagos.`
          : `${nombreActa(a)} (${a.numeroContrato}): no autorizada. Se avisó a quien la hizo.`
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.")
      setGuardando(false)
    }
  }

  const datos: [string, string][] = [
    ["Contrato", `${a.numeroContrato}${a.proyecto ? ` · ${a.proyecto}` : ""}`],
    ["Contratista (quien factura)", `${a.contratista}${a.contratistaDocumento ? ` · ${a.contratistaDocumento}` : ""}`],
    ["Depositar a", `${a.terceroNombre ?? "—"}${a.terceroDocumento ? ` · ${a.terceroDocumento}` : ""}`],
    ["Cuenta", `${a.cuenta ?? "—"}${a.cuenta && !a.cuentaVerificada ? " (sin verificar por A&F)" : ""}`],
    ["Neto del acta", pesos(a.neto)],
    ["Pedida por", `${a.creadoPorNombre ?? "—"} · ${formatearFechaHora(a.solicitadaAt)}`],
  ]
  if (a.resueltaAt) datos.push(["Resuelta", `${a.resueltaPorNombre ?? "—"} · ${formatearFechaHora(a.resueltaAt)}`])
  if (a.motivo) datos.push(["Motivo", a.motivo])

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {nombreActa(a)} · depositar a otro tercero
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-3">
            <dl className="grid gap-2 text-sm">
              {datos.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[10rem_1fr] gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Autorización firmada</p>
              {a.soportes.length === 0 ? (
                <p className="text-sm text-destructive">El acta no tiene el archivo de la autorización.</p>
              ) : (
                a.soportes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setVerSoporte(s)}
                    className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-muted/50 ${
                      verSoporte?.id === s.id ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{s.nombreArchivo}</span>
                  </button>
                ))
              )}
            </div>
            {porRevisar && puedeResolver && rechazando && (
              <div className="space-y-1">
                <label htmlFor="motivo-autorizacion" className="text-xs font-medium text-muted-foreground">
                  Motivo del rechazo *
                </label>
                <Textarea id="motivo-autorizacion" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </div>
            )}
            {porRevisar && !puedeResolver && (
              <p className="text-xs text-muted-foreground">Solo Jurídica (Aprobar contratos) puede resolverla.</p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="min-h-[24rem]">
            {verSoporte ? (
              <VisorDocumento
                titulo="Autorización"
                nombreArchivo={verSoporte.nombreArchivo}
                mime={verSoporte.mime ?? "application/pdf"}
                cargarUrl={() => enlaceAutorizacionTercero(verSoporte.ruta)}
                onVolver={() => setVerSoporte(null)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Elige el archivo para verlo aquí.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cerrar
          </Button>
          {porRevisar && puedeResolver && (
            <>
              {rechazando ? (
                <Button variant="destructive" onClick={() => resolver("rechazar")} disabled={guardando}>
                  {guardando ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
                  Rechazar
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setRechazando(true)} disabled={guardando}>
                  <XCircle className="size-4" /> No autorizar
                </Button>
              )}
              {!rechazando && (
                <Button onClick={() => resolver("aprobar")} disabled={guardando}>
                  {guardando ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Autorizar
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
