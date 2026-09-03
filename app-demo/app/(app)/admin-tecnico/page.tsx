"use client"

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
import { verPedidosPendientes, resolverPedido, type PedidoPendiente } from "./actions"

const headClasses = "border-r bg-muted/50 px-3 py-2 text-left text-xs font-medium last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

export default function AdminTecnico() {
  const [pedidos, setPedidos] = useState<PedidoPendiente[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [idsEnProceso, setIdsEnProceso] = useState<Set<string>>(new Set())

  function cargar() {
    setCargando(true)
    setError(null)
    verPedidosPendientes()
      .then(setPedidos)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los pedidos."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    cargar()
  }, [])

  async function resolver(id: string, estado: "aprobado" | "rechazado") {
    setIdsEnProceso((prev) => new Set(prev).add(id))
    try {
      await resolverPedido(id, estado)
      // Optimista: se saca de la lista de pendientes al instante -- ya
      // no aplica a esta vista sin importar el resultado.
      setPedidos((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el pedido.")
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
          <h1 className="text-2xl font-semibold tracking-tight">Aprobación de pedidos</h1>
          <p className="text-sm text-muted-foreground">
            Pedidos de insumos pendientes de todos los proyectos.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-8 p-6">
        {cargando && <p className="text-sm text-muted-foreground">Cargando pedidos…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!cargando && pedidos.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">No hay pedidos pendientes por revisar.</p>
        )}

        {[...porProyecto.entries()].map(([proyectoId, grupo]) => (
          <div key={proyectoId} className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">
              {grupo.nombre}{" "}
              <span className="font-normal text-muted-foreground">
                ({grupo.pedidos.length} {grupo.pedidos.length === 1 ? "pedido" : "pedidos"} pendientes)
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
                    <th className={`${headClasses} w-28 text-center`}>Fecha pedido</th>
                    <th className={`${headClasses} w-28 text-center`}>Fecha requerida</th>
                    <th className={`${headClasses} w-52`}>Observaciones</th>
                    <th className={`${headClasses} w-16 text-center`}>Soporte</th>
                    <th className={`${headClasses} w-20 text-center`}>Urgente</th>
                    <th className={`${headClasses} w-24 text-center`}>Ítem</th>
                    <th className={`${headClasses} w-28`}>Solicitado por</th>
                    <th className={`${headClasses} w-36 text-center`}>Acciones</th>
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
                          {new Date(pedido.fechaRequerida).toLocaleDateString("es-CO")}
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
                        <td className={`${celda} text-center`}>
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50"
                              onClick={() => resolver(pedido.id, "aprobado")}
                              disabled={procesando}
                            >
                              Aprobar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                              onClick={() => resolver(pedido.id, "rechazado")}
                              disabled={procesando}
                            >
                              Rechazar
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
      </main>
    </>
  )
}