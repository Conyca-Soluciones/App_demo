"use client"
// app/(app)/almacen/registro-requisiciones/page.tsx
import { useEffect, useState } from "react"
import { ChevronLeft, Filter } from "lucide-react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { HistorialDialog } from "@/components/historial-timeline"
import { createClient } from "@/lib/supabase/client"
import { leerCantidadEntera } from "@/lib/numeros"
import { formatearFechaSinHora } from "@/lib/fechas"

import { buscarUsuarios, buscarInsumosCompras } from "../comprar-pedidos/actions"
import {
  verProyectos,
  verRegistroRequisiciones,
  cancelarPedido,
  modificarPedido,
  type PedidoRegistro,
  type FiltrosRegistro,
} from "../actions"

const headClasses =
  "border-r bg-primary px-3 py-2.5 text-left text-xs font-medium text-primary-foreground last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

type Estado = NonNullable<FiltrosRegistro["estado"]>

const ESTADOS: { valor: Estado | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "pendiente", etiqueta: "Pendiente" },
  { valor: "aprobado", etiqueta: "Aprobado" },
  { valor: "rechazado", etiqueta: "Rechazado" },
  { valor: "cancelado", etiqueta: "Cancelado" },
]

// Adaptadores: las server actions devuelven su propia forma de fila; el
// buscador genérico espera { id, etiqueta, subetiqueta }.
async function buscarUsuariosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const usuarios = await buscarUsuarios(termino)
  return usuarios.map((u) => ({ id: u.id, etiqueta: u.nombre }))
}

async function buscarInsumosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const insumos = await buscarInsumosCompras(termino)
  return insumos.map((i) => ({
    id: i.id,
    etiqueta: i.descripcion,
    subetiqueta: `${i.codigo} · ${i.u_m ?? ""}`,
  }))
}

function BadgeEstado({ estado }: { estado: PedidoRegistro["estado"] }) {
  const estilos = {
    pendiente: "bg-amber-100 text-amber-800",
    aprobado: "bg-emerald-100 text-emerald-800",
    rechazado: "bg-red-100 text-red-800",
    cancelado: "bg-slate-200 text-slate-700",
  } as const
  const etiquetas = {
    pendiente: "Pendiente",
    aprobado: "Aprobado",
    rechazado: "Rechazado",
    cancelado: "Cancelado",
  } as const

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estilos[estado]}`}>
      {etiquetas[estado]}
    </span>
  )
}

export default function RegistroRequisiciones() {
  const [error, setError] = useState<string | null>(null)
  const [usuarioId, setUsuarioId] = useState<string | null>(null)

  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [pedidos, setPedidos] = useState<PedidoRegistro[] | null>(null)
  const [truncado, setTruncado] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(true)
  const [filtrosUsados, setFiltrosUsados] = useState<FiltrosRegistro>({})

  // Filtros (todos opcionales)
  const [proyectos, setProyectos] = useState<{ id: string; codigo: string | null; nombre: string }[]>([])
  const [proyectoId, setProyectoId] = useState<string>("todos")
  const [insumo, setInsumo] = useState<OpcionBuscador | null>(null)
  const [estado, setEstado] = useState<Estado | "todos">("todos")
  const [solicitante, setSolicitante] = useState<OpcionBuscador | null>(null)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  // Cancelar / modificar una requisición propia pendiente, y ver su historial.
  const [cancelando, setCancelando] = useState<PedidoRegistro | null>(null)
  const [motivoCancelacion, setMotivoCancelacion] = useState("")
  const [procesandoCancelacion, setProcesandoCancelacion] = useState(false)
  const [modificando, setModificando] = useState<PedidoRegistro | null>(null)
  const [edCantidad, setEdCantidad] = useState("")
  const [edFecha, setEdFecha] = useState("")
  const [edUrgente, setEdUrgente] = useState(false)
  const [edObservaciones, setEdObservaciones] = useState("")
  const [procesandoEdicion, setProcesandoEdicion] = useState(false)
  const [historialPedido, setHistorialPedido] = useState<PedidoRegistro | null>(null)

  useEffect(() => {
    const supabase = createClient()
    // getClaims valida el token localmente; getUser hacía una llamada a Supabase Auth.
    supabase.auth.getClaims().then(({ data }) => setUsuarioId(data?.claims?.sub ?? null))
  }, [])

  useEffect(() => {
    verProyectos()
      .then(setProyectos)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos.")
      )
  }, [])

  function consultar(filtros: FiltrosRegistro) {
    setCargando(true)
    setError(null)
    verRegistroRequisiciones(filtros)
      .then((r) => {
        setPedidos(r.filas)
        setTruncado(r.truncado)
        setFiltrosUsados(filtros)
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudo cargar el registro de requisiciones.")
      )
      .finally(() => setCargando(false))
  }

  function handleConsultar() {
    consultar({
      proyectoId: proyectoId === "todos" ? undefined : proyectoId,
      insumoId: insumo?.id,
      estado: estado === "todos" ? undefined : estado,
      solicitadoPorId: solicitante?.id,
      desde: desde || undefined,
      hasta: hasta || undefined,
    })
  }

  // Tras cancelar o modificar se repite la última consulta.
  const recargar = () => consultar(filtrosUsados)

  function limpiarFiltros() {
    setProyectoId("todos")
    setInsumo(null)
    setEstado("todos")
    setSolicitante(null)
    setDesde("")
    setHasta("")
  }

  async function confirmarCancelacion() {
    if (!cancelando || !motivoCancelacion.trim()) return
    setProcesandoCancelacion(true)
    setError(null)
    try {
      await cancelarPedido(cancelando.id, motivoCancelacion.trim())
      setCancelando(null)
      setMotivoCancelacion("")
      recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar la requisición.")
      setCancelando(null)
    } finally {
      setProcesandoCancelacion(false)
    }
  }

  function abrirModificar(p: PedidoRegistro) {
    setError(null)
    setModificando(p)
    setEdCantidad(String(p.cantidad))
    setEdFecha(p.fechaRequerida.slice(0, 10))
    setEdUrgente(p.urgente)
    setEdObservaciones(p.observaciones ?? "")
  }

  async function confirmarModificacion() {
    if (!modificando) return
    // Solo enteros (ver lib/numeros.ts): "1.500" es 1500, "1,5" se rechaza.
    const leida = leerCantidadEntera(edCantidad)
    const cantidad = leida.ok ? leida.valor : NaN
    if (!leida.ok || cantidad <= 0) {
      setError(leida.ok ? "La cantidad debe ser mayor que cero." : leida.error)
      setModificando(null)
      return
    }
    setProcesandoEdicion(true)
    setError(null)
    try {
      await modificarPedido(modificando.id, {
        cantidad,
        fechaRequerida: edFecha,
        urgente: edUrgente,
        observaciones: edObservaciones.trim() || null,
      })
      setModificando(null)
      recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo modificar la requisición.")
      setModificando(null)
    } finally {
      setProcesandoEdicion(false)
    }
  }

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Registro de requisiciones</h1>
          <p className="text-sm text-muted-foreground">
            Requisiciones de todos los proyectos a los que tienes acceso.
          </p>
        </div>
      </header>

      <main className="flex w-full flex-1 gap-4 p-6">
        {filtrosAbiertos ? (
          <div className="h-fit w-full max-w-xs shrink-0 rounded-lg border bg-card">
            <div className="flex items-center justify-between rounded-t-lg bg-primary px-4 py-3 text-primary-foreground">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <span className="font-medium">Filtros</span>
              </div>
              <button
                type="button"
                onClick={() => setFiltrosAbiertos(false)}
                className="rounded p-1 hover:bg-primary-foreground/10"
                title="Ocultar filtros"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label>Proyecto</Label>
                <Select value={proyectoId} onValueChange={(v) => setProyectoId(v ?? "todos")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos mis proyectos</SelectItem>
                    {proyectos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.codigo ? `${p.codigo} · ${p.nombre}` : p.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Insumo</Label>
                <BuscadorAsync
                  placeholder="Buscar insumo"
                  valorSeleccionado={insumo}
                  onSeleccionar={setInsumo}
                  buscar={buscarInsumosAdaptado}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select
                  value={estado}
                  onValueChange={(v) => setEstado((v ?? "todos") as Estado | "todos")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map((e) => (
                      <SelectItem key={e.valor} value={e.valor}>
                        {e.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Solicitado por</Label>
                <BuscadorAsync
                  placeholder="Buscar usuario"
                  valorSeleccionado={solicitante}
                  onSeleccionar={setSolicitante}
                  buscar={buscarUsuariosAdaptado}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Rango de fechas</Label>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs text-muted-foreground">Inicial</span>
                  <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs text-muted-foreground">Final</span>
                  <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Button className="w-full" disabled={cargando} onClick={handleConsultar}>
                  {cargando ? "Consultando..." : "Consultar"}
                </Button>
                <Button className="w-full" variant="ghost" onClick={limpiarFiltros}>
                  Limpiar filtros
                </Button>
                <p className="text-xs text-muted-foreground">
                  Ningún filtro es obligatorio: sin filtros se consultan todas.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-fit w-12 shrink-0 flex-col items-center gap-2 rounded-lg border bg-card py-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFiltrosAbiertos(true)}
              title="Mostrar filtros"
            >
              <Filter className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-3">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {pedidos === null ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar para ver las requisiciones.
            </div>
          ) : pedidos.length === 0 ? (
            <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              Ninguna requisición coincide con los filtros.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {pedidos.length} {pedidos.length === 1 ? "requisición" : "requisiciones"}
                {truncado && " — se muestran las más recientes; afina los filtros para ver otras."}
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className={`${headClasses} w-32`}>Proyecto</th>
                      <th className={`${headClasses} w-64`}>Insumo</th>
                      <th className={`${headClasses} w-40`}>Ítem del presupuesto</th>
                      <th className={`${headClasses} w-20 text-right`}>Cantidad</th>
                      <th className={`${headClasses} w-28 text-center`}>Fecha requisición</th>
                      <th className={`${headClasses} w-28 text-center`}>Fecha requerida</th>
                      <th className={`${headClasses} w-20 text-center`}>Estado</th>
                      <th className={`${headClasses} w-44`}>Observaciones</th>
                      <th className={`${headClasses} w-32`}>Solicitado por</th>
                      <th className={`${headClasses} w-24 text-center`}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.map((p) => (
                      <tr
                        key={p.id}
                        className={`border-b hover:bg-accent/40 ${p.urgente ? "bg-amber-50/60" : ""}`}
                      >
                        <td className={celda}>
                          <p className="font-medium">{p.proyectoCodigo ?? "—"}</p>
                          <p className="text-muted-foreground">{p.proyectoNombre}</p>
                        </td>
                        <td className={celda}>
                          <p className="font-medium">{p.insumoDescripcion}</p>
                          <p className="text-muted-foreground">
                            {p.insumoCodigo} · {p.insumoUm ?? "sin unidad"}
                          </p>
                        </td>
                        <td className={celda}>
                          <span className="font-mono text-muted-foreground">{p.itemCodigo}</span>{" "}
                          {p.itemDescripcion}
                        </td>
                        <td className={`${celda} text-right`}>{p.cantidad}</td>
                        <td className={`${celda} text-center`}>
                          {new Date(p.fechaPedido).toLocaleDateString("es-CO")}
                        </td>
                        <td className={`${celda} text-center`}>
                          {formatearFechaSinHora(p.fechaRequerida)}
                        </td>
                        <td className={`${celda} text-center`}>
                          <BadgeEstado estado={p.estado} />
                          {p.urgente && (
                            <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-800">
                              Urgente
                            </span>
                          )}
                        </td>
                        <td className={`${celda} max-w-[220px]`}>
                          <p className="truncate" title={p.observaciones ?? ""}>
                            {p.observaciones ?? "—"}
                          </p>
                          {p.estado === "cancelado" && p.motivoCancelacion && (
                            <p className="truncate text-muted-foreground" title={p.motivoCancelacion}>
                              Cancelado: {p.motivoCancelacion}
                            </p>
                          )}
                          {p.comentarioResolucion && (
                            <p
                              className="truncate text-muted-foreground"
                              title={p.comentarioResolucion}
                            >
                              Resp: {p.comentarioResolucion}
                            </p>
                          )}
                        </td>
                        <td className={celda}>{p.solicitanteNombre ?? "—"}</td>
                        <td className={`${celda} text-center`}>
                          <div className="flex flex-col items-center gap-1">
                            {p.solicitanteId === usuarioId && p.estado === "pendiente" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => abrirModificar(p)}
                                  className="text-xs text-primary underline-offset-2 hover:underline"
                                >
                                  Modificar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setError(null)
                                    setCancelando(p)
                                    setMotivoCancelacion("")
                                  }}
                                  className="text-xs text-destructive underline-offset-2 hover:underline"
                                >
                                  Cancelar
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => setHistorialPedido(p)}
                              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                            >
                              Historial
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <Dialog
          open={cancelando !== null}
          onOpenChange={(abierto) => {
            if (!abierto) {
              setCancelando(null)
              setMotivoCancelacion("")
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancelar requisición</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {cancelando?.insumoDescripcion} — {cancelando?.cantidad} {cancelando?.insumoUm ?? ""}. La
              requisición queda registrada como cancelada y su cantidad vuelve a estar disponible en el
              presupuesto.
            </p>
            <Textarea
              placeholder="Motivo de la cancelación (obligatorio)"
              value={motivoCancelacion}
              onChange={(e) => setMotivoCancelacion(e.target.value)}
              rows={3}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelando(null)}>
                Volver
              </Button>
              <Button
                variant="destructive"
                disabled={!motivoCancelacion.trim() || procesandoCancelacion}
                onClick={confirmarCancelacion}
              >
                {procesandoCancelacion ? "Cancelando..." : "Cancelar requisición"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={modificando !== null}
          onOpenChange={(abierto) => {
            if (!abierto) setModificando(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modificar requisición</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {modificando?.insumoDescripcion} — ítem {modificando?.itemCodigo}. Solo se puede modificar
              mientras está pendiente de aprobación. Para cambiar de insumo o de ítem, cancélalo y crea
              otro.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Cantidad</label>
                <Input
                  inputMode="numeric"
                  value={edCantidad}
                  onChange={(e) => setEdCantidad(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Fecha requerida</label>
                <Input type="date" value={edFecha} onChange={(e) => setEdFecha(e.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={edUrgente} onCheckedChange={(v) => setEdUrgente(v === true)} />
              Marcar como urgente
            </label>
            <Textarea
              placeholder="Observaciones"
              value={edObservaciones}
              onChange={(e) => setEdObservaciones(e.target.value)}
              rows={3}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setModificando(null)}>
                Cancelar
              </Button>
              <Button onClick={confirmarModificacion} disabled={procesandoEdicion}>
                {procesandoEdicion ? "Guardando..." : "Guardar cambios"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <HistorialDialog
          abierto={historialPedido !== null}
          tipo="pedido"
          id={historialPedido?.id ?? null}
          titulo={`Historial — ${historialPedido?.insumoDescripcion ?? "requisición"}`}
          onCerrar={() => setHistorialPedido(null)}
        />
      </main>
    </>
  )
}
