"use client"

import { formatearFechaSinHora } from "@/lib/fechas"

// app/(app)/admin-tecnico/page.tsx
//
// Panel de aprobación de pedidos de insumos. Tabla tipo Excel,
// agrupada por proyecto (el admin-técnico ve todos). Aprobar/rechazar
// actúa sobre una sola fila -- no sobre todo el grupo_pedido_id, tal
// como se definió: dos líneas del mismo pedido (repartido entre
// ítems) se pueden resolver por separado.

import Link from "next/link"
import { useEffect, useState } from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HistorialDialog } from "@/components/historial-timeline"
import {
  verPedidosPorEstado,
  resolverPedido,
  desaprobarPedido,
  obtenerPermisosPedidos,
  type EstadoAprobacion,
  type PedidoPendiente,
  type PermisosPedidos,
} from "./actions"

const VISTAS: { valor: EstadoAprobacion; etiqueta: string }[] = [
  { valor: "pendiente", etiqueta: "Pendientes" },
  { valor: "aprobado", etiqueta: "Aprobadas" },
  { valor: "rechazado", etiqueta: "Rechazadas" },
]

type TipoAccion = "rechazar" | "desaprobar"
const TEXTO_ACCION: Record<TipoAccion, { titulo: string; explicacion: string; boton: string }> = {
  rechazar: {
    titulo: "Rechazar requisición",
    explicacion: "Quien la pidió recibe una notificación con este motivo.",
    boton: "Rechazar requisición",
  },
  desaprobar: {
    titulo: "Desaprobar requisición",
    explicacion: "Vuelve a pendiente y se podrá aprobar o rechazar de nuevo. No se puede si ya está en una orden de compra.",
    boton: "Desaprobar requisición",
  },
}

const headClasses = "border-r bg-muted/50 px-3 py-2 text-left text-xs font-medium last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

export default function AdminTecnico() {
  const [pedidos, setPedidos] = useState<PedidoPendiente[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [idsEnProceso, setIdsEnProceso] = useState<Set<string>>(new Set())
  const [vista, setVista] = useState<EstadoAprobacion>("pendiente")
  const [permisos, setPermisos] = useState<PermisosPedidos | null>(null)
  // Rechazar / desaprobar piden motivo; el historial se abre por requisición.
  const [accion, setAccion] = useState<{ tipo: TipoAccion; pedido: PedidoPendiente } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesandoAccion, setProcesandoAccion] = useState(false)
  const [historial, setHistorial] = useState<PedidoPendiente | null>(null)

  function cargar() {
    setCargando(true)
    setError(null)
    Promise.all([verPedidosPorEstado(vista), obtenerPermisosPedidos()])
      .then(([lista, p]: [PedidoPendiente[], PermisosPedidos]) => {
        setPedidos(lista)
        setPermisos(p)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las requisiciones."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista])

  async function confirmarAccion() {
    if (!accion || !motivo.trim()) return
    setProcesandoAccion(true)
    setError(null)
    try {
      if (accion.tipo === "rechazar") {
        await resolverPedido(accion.pedido.id, "rechazado", motivo.trim())
        // Optimista, igual que aprobar: sale de la cola de pendientes.
        const id = accion.pedido.id
        setPedidos((prev) => prev.filter((p) => p.id !== id))
      } else {
        await desaprobarPedido(accion.pedido.id, motivo.trim())
        cargar()
      }
      setAccion(null)
      setMotivo("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.")
      setAccion(null)
    } finally {
      setProcesandoAccion(false)
    }
  }

  async function aprobar(id: string) {
    setIdsEnProceso((prev) => new Set(prev).add(id))
    try {
      await resolverPedido(id, "aprobado")
      // Optimista: se saca de la lista de pendientes al instante -- ya
      // no aplica a esta vista sin importar el resultado.
      setPedidos((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la requisición.")
    } finally {
      setIdsEnProceso((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // Agrupar por proyecto -- barato porque ya es solo la cola de
  // pendientes (nunca todo el histórico).
  const porProyecto = new Map<string, { nombre: string; pedidos: PedidoPendiente[] }>()
  for (const p of pedidos) {
    if (!porProyecto.has(p.proyectoId)) {
      porProyecto.set(p.proyectoId, { nombre: p.proyectoNombre, pedidos: [] })
    }
    porProyecto.get(p.proyectoId)!.pedidos.push(p)
  }

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aprobación de requisiciones</h1>
          <p className="text-sm text-muted-foreground">
            Requisiciones de insumos de todos los proyectos.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-8 p-6">
        <div className="flex gap-2">
          {VISTAS.map((v) => (
            <Button
              key={v.valor}
              size="sm"
              variant={vista === v.valor ? "default" : "outline"}
              onClick={() => setVista(v.valor)}
            >
              {v.etiqueta}
            </Button>
          ))}
        </div>

        {cargando && <p className="text-sm text-muted-foreground">Cargando requisiciones…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!cargando && pedidos.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">
            {vista === "pendiente"
              ? "No hay requisiciones pendientes por revisar."
              : vista === "aprobado"
                ? "No hay requisiciones aprobadas."
                : "No hay requisiciones rechazadas."}
          </p>
        )}

        {[...porProyecto.entries()].map(([proyectoId, grupo]) => (
          <div key={proyectoId} className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">
              {grupo.nombre}{" "}
              <span className="font-normal text-muted-foreground">
                ({grupo.pedidos.length} {grupo.pedidos.length === 1 ? "requisición" : "requisiciones"}{" "}
                {vista === "pendiente" ? "pendientes" : vista === "aprobado" ? "aprobadas" : "rechazadas"})
              </span>
            </h2>

            <div className="overflow-x-auto rounded-none border">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className={`${headClasses} w-20`}>Código</th>
                    <th className={headClasses}>Insumo</th>
                    <th className={`${headClasses} w-16 text-center`}>UM</th>
                    <th className={`${headClasses} w-20 text-right`}>Cantidad</th>
                    <th className={`${headClasses} w-28 text-center`}>Fecha requisición</th>
                    <th className={`${headClasses} w-28 text-center`}>Fecha requerida</th>
                    <th className={`${headClasses} w-52`}>Observaciones</th>
                    <th className={`${headClasses} w-16 text-center`}>Soporte</th>
                    <th className={`${headClasses} w-20 text-center`}>Urgente</th>
                    <th className={`${headClasses} w-24 text-center`}>Ítem</th>
                    <th className={`${headClasses} w-28`}>Solicitado por</th>
                    {vista === "rechazado" && (
                      <>
                        <th className={`${headClasses} w-64`}>Motivo del rechazo</th>
                        <th className={`${headClasses} w-28`}>Rechazada por</th>
                        <th className={`${headClasses} w-28 text-center`}>Fecha rechazo</th>
                      </>
                    )}
                    <th className={`${headClasses} ${vista === "rechazado" ? "w-24" : "w-56"} text-center`}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {grupo.pedidos.map((pedido) => {
                    const procesando = idsEnProceso.has(pedido.id)
                    return (
                      <tr
                        key={pedido.id}
                        className={`border-b ${pedido.urgente ? "bg-amber-50/60" : "hover:bg-muted/30"}`}
                      >
                        <td className={`${celda} font-mono text-muted-foreground`}>
                          {pedido.insumoCodigo}
                        </td>
                        <td className={celda}>{pedido.insumoDescripcion}</td>
                        <td className={`${celda} text-center`}>{pedido.insumoUm ?? "—"}</td>
                        <td className={`${celda} text-right`}>{pedido.cantidad}</td>
                        <td className={`${celda} text-center`}>
                          {new Date(pedido.fechaPedido).toLocaleDateString("es-CO")}
                        </td>
                        <td className={`${celda} text-center`}>
                          {formatearFechaSinHora(pedido.fechaRequerida)}
                        </td>
                        <td
                          className={`${celda} max-w-[220px] truncate`}
                          title={pedido.observaciones ?? ""}
                        >
                          {pedido.observaciones ?? "—"}
                        </td>
                        <td className={`${celda} text-center`}>
                          {pedido.soporteUrl ? (
                            <a
                              href={pedido.soporteUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline underline-offset-2"
                            >
                              Ver
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={`${celda} text-center`}>
                          {pedido.urgente && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                              Urgente
                            </span>
                          )}
                        </td>
                        <td className={`${celda} text-center`}>
                          <Link
                            href={`/presupuestos?presupuestoId=${pedido.presupuestoId}`}
                            className="text-primary underline underline-offset-2"
                          >
                            {pedido.itemCodigo}
                          </Link>
                        </td>
                        <td className={`${celda} truncate`}>{pedido.solicitanteNombre ?? "—"}</td>
                        {vista === "rechazado" && (
                          <>
                            <td className={`${celda} whitespace-pre-wrap break-words`}>
                              {pedido.motivoRechazo ?? <span className="text-muted-foreground">(sin motivo)</span>}
                            </td>
                            <td className={`${celda} truncate`}>{pedido.resueltoPorNombre ?? "—"}</td>
                            <td className={`${celda} text-center`}>
                              {pedido.resueltoAt ? new Date(pedido.resueltoAt).toLocaleDateString("es-CO") : "—"}
                            </td>
                          </>
                        )}
                        <td className={`${celda} text-center`}>
                          <div className="flex flex-wrap items-center justify-center gap-1.5">
                            {vista === "pendiente" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50"
                                  onClick={() => aprobar(pedido.id)}
                                  disabled={procesando}
                                >
                                  Aprobar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                                  onClick={() => {
                                    setAccion({ tipo: "rechazar", pedido })
                                    setMotivo("")
                                  }}
                                  disabled={procesando}
                                >
                                  Rechazar
                                </Button>
                              </>
                            ) : (
                              vista === "aprobado" &&
                              permisos?.desaprobar && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-[11px] text-amber-700 hover:bg-amber-50"
                                  onClick={() => {
                                    setAccion({ tipo: "desaprobar", pedido })
                                    setMotivo("")
                                  }}
                                  disabled={procesando}
                                >
                                  Desaprobar
                                </Button>
                              )
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px] text-muted-foreground"
                              onClick={() => setHistorial(pedido)}
                            >
                              Historial
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <Dialog
          open={accion !== null}
          onOpenChange={(abierto) => {
            if (!abierto) {
              setAccion(null)
              setMotivo("")
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{accion ? TEXTO_ACCION[accion.tipo].titulo : ""}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {accion?.pedido.insumoDescripcion} — {accion?.pedido.cantidad} {accion?.pedido.insumoUm ?? ""} (
              {accion?.pedido.solicitanteNombre ?? "sin solicitante"}).{" "}
              {accion ? TEXTO_ACCION[accion.tipo].explicacion : ""}
            </p>
            <Textarea
              placeholder="Motivo (obligatorio)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setAccion(null)}>
                Volver
              </Button>
              <Button
                variant="destructive"
                disabled={!motivo.trim() || procesandoAccion}
                onClick={confirmarAccion}
              >
                {procesandoAccion ? "Procesando..." : accion ? TEXTO_ACCION[accion.tipo].boton : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <HistorialDialog
          abierto={historial !== null}
          tipo="pedido"
          id={historial?.id ?? null}
          titulo={`Historial — ${historial?.insumoDescripcion ?? "requisición"}`}
          onCerrar={() => setHistorial(null)}
        />
      </main>
    </>
  )
}