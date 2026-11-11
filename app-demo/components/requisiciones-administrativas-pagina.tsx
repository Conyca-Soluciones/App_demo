"use client"

import { useEffect, useState } from "react"
import { Loader2, PackagePlus, Plus, Send, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { HistorialTimeline } from "@/components/historial-timeline"
import { CampoDireccionEntrega } from "@/components/campo-direccion-entrega"
import { validarDireccion } from "@/lib/direccion-entrega"
import { formatearFechaHora, formatearFechaSinHora, hoyColombia } from "@/lib/fechas"
import { nombreUnidad, UNIDADES_MAESTRO } from "@/lib/unidades"
import {
  MAX_LINEAS_REQ_ADMINISTRATIVA,
  etapaReqAdministrativa,
  nombreProyectoReqAdministrativa,
  validarReqAdministrativa,
  type LineaFormReqAdministrativa,
  type ProyectoReqAdministrativa,
  type ReqAdministrativaDetalle,
  type ReqAdministrativaFila,
} from "@/lib/requisiciones-administrativas"
import { buscarInsumosMaestro, type InsumoMaestro } from "@/app/(app)/almacen/actions"
import { crearSolicitudInsumo } from "@/app/(app)/presupuestos/actions"
import {
  cancelarRequisicionAdministrativa,
  crearRequisicionAdministrativa,
  listarMisRequisicionesAdministrativas,
  listarProyectosReqAdministrativa,
  obtenerRequisicionAdministrativa,
} from "@/app/(app)/ayf/requisiciones-administrativas/actions"

type Pestana = "nueva" | "mias"

const formatoCantidad = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

function EtiquetaEtapa({ r }: { r: Pick<ReqAdministrativaFila, "estado" | "estadoCompra"> }) {
  const e = etapaReqAdministrativa(r)
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${e.clase}`}>
      {e.etiqueta}
    </Badge>
  )
}

// Requisiciones administrativas (FUNCIONAMIENTO o un proyecto): pedir insumos que compra
// Compras y no son de una obra, y consultar las mías. ?ver=<id> abre una.
export function RequisicionesAdministrativasPagina({ verInicial }: { verInicial: string | null }) {
  const [pestana, setPestana] = useState<Pestana>(verInicial ? "mias" : "nueva")
  const [version, setVersion] = useState(0)
  const [verId, setVerId] = useState<string | null>(verInicial)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex gap-1.5 border-b">
        {(
          [
            { valor: "nueva", etiqueta: "Realizar requisición" },
            { valor: "mias", etiqueta: "Mis requisiciones" },
          ] as const
        ).map((p) => (
          <button
            key={p.valor}
            type="button"
            onClick={() => setPestana(p.valor)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              pestana === p.valor ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pestana === "nueva" ? (
          <FormularioReqAdministrativa
            key={version}
            onEnviada={(id) => {
              setVersion((v) => v + 1)
              setVerId(id)
              setPestana("mias")
            }}
          />
        ) : (
          <MisRequisiciones key={version} verId={verId} onVer={setVerId} onCerrarVer={() => setVerId(null)} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- formulario
function FormularioReqAdministrativa({ onEnviada }: { onEnviada: (id: string) => void }) {
  const hoy = hoyColombia()
  const [lineas, setLineas] = useState<LineaFormReqAdministrativa[]>([])
  const [proyectos, setProyectos] = useState<ProyectoReqAdministrativa[] | null>(null)
  const [proyectoId, setProyectoId] = useState<string | null>(null)
  const [fechaRequerida, setFechaRequerida] = useState("")
  const [urgente, setUrgente] = useState(false)
  const [observaciones, setObservaciones] = useState("")
  const [direccion, setDireccion] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [solicitando, setSolicitando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    listarProyectosReqAdministrativa()
      .then((lista: ProyectoReqAdministrativa[]) => {
        if (!vigente) return
        setProyectos(lista)
        // Por omisión, FUNCIONAMIENTO.
        setProyectoId((actual) => actual ?? lista.find((p) => p.funcionamiento)?.id ?? null)
      })
      .catch((err) => vigente && setError(err instanceof Error ? err.message : "No se pudieron cargar los proyectos."))
    return () => {
      vigente = false
    }
  }, [])

  async function buscar(termino: string): Promise<OpcionBuscador[]> {
    const lista: InsumoMaestro[] = await buscarInsumosMaestro(termino)
    const yaEstan = new Set(lineas.map((l) => l.insumoId))
    return lista
      .filter((i) => !yaEstan.has(i.id))
      .map((i) => ({ id: i.id, etiqueta: i.descripcion, subetiqueta: `${i.codigo}${i.um ? ` · ${nombreUnidad(i.um)}` : ""}` }))
  }

  function agregar(o: OpcionBuscador | null) {
    if (!o) return
    const [codigo, unidad] = (o.subetiqueta ?? "").split(" · ")
    setLineas((ls) =>
      ls.length >= MAX_LINEAS_REQ_ADMINISTRATIVA
        ? ls
        : [...ls, { insumoId: o.id, codigo: Number(codigo), descripcion: o.etiqueta, unidad: unidad ?? null, cantidad: "" }]
    )
  }

  async function enviar() {
    const e = validarReqAdministrativa(lineas, fechaRequerida, hoy, proyectoId) ?? validarDireccion(direccion)
    if (e) {
      setError(e)
      return
    }
    setEnviando(true)
    setError(null)
    try {
      const r = await crearRequisicionAdministrativa({
        proyectoId: proyectoId!,
        lineas,
        fechaRequerida,
        urgente,
        observaciones,
        direccionEntrega: direccion,
      })
      onEnviada(r.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enviar la requisición.")
    } finally {
      setEnviando(false)
    }
  }

  const columnas: ColumnaExcel<{ l: LineaFormReqAdministrativa; i: number }>[] = [
    { clave: "codigo", titulo: "Código", ancho: 90, texto: ({ l }) => String(l.codigo) },
    { clave: "insumo", titulo: "Insumo", ancho: 320, flexible: true, texto: ({ l }) => l.descripcion },
    { clave: "unidad", titulo: "Unidad", ancho: 110, texto: ({ l }) => l.unidad ?? "" },
    {
      clave: "cantidad",
      titulo: "Cantidad",
      ancho: 130,
      ordenable: false,
      texto: ({ l }) => l.cantidad,
      celda: ({ l, i }) => (
        <Input
          inputMode="numeric"
          value={l.cantidad}
          onChange={(e) => setLineas((ls) => ls.map((x, k) => (k === i ? { ...x, cantidad: e.target.value } : x)))}
          className="h-8 text-right"
          aria-label={`Cantidad de ${l.descripcion}`}
        />
      ),
    },
    {
      clave: "quitar",
      titulo: "",
      ancho: 56,
      ordenable: false,
      texto: () => "",
      celda: ({ i }) => (
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" title="Quitar" aria-label="Quitar insumo" onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))}>
          <Trash2 className="size-4" />
        </Button>
      ),
    },
  ]

  return (
    <div className="max-w-5xl space-y-5">
      <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        Pide para <span className="font-medium text-foreground">FUNCIONAMIENTO</span> (lo que necesita la empresa y no es de una
        obra) o para uno de tus proyectos. No descuenta del presupuesto. La aprueba Subgerencia y después pasa a Compras.
      </p>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Para</Label>
          <Select value={proyectoId ?? ""} onValueChange={(v) => setProyectoId(String(v ?? "") || null)} disabled={!proyectos}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder={proyectos ? "Elige FUNCIONAMIENTO o el proyecto" : "Cargando…"} />
            </SelectTrigger>
            <SelectContent>
              {(proyectos ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {nombreProyectoReqAdministrativa(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Fecha de la requisición</Label>
          <CampoFecha value={hoy} readOnly tabIndex={-1} className="pointer-events-none h-10 bg-muted/40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="req-adm-fecha">Fecha requerida</Label>
          <CampoFecha id="req-adm-fecha" value={fechaRequerida} min={hoy} onChange={(e) => setFechaRequerida(e.target.value)} className="h-10" />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <Checkbox checked={urgente} onCheckedChange={(v) => setUrgente(v === true)} />
          Urgente
        </label>
      </div>

      <div className="space-y-2">
        <Label>Insumos</Label>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-72 flex-1">
            <BuscadorAsync
              placeholder="Busca el insumo en el maestro (nombre o código)"
              valorSeleccionado={null}
              onSeleccionar={agregar}
              buscar={buscar}
              disabled={lineas.length >= MAX_LINEAS_REQ_ADMINISTRATIVA}
            />
          </div>
          <Button variant="outline" onClick={() => setSolicitando(true)}>
            <PackagePlus className="size-4" /> No está: solicitar insumo nuevo
          </Button>
        </div>
        {aviso && <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">{aviso}</p>}
        {lineas.length > 0 ? (
          <TablaExcel
            filas={lineas.map((l, i) => ({ l, i }))}
            columnas={columnas}
            claveFila={(f) => f.l.insumoId}
            tarjeta={{
              titulo: (f) => f.l.descripcion,
              subtitulo: (f) => `${f.l.codigo}${f.l.unidad ? ` · ${f.l.unidad}` : ""}`,
              campos: ["cantidad", "quitar"],
            }}
          />
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            <Plus className="mx-auto mb-1 size-5" /> Busca y agrega los insumos que necesitas.
          </div>
        )}
      </div>

      <CampoDireccionEntrega id="req-adm-direccion" value={direccion} onChange={setDireccion} disabled={enviando} proyectoId={proyectoId} />

      <div className="space-y-1.5">
        <Label htmlFor="req-adm-obs">Observaciones (opcional)</Label>
        <Textarea id="req-adm-obs" rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
      </div>

      {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex justify-end border-t pt-4">
        <Button onClick={enviar} disabled={enviando || lineas.length === 0 || !proyectoId}>
          {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Enviar a aprobación
        </Button>
      </div>

      {solicitando && (
        <SolicitarInsumoDialog
          onCerrar={() => setSolicitando(false)}
          onEnviada={(descripcion) => {
            setSolicitando(false)
            setAviso(
              `Se pidió "${descripcion}" a Aprobación de insumos (Compras). Cuando lo aprueben te llega un aviso en la campanita: búscalo y agrégalo a una requisición.`
            )
          }}
        />
      )}
    </div>
  )
}

// Insumo que no está en el maestro: la misma solicitud que se hace desde el
// presupuesto (Aprobación de insumos le pone tipo, precio e IVA).
function SolicitarInsumoDialog({ onCerrar, onEnviada }: { onCerrar: () => void; onEnviada: (descripcion: string) => void }) {
  const [descripcion, setDescripcion] = useState("")
  const [unidad, setUnidad] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar() {
    if (!descripcion.trim()) return setError("Escribe el nombre del insumo.")
    if (!unidad) return setError("Elige la unidad del insumo.")
    setEnviando(true)
    setError(null)
    try {
      await crearSolicitudInsumo({ descripcion: descripcion.trim(), uM: unidad, presupuestoItemId: null })
      onEnviada(descripcion.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la solicitud.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && !enviando && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Solicitar insumo nuevo</DialogTitle>
          <DialogDescription>
            Va a Aprobación de insumos. Cuando lo aprueben, queda en el maestro y lo puedes agregar a una requisición.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ins-nuevo">Nombre del insumo</Label>
            <Input id="ins-nuevo" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Resma papel carta 75 g" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ins-nuevo-um">Unidad</Label>
            <select
              id="ins-nuevo-um"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Elegir...</option>
              {UNIDADES_MAESTRO.map((u) => (
                <option key={u.texto} value={u.texto}>
                  {u.texto}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={enviando}>
            {enviando && <Loader2 className="size-4 animate-spin" />} Enviar solicitud
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- mis requisiciones
function MisRequisiciones({ verId, onVer, onCerrarVer }: { verId: string | null; onVer: (id: string) => void; onCerrarVer: () => void }) {
  const [datos, setDatos] = useState<{ pagina: number; filas: ReqAdministrativaFila[]; hayMas: boolean } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function cargar(pagina: number) {
    setCargando(true)
    listarMisRequisicionesAdministrativas(pagina)
      .then((r) => {
        setDatos({ pagina, ...r })
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar tus requisiciones."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    let vigente = true
    listarMisRequisicionesAdministrativas(0)
      .then((r) => vigente && setDatos({ pagina: 0, ...r }))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar tus requisiciones."))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [])

  const columnas: ColumnaExcel<ReqAdministrativaFila>[] = [
    { clave: "numero", titulo: "N°", ancho: 80, fija: true, texto: (r) => String(r.numero), valorOrden: (r) => r.numero },
    { clave: "proyecto", titulo: "Para", ancho: 200, texto: (r) => r.proyecto ?? "" },
    { clave: "fecha", titulo: "Fecha", ancho: 170, texto: (r) => formatearFechaHora(r.createdAt), valorOrden: (r) => r.createdAt },
    {
      clave: "requerida",
      titulo: "Fecha requerida",
      ancho: 130,
      texto: (r) => formatearFechaSinHora(r.fechaRequerida),
      valorOrden: (r) => r.fechaRequerida ?? "",
    },
    { clave: "insumos", titulo: "Insumos", ancho: 90, alinear: "right", texto: (r) => String(r.nLineas), valorOrden: (r) => r.nLineas },
    { clave: "urgente", titulo: "Urgente", ancho: 90, alinear: "center", texto: (r) => (r.urgente ? "Sí" : "") },
    { clave: "estado", titulo: "Estado", ancho: 180, texto: (r) => etapaReqAdministrativa(r).etiqueta, celda: (r) => <EtiquetaEtapa r={r} /> },
    { clave: "observaciones", titulo: "Observaciones", ancho: 240, flexible: true, texto: (r) => r.observaciones ?? "" },
  ]

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}
      {cargando && !datos ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </p>
      ) : datos && datos.filas.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Todavía no has hecho requisiciones administrativas.</p>
      ) : datos ? (
        <>
          <TablaExcel
            filas={datos.filas}
            columnas={columnas}
            claveFila={(r) => r.id}
            onDobleClickFila={(r) => onVer(r.id)}
            tituloFila="Doble clic para ver"
            fondoFila={(r) => (r.urgente && r.estado !== "cancelada" ? "bg-amber-50" : undefined)}
            tarjeta={{
              titulo: (r) => `Requisición N° ${r.numero}`,
              subtitulo: (r) => `${r.nLineas} insumo(s) · para el ${formatearFechaSinHora(r.fechaRequerida)}`,
              esquina: (r) => <EtiquetaEtapa r={r} />,
              campos: ["proyecto", "fecha", "observaciones"],
            }}
          />
          <PaginacionSimple pagina={datos.pagina} hayMas={datos.hayMas} cargando={cargando} onCambiar={cargar} />
        </>
      ) : null}

      {verId && (
        <DetalleDialog
          id={verId}
          onCerrar={onCerrarVer}
          onCancelada={() => {
            onCerrarVer()
            cargar(datos?.pagina ?? 0)
          }}
        />
      )}
    </div>
  )
}

function DetalleDialog({ id, onCerrar, onCancelada }: { id: string; onCerrar: () => void; onCancelada: () => void }) {
  const [d, setD] = useState<ReqAdministrativaDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)

  useEffect(() => {
    let vigente = true
    obtenerRequisicionAdministrativa(id)
      .then((r) => vigente && setD(r))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudo cargar la requisición."))
    return () => {
      vigente = false
    }
  }, [id])

  async function cancelar() {
    setProcesando(true)
    setError(null)
    try {
      await cancelarRequisicionAdministrativa(id, motivo)
      onCancelada()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar.")
    } finally {
      setProcesando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="max-h-[92svh] w-[calc(100vw-1rem)] max-w-3xl overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Requisición administrativa {d ? `N° ${d.numero}` : ""}</DialogTitle>
          <DialogDescription>{d?.proyecto ?? ""}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!d ? (
          !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </p>
          )
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Estado</p>
                <EtiquetaEtapa r={d} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Solicita</p>
                <p className="font-medium">{d.solicitante ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fecha</p>
                <p className="font-medium">{formatearFechaHora(d.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fecha requerida</p>
                <p className="font-medium">
                  {formatearFechaSinHora(d.fechaRequerida)}
                  {d.urgente && <span className="ml-1 text-amber-700">· Urgente</span>}
                </p>
              </div>
            </div>
            {d.direccionEntrega && (
              <p className="text-sm">
                <span className="text-muted-foreground">Dirección de entrega:</span> {d.direccionEntrega}
              </p>
            )}
            {d.observaciones && <p className="text-sm"><span className="text-muted-foreground">Observaciones:</span> {d.observaciones}</p>}
            {d.resolucion && (
              <p
                className={`rounded-md border px-3 py-2 text-sm ${
                  d.estado === "rechazada" ? "border-red-300 bg-red-50 text-red-800" : "border-emerald-300 bg-emerald-50 text-emerald-800"
                }`}
              >
                {d.estado === "rechazada" ? "Rechazada" : "Aprobada"} por {d.resolucion.por ?? "Subgerencia"}
                {d.resolucion.at ? ` el ${formatearFechaHora(d.resolucion.at)}` : ""}
                {d.resolucion.motivo ? `. Motivo: ${d.resolucion.motivo}` : "."}
              </p>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-left">Insumo</th>
                  <th className="px-2 py-1.5 text-right">Cantidad</th>
                  <th className="px-2 py-1.5 text-right">Comprado</th>
                </tr>
              </thead>
              <tbody>
                {d.lineas.map((l) => (
                  <tr key={l.id} className="border-b">
                    <td className="px-2 py-1.5">
                      <span className="text-muted-foreground">{l.insumoCodigo}</span> {l.insumoDescripcion}
                      {l.rechazadoCompras && <span className="ml-1 text-xs text-red-700">(rechazado o cerrado por Compras)</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {formatoCantidad(l.cantidad)} {nombreUnidad(l.unidad)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatoCantidad(l.comprado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <p className="mb-2 text-sm font-medium">Historial</p>
              <HistorialTimeline tipo="requisicion" id={d.id} />
            </div>
            {cancelando && (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor="motivo-cancelar">Motivo de la cancelación</Label>
                <Textarea id="motivo-cancelar" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {d?.cancelable &&
            (cancelando ? (
              <Button variant="destructive" onClick={cancelar} disabled={procesando || !motivo.trim()}>
                {procesando && <Loader2 className="size-4 animate-spin" />} Confirmar cancelación
              </Button>
            ) : (
              <Button variant="outline" className="text-destructive" onClick={() => setCancelando(true)}>
                <X className="size-4" /> Cancelar requisición
              </Button>
            ))}
          <Button variant="outline" onClick={onCerrar}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
