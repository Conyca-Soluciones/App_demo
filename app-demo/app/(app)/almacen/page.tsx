"use client"
// app/(app)/almacen/page.tsx
import { useEffect, useState } from "react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { SolicitudInsumoDialog } from "@/components/dialogue-nuevo-pedido"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"

import {
  verProyectos,
  buscarPresupuestoActivo,
  verPedidosDeProyecto,
  cancelarPedido,
  type PedidoRegistro,
} from "./actions"
import type { PresupuestoActivo } from "./types"

const headClasses =
  "border-r bg-primary px-3 py-2.5 text-left text-xs font-medium text-primary-foreground last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

type FiltroEstado = "todos" | "pendiente" | "aprobado" | "rechazado"

const FILTROS: { valor: FiltroEstado; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "pendiente", etiqueta: "Pendientes" },
  { valor: "aprobado", etiqueta: "Aprobados" },
  { valor: "rechazado", etiqueta: "Rechazados" },
]

function BadgeEstado({ estado }: { estado: PedidoRegistro["estado"] }) {
  const estilos = {
    pendiente: "bg-amber-100 text-amber-800",
    aprobado: "bg-emerald-100 text-emerald-800",
    rechazado: "bg-red-100 text-red-800",
  } as const
  const etiquetas = { pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado" } as const

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estilos[estado]}`}>
      {etiquetas[estado]}
    </span>
  )
}

export default function Almacen() {
  const [proyectos, setProyectos] = useState<{ id: string; codigo: string | null; nombre: string }[]>([])
  const [proyectoId, setProyectoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialogoPedido, setDialogoPedido] = useState(false)
  const [usuarioId, setUsuarioId] = useState<string | null>(null)

  const [presupuestoActivo, setPresupuestoActivo] = useState<PresupuestoActivo | null>(null)
  const [cargandoPresupuesto, setCargandoPresupuesto] = useState(false)

  const [pedidos, setPedidos] = useState<PedidoRegistro[]>([])
  const [cargandoPedidos, setCargandoPedidos] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos")
  const [cancelandoId, setCancelandoId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    verProyectos()
      .then(setProyectos)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos"))
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
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el registro de pedidos."))
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

  async function handleCancelar(pedido: PedidoRegistro) {
    if (!confirm(`¿Cancelar el pedido de "${pedido.insumoDescripcion}"?`)) return

    setCancelandoId(pedido.id)
    setError(null)
    try {
      await cancelarPedido(pedido.id)
      setPedidos((prev) => prev.filter((p) => p.id !== pedido.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar el pedido.")
    } finally {
      setCancelandoId(null)
    }
  }

  const proyectoSeleccionado = proyectos.find((p) => p.id === proyectoId)

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pedidos de insumos</h1>
          <p className="text-sm text-muted-foreground">
            Seleccione un proyecto para hacer un pedido de insumos de almacén.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Select value={proyectoId ?? ""} onValueChange={setProyectoId}>
              <SelectTrigger className="h-10 w-64 rounded-sm">
                <SelectValue placeholder="Selecciona un proyecto" />
              </SelectTrigger>
              <SelectContent>
                {proyectos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              size="sm"
              className="h-10 gap-1.5 rounded-sm px-3 text-xs"
              onClick={() => setDialogoPedido(true)}
              disabled={!presupuestoActivo || cargandoPresupuesto}
            >
              + Crear pedido
            </Button>
          </div>

          {!proyectoId && (
            <p className="text-xs text-muted-foreground">
              Selecciona un proyecto para habilitar la creación de pedidos.
            </p>
          )}
          {proyectoId && cargandoPresupuesto && (
            <p className="text-xs text-muted-foreground">Cargando presupuesto del proyecto…</p>
          )}
          {proyectoId && !cargandoPresupuesto && !presupuestoActivo && (
            <p className="text-xs text-amber-700">
              {proyectoSeleccionado?.nombre ?? "Este proyecto"} todavía no tiene un presupuesto
              cargado — sube uno desde el módulo de Presupuestos antes de crear pedidos.
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
              <h2 className="text-sm font-semibold text-foreground">Registro de pedidos</h2>
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
              <p className="text-sm text-muted-foreground">Cargando pedidos…</p>
            ) : pedidos.length === 0 ? (
              <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                No hay pedidos {filtroEstado !== "todos" ? FILTROS.find((f) => f.valor === filtroEstado)?.etiqueta.toLowerCase() : ""} para este proyecto.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className={`${headClasses} w-64`}>Insumo</th>
                      <th className={`${headClasses} w-40`}>Ítem del presupuesto</th>
                      <th className={`${headClasses} w-20 text-right`}>Cantidad</th>
                      <th className={`${headClasses} w-28 text-center`}>Fecha pedido</th>
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
                          {p.solicitanteId === usuarioId && p.estado === "pendiente" ? (
                            <button
                              type="button"
                              onClick={() => handleCancelar(p)}
                              disabled={cancelandoId === p.id}
                              className="text-xs text-destructive underline-offset-2 hover:underline disabled:opacity-50"
                            >
                              {cancelandoId === p.id ? "Cancelando…" : "Cancelar"}
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  )
}