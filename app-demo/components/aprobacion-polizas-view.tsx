"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, ExternalLink, Loader2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { PanelVistaPrevia, useVistaPreviaMinuta } from "@/components/minuta-comun"
import { OtrosisDelContrato } from "@/components/otrosis-del-contrato"
import { BadgePolizaContrato } from "@/components/badge-poliza"
import { useProyectoActual } from "@/components/proyecto-provider"
import { formatearFechaSinHora } from "@/lib/fechas"
import { pesos } from "@/lib/contratos"
import {
  CLASE_ESTADO_POLIZA,
  ETIQUETA_ESTADO_POLIZA,
  tipoContratoPoliza,
  type EstadoPoliza,
  type Poliza,
  type PolizaConContrato,
} from "@/lib/polizas"
import {
  enlacePoliza,
  listarPolizasAprobacion,
  obtenerPoliza,
  polizaPorRevisarDeContrato,
  polizasDeContrato,
  resolverPoliza,
} from "@/app/(app)/contratos/polizas/actions"

// ---------------------------------------------------------------------------
// Aprobación de pólizas (ruta /contratos/aprobacion-polizas): Jurídica ve las
// pólizas que suben los ingenieros (de todos los proyectos que ve) y, al abrir
// una, la póliza, el contrato en PDF y los datos del contrato y del
// contratista. La aprueba (ya se pueden hacer actas) o la devuelve con motivo
// (el ingeniero sube otra). ?ver=<id del contrato> (campanita) abre la que
// está por revisar de ese contrato.
// ---------------------------------------------------------------------------

type Filtro = "por_revisar" | "aprobada" | "devuelta" | "todas"
const FILTROS: { valor: Filtro; etiqueta: string }[] = [
  { valor: "por_revisar", etiqueta: "Por revisar" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "devuelta", etiqueta: "Devueltas" },
  { valor: "todas", etiqueta: "Todas" },
]

export function AprobacionPolizasView({ puedeResolver, verInicial }: { puedeResolver: boolean; verInicial: string | null }) {
  const router = useRouter()
  const { proyectos } = useProyectoActual()
  const [filtro, setFiltro] = useState<Filtro>("por_revisar")
  const [proyectoId, setProyectoId] = useState("")
  const [polizas, setPolizas] = useState<PolizaConContrato[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  function cargar() {
    listarPolizasAprobacion(filtro === "todas" ? undefined : [filtro as EstadoPoliza])
      .then((lista: PolizaConContrato[]) => setPolizas(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las pólizas."))
  }
  useEffect(cargar, [filtro])

  // Desde un aviso: la póliza por revisar del contrato.
  useEffect(() => {
    if (!verInicial) return
    polizaPorRevisarDeContrato(verInicial)
      .then((id) => (id ? setDetalleId(id) : setError("Ese contrato no tiene pólizas.")))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo abrir la póliza."))
  }, [verInicial])

  // Filtro de proyecto en el navegador (la lista ya viene acotada a lo que el usuario ve).
  const visibles = useMemo(
    () => (polizas && proyectoId ? polizas.filter((p) => p.contrato.proyectoId === proyectoId) : polizas),
    [polizas, proyectoId]
  )

  const columnas: ColumnaExcel<PolizaConContrato>[] = useMemo(
    () => [
      {
        clave: "contrato",
        titulo: "Contrato",
        ancho: 130,
        fija: true,
        texto: (p) => p.contrato.numeroContrato,
        celda: (p) => (
          <button
            type="button"
            onClick={() => setDetalleId(p.id)}
            title={`Revisar la póliza del contrato ${p.contrato.numeroContrato}`}
            className="cursor-pointer rounded-sm font-medium tabular-nums text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            {p.contrato.numeroContrato}
          </button>
        ),
      },
      { clave: "proyecto", titulo: "Proyecto", ancho: 130, texto: (p) => p.contrato.proyectoCodigo ?? p.contrato.proyectoNombre ?? "" },
      { clave: "tipo", titulo: "Tipo", ancho: 160, texto: (p) => tipoContratoPoliza(p.contrato) },
      { clave: "contratista", titulo: "Contratista", ancho: 210, flexible: true, texto: (p) => p.contrato.contratista.nombre },
      { clave: "valor", titulo: "Valor", ancho: 140, alinear: "right", texto: (p) => pesos(p.contrato.valor), claseCelda: "tabular-nums" },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 130,
        alinear: "center",
        texto: (p) => ETIQUETA_ESTADO_POLIZA[p.estado],
        celda: (p) => (
          <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_POLIZA[p.estado]}`}>
            {ETIQUETA_ESTADO_POLIZA[p.estado]}
          </Badge>
        ),
      },
      { clave: "subida", titulo: "Subida por", ancho: 150, texto: (p) => p.subidaPorNombre ?? "" },
      { clave: "fecha", titulo: "Subida", ancho: 110, texto: (p) => fechaContrato(p.createdAt), claseCelda: "tabular-nums" },
    ],
    []
  )

  function cerrarDetalle() {
    setDetalleId(null)
    if (verInicial) router.replace("/contratos/aprobacion-polizas")
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina titulo="Aprobación de pólizas" subtitulo="Jurídica revisa la póliza de cada contrato y la aprueba o la devuelve al ingeniero." />
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Estado de la póliza">
            {FILTROS.map((f) => (
              <Button
                key={f.valor}
                size="sm"
                role="tab"
                aria-selected={filtro === f.valor}
                variant={filtro === f.valor ? "default" : "outline"}
                onClick={() => {
                  setPolizas(null)
                  setError(null)
                  setFiltro(f.valor)
                }}
              >
                {f.etiqueta}
              </Button>
            ))}
          </div>
          <select
            aria-label="Proyecto"
            value={proyectoId}
            onChange={(e) => setProyectoId(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">Todos los proyectos</option>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre}
              </option>
            ))}
          </select>
          {visibles && (
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {visibles.length} {visibles.length === 1 ? "póliza" : "pólizas"}
            </span>
          )}
        </div>

        {aviso && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" /> {aviso}
          </div>
        )}
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

        {visibles === null && !error ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando pólizas...
          </div>
        ) : visibles && visibles.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            No hay pólizas con este filtro.
          </div>
        ) : (
          visibles && (
            <TablaExcel
              filas={visibles}
              columnas={columnas}
              claveFila={(p) => p.id}
              onDobleClickFila={(p) => setDetalleId(p.id)}
              tituloFila="Doble clic para revisar la póliza"
              tarjeta={{
                titulo: (p) => (
                  <button type="button" className="text-left hover:underline" onClick={() => setDetalleId(p.id)}>
                    {p.contrato.numeroContrato} · {p.contrato.contratista.nombre}
                  </button>
                ),
                subtitulo: (p) => `${tipoContratoPoliza(p.contrato)} · ${p.contrato.proyectoCodigo ?? p.contrato.proyectoNombre ?? ""}`,
                esquina: (p) => columnas.find((c) => c.clave === "estado")!.celda!(p),
                campos: ["valor", "subida", "fecha"],
              }}
            />
          )
        )}
      </main>

      <DetallePoliza
        id={detalleId}
        puedeResolver={puedeResolver}
        onCerrar={cerrarDetalle}
        onResuelta={(texto) => {
          setAviso(texto)
          cerrarDetalle()
          cargar()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------- detalle
type Pestana = "poliza" | "contrato" | "informacion"

function DetallePoliza({
  id,
  puedeResolver,
  onCerrar,
  onResuelta,
}: {
  id: string | null
  puedeResolver: boolean
  onCerrar: () => void
  onResuelta: (aviso: string) => void
}) {
  const [carga, setCarga] = useState<{ id: string; poliza: PolizaConContrato | null; error: string | null } | null>(null)
  const [pestana, setPestana] = useState<Pestana>("poliza")
  const [accion, setAccion] = useState<"aprobar" | "devolver" | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  // Al abrir otra póliza, se vuelve a la primera pestaña.
  const [idPrevio, setIdPrevio] = useState(id)
  if (id !== idPrevio) {
    setIdPrevio(id)
    setPestana("poliza")
  }

  useEffect(() => {
    if (!id) return
    let cancelado = false
    obtenerPoliza(id)
      .then((poliza) => !cancelado && setCarga({ id, poliza, error: null }))
      .catch((e) => !cancelado && setCarga({ id, poliza: null, error: e instanceof Error ? e.message : "No se pudo abrir la póliza." }))
    return () => {
      cancelado = true
    }
  }, [id])

  const actual = carga && carga.id === id ? carga : null
  const p = actual?.poliza ?? null

  async function confirmar() {
    if (!accion || !p) return
    if (accion === "devolver" && !motivo.trim()) {
      setErrorAccion("Escribe el motivo.")
      return
    }
    setProcesando(true)
    setErrorAccion(null)
    try {
      await resolverPoliza(p.id, accion, motivo)
      onResuelta(
        accion === "aprobar"
          ? `Póliza del contrato ${p.contrato.numeroContrato} aprobada: ya se pueden hacer actas.`
          : `Póliza del contrato ${p.contrato.numeroContrato} devuelta al ingeniero.`
      )
      setAccion(null)
      setMotivo("")
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : "No se pudo completar la acción.")
    } finally {
      setProcesando(false)
    }
  }

  return (
    <>
      <Dialog open={id !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
        <DialogContent className="flex h-[96svh] max-h-[96svh] w-[calc(100vw-1rem)] max-w-6xl flex-col gap-3 overflow-hidden sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{p ? `Póliza · contrato ${p.contrato.numeroContrato} · ${p.contrato.contratista.nombre}` : "Póliza"}</DialogTitle>
          </DialogHeader>
          {!actual ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Cargando...
            </div>
          ) : !p ? (
            <p className="text-sm text-destructive">{actual.error}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1" role="tablist">
                  {(
                    [
                      ["poliza", "Póliza"],
                      ["contrato", "Contrato"],
                      ["informacion", "Contrato y contratista"],
                    ] as [Pestana, string][]
                  ).map(([v, t]) => (
                    <Button key={v} size="sm" role="tab" aria-selected={pestana === v} variant={pestana === v ? "default" : "outline"} onClick={() => setPestana(v)}>
                      {t}
                    </Button>
                  ))}
                </div>
                <Badge variant="outline" className={`ml-auto h-6 px-3 text-xs ${CLASE_ESTADO_POLIZA[p.estado]}`}>
                  {ETIQUETA_ESTADO_POLIZA[p.estado]}
                </Badge>
              </div>
              {p.estado === "devuelta" && p.motivo && (
                <p className="rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">Devuelta: {p.motivo}</p>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
                {pestana === "poliza" ? (
                  <ArchivoPoliza poliza={p} />
                ) : pestana === "contrato" ? (
                  <PdfContrato id={p.contrato.id} />
                ) : (
                  <InformacionContrato poliza={p} />
                )}
              </div>
              {puedeResolver && p.estado === "por_revisar" && (
                <DialogFooter>
                  <Button variant="outline" className="border-orange-300 text-orange-800 hover:bg-orange-50" onClick={() => setAccion("devolver")}>
                    <Undo2 className="size-4" /> Devolver al ingeniero
                  </Button>
                  <Button onClick={() => setAccion("aprobar")}>
                    <CheckCircle2 className="size-4" /> Aprobar póliza
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={accion !== null}
        onOpenChange={(abierto) => {
          if (!abierto && !procesando) {
            setAccion(null)
            setMotivo("")
            setErrorAccion(null)
          }
        }}
      >
        <DialogContent>
          {accion && p && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {accion === "aprobar" ? "Aprobar póliza" : "Devolver póliza"} · contrato {p.contrato.numeroContrato}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {accion === "aprobar"
                  ? "El contrato queda con la póliza aprobada y ya se pueden hacer actas. Quien la subió y el director reciben una notificación."
                  : "El contrato vuelve a quedar con la póliza pendiente; quien la subió y el director reciben el motivo y suben otra."}
              </p>
              {accion === "devolver" && (
                <div className="space-y-1">
                  <label htmlFor="motivo-poliza" className="text-xs font-medium text-muted-foreground">
                    Motivo *
                  </label>
                  <textarea
                    id="motivo-poliza"
                    rows={3}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    autoFocus
                    disabled={procesando}
                    placeholder="Qué le falta o qué debe corregir la póliza"
                    maxLength={2000}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
              )}
              {errorAccion && <p className="text-sm text-destructive">{errorAccion}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setAccion(null)} disabled={procesando}>
                  Cancelar
                </Button>
                <Button onClick={confirmar} disabled={procesando || (accion === "devolver" && !motivo.trim())}>
                  {procesando && <Loader2 className="size-4 animate-spin" />}
                  {accion === "aprobar" ? "Aprobar" : "Devolver"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

// El archivo de la póliza (enlace firmado de 2 minutos): PDF en iframe, imagen en img.
function ArchivoPoliza({ poliza }: { poliza: Poliza }) {
  const [carga, setCarga] = useState<{ id: string; url: string | null; error: string | null } | null>(null)
  useEffect(() => {
    let cancelado = false
    enlacePoliza(poliza.id)
      .then((url) => !cancelado && setCarga({ id: poliza.id, url, error: null }))
      .catch((e) => !cancelado && setCarga({ id: poliza.id, url: null, error: e instanceof Error ? e.message : "No se pudo abrir la póliza." }))
    return () => {
      cancelado = true
    }
  }, [poliza.id])
  const actual = carga?.id === poliza.id ? carga : null

  return (
    <div className="flex h-full min-h-[60svh] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate" title={poliza.nombreArchivo}>
          {poliza.nombreArchivo}
          <span className="block text-xs text-muted-foreground">
            Subida por {poliza.subidaPorNombre ?? "—"} · {fechaContrato(poliza.createdAt)}
          </span>
        </span>
        {actual?.url && (
          <a href={actual.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted">
            <ExternalLink className="size-4" /> Abrir aparte
          </a>
        )}
      </div>
      {!actual ? (
        <div className="flex flex-1 items-center justify-center rounded-md border text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Cargando póliza...
        </div>
      ) : actual.error || !actual.url ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{actual.error}</p>
      ) : poliza.mime.startsWith("image/") ? (
        <div className="flex flex-1 items-center justify-center overflow-auto rounded-md border bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado temporal de Storage */}
          <img src={actual.url} alt="Póliza" className="max-h-full max-w-full object-contain" />
        </div>
      ) : (
        <iframe src={actual.url} title="Póliza" className="min-h-[60svh] w-full flex-1 rounded-md border bg-muted/30" />
      )}
    </div>
  )
}

const SIN_CAMBIOS = {}
// El contrato aprobado en PDF (su minuta guardada o la hoja del general).
function PdfContrato({ id }: { id: string }) {
  const vista = useVistaPreviaMinuta(id, SIN_CAMBIOS, null, `/contratos/otrosi-pdf/contrato/${id}`)
  return <PanelVistaPrevia {...vista} />
}

function InformacionContrato({ poliza }: { poliza: PolizaConContrato }) {
  const c = poliza.contrato
  const k = c.contratista
  const [historial, setHistorial] = useState<{ id: string; polizas: Poliza[] } | null>(null)
  useEffect(() => {
    let cancelado = false
    polizasDeContrato(c.id)
      .then((d) => !cancelado && setHistorial({ id: c.id, polizas: d.polizas }))
      .catch(() => !cancelado && setHistorial({ id: c.id, polizas: [] }))
    return () => {
      cancelado = true
    }
  }, [c.id])

  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2">
      <Tabla
        titulo="Contrato"
        filas={[
          ["Contrato", c.numeroContrato],
          ["Estado de la póliza", <BadgePolizaContrato key="e" estado={c.polizaEstado} />],
          ["Tipo", tipoContratoPoliza(c)],
          ["Proyecto", [c.proyectoCodigo, c.proyectoNombre].filter(Boolean).join(" — ")],
          ["Objeto", c.objeto],
          ["Valor vigente", pesos(c.valor)],
          ["Inicio", c.fechaInicio ? formatearFechaSinHora(c.fechaInicio) : "—"],
          ["Fin del plazo vigente", c.fechaFin ? formatearFechaSinHora(c.fechaFin) : "Sin fecha"],
          ["Aprobado por Subgerencia", c.aprobadoAt ? fechaContrato(c.aprobadoAt) : "—"],
          ["Solicitado por", c.solicitadoPorNombre ?? "—"],
        ]}
      />
      <Tabla
        titulo="Contratista"
        filas={[
          ["Nombre", k.nombre],
          ["Persona", k.tipoPersona === "juridica" ? "Jurídica" : "Natural"],
          ["Documento", k.documento],
          ...(k.representanteNombre
            ? ([["Representante legal", [k.representanteNombre, k.representanteDocumento].filter(Boolean).join(" · ")]] as [string, React.ReactNode][])
            : []),
          ["Dirección", k.direccion ?? "—"],
          ["Ciudad", k.ciudad ?? "—"],
          ["Teléfono", k.telefono ?? "—"],
          ["Correo", k.correo ?? "—"],
        ]}
      />
      <div className="space-y-2 lg:col-span-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">Otrosí del contrato</h3>
        <OtrosisDelContrato contratoId={c.id} />
      </div>
      <div className="space-y-2 lg:col-span-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">Pólizas del contrato</h3>
        {!historial || historial.id !== c.id ? (
          <p className="text-muted-foreground">Cargando…</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {historial.polizas.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {x.nombreArchivo}
                  <span className="block text-xs text-muted-foreground">
                    {x.subidaPorNombre ?? "—"} · {fechaContrato(x.createdAt)}
                    {x.motivo && ` · Motivo: ${x.motivo}`}
                  </span>
                </span>
                <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_POLIZA[x.estado]}`}>
                  {ETIQUETA_ESTADO_POLIZA[x.estado]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
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
