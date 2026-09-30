"use client"
// app/(app)/almacen/page.tsx
import { useEffect, useState } from "react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { SolicitudInsumoDialog } from "@/components/dialogue-nuevo-pedido"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HistorialDialog } from "@/components/historial-timeline"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"

import {
  buscarPresupuestoActivo,
  verPedidosDeProyecto,
  cancelarPedido,
  modificarPedido,
  type PedidoRegistro,
} from "./actions"
import type { PresupuestoActivo } from "./types"

const headClasses =
  "border-r bg-primary px-3 py-2.5 text-left text-xs font-medium text-primary-foreground last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

type FiltroEstado = "todos" | "pendiente" | "aprobado" | "rechazado" | "cancelado"

const FILTROS: { valor: FiltroEstado; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "pendiente", etiqueta: "Pendientes" },
  { valor: "aprobado", etiqueta: "Aprobados" },
  { valor: "rechazado", etiqueta: "Rechazados" },
  { valor: "cancelado", etiqueta: "Cancelados" },
]

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

export default function Almacen() {
  // El proyecto se elige en /inicio (landing); acá solo se lee.
  const { proyecto: proyectoActual } = useProyectoActual()
  const proyectoId = proyectoActual?.id ?? null
  const [error, setError] = useState<string | null>(null)
  const [dialogoPedido, setDialogoPedido] = useState(false)
  const [usuarioId, setUsuarioId] = useState<string | null>(null)

  const [presupuestoActivo, setPresupuestoActivo] = useState<PresupuestoActivo | null>(null)
  const [cargandoPresupuesto, setCargandoPresupuesto] = useState(false)

  const [pedidos, setPedidos] = useState<PedidoRegistro[]>([])
  const [cargandoPedidos, setCargandoPedidos] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos")
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
    supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    setPresupuestoActivo(null)
    setError(null)

    if (!proyectoId) return

    setCargandoPresupuesto(true)
    buscarPresupuestoActivo(proyectoId)
      .then(setPresupuestoActivo)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el presupuesto del proyecto."))
      .finally(() => setCargandoPresupuesto(false))
  }, [proyectoId])

  function cargarPedidos() {
    if (!proyectoId) return
    setCargandoPedidos(true)
    verPedidosDeProyecto(proyectoId, filtroEstado === "todos" ? undefined : filtroEstado)
      .then(setPedidos)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el registro de requisiciones."))
      .finally(() => setCargandoPedidos(false))
  }

  useEffect(() => {
    if (!proyectoId) {
      setPedidos([])
      return
    }
    cargarPedidos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyectoId, filtroEstado])

  async function confirmarCancelacion() {
    if (!cancelando || !motivoCancelacion.trim()) return
    setProcesandoCancelacion(true)
    setError(null)
    try {
      await cancelarPedido(cancelando.id, motivoCancelacion.trim())
      setCancelando(null)
      setMotivoCancelacion("")
      cargarPedidos()
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
    const cantidad = Number(edCantidad.replace(",", "."))
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      setError("La cantidad debe ser mayor que cero.")
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
      cargarPedidos()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo modificar la requisición.")
      setModificando(null)
    } finally {
      setProcesandoEdicion(false)
    }
  }

  const proyectoSeleccionado = proyectoActual

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Elaboración de requisiciones</h1>
          <p className="text-sm text-muted-foreground">
            Haz requisiciones de insumos de almacén para el proyecto en el que estás trabajando.
          </p>
        </div>
      </header>

      {!proyectoActual && <SinProyecto />}

      {proyectoActual && (
      <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Proyecto:{" "}
              <span className="font-medium text-foreground">
                {proyectoActual
                  ? proyectoActual.codigo
                    ? `${proyectoActual.codigo} — ${proyectoActual.nombre}`
                    : proyectoActual.nombre
                  : "sin seleccionar"}
              </span>
            </p>

            <Button
              type="button"
              size="sm"
              className="h-10 gap-1.5 rounded-sm px-3 text-xs"
              onClick={() => setDialogoPedido(true)}
              disabled={!presupuestoActivo || cargandoPresupuesto}
            >
              + Crear requisición
            </Button>
          </div>

          {proyectoId && cargandoPresupuesto && (
            <p className="text-xs text-muted-foreground">Cargando presupuesto del proyecto…</p>
          )}
          {proyectoId && !cargandoPresupuesto && !presupuestoActivo && (
            <p className="text-xs text-amber-700">
              {proyectoSeleccionado?.nombre ?? "Este proyecto"} todavía no tiene un presupuesto
              cargado — sube uno desde el módulo de Presupuestos antes de crear requisiciones.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {presupuestoActivo && (
          <SolicitudInsumoDialog
            open={dialogoPedido}
            onOpenChange={setDialogoPedido}
            versionId={presupuestoActivo.versionActualId}
            onPedidoCreado={cargarPedidos}
          />
        )}

        {proyectoId && (
          <div className="space-y-3 border-t pt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Registro de requisiciones</h2>
              <div className="flex gap-1.5">
                {FILTROS.map((f) => (
                  <button
                    key={f.valor}
                    type="button"
                    onClick={() => setFiltroEstado(f.valor)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      filtroEstado === f.valor
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {f.etiqueta}
                  </button>
                ))}
              </div>
            </div>

            {cargandoPedidos ? (
              <p className="text-sm text-muted-foreground">Cargando requisiciones…</p>
            ) : pedidos.length === 0 ? (
              <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                No hay requisiciones {filtroEstado !== "todos" ? FILTROS.find((f) => f.valor === filtroEstado)?.etiqueta.toLowerCase() : ""} para este proyecto.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
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
                      <tr key={p.id} className={`border-b hover:bg-accent/40 ${p.urgente ? "bg-amber-50/60" : ""}`}>
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
                          {new Date(p.fechaRequerida).toLocaleDateString("es-CO")}
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
            )}
          </div>
        )}

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
                  inputMode="decimal"
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
      )}
    </>
  )
}