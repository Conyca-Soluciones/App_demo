// pedidos-compras-view.tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProyectoActual } from "@/components/proyecto-provider"
import { FiltrosPedidosCompraPanel } from "./filtros-pedidos-compra"
import { TablaPedidosCompra } from "./tabla-pedidos-compra"
import {
  listarPedidosParaComprar,
  type FiltrosPedidosCompra,
  type PedidoParaComprar,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

const CLAVE_SELECCION = "compras:seleccion"

export function PedidosCompraView() {
  // key: al cambiar de proyecto se descarta lo consultado del anterior.
  const { proyecto } = useProyectoActual()
  return <PedidosCompraDeProyecto key={proyecto?.id ?? "ninguno"} />
}

function PedidosCompraDeProyecto() {
  const router = useRouter()
  const [pedidos, setPedidos] = useState<PedidoParaComprar[] | null>(null)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConsultar(filtros: FiltrosPedidosCompra) {
    setCargando(true)
    setError(null)
    try {
      const data = await listarPedidosParaComprar(filtros)
      setPedidos(data)
      setSeleccionados(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las requisiciones.")
    } finally {
      setCargando(false)
    }
  }

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  function handlePedidoRechazado(id: string) {
    setPedidos((prev) => (prev ? prev.filter((p) => p.id !== id) : prev))
    setSeleccionados((prev) => {
      if (!prev.has(id)) return prev
      const siguiente = new Set(prev)
      siguiente.delete(id)
      return siguiente
    })
  }

  // Una orden de compra es de UN proyecto: el de las líneas elegidas (con
  // "Todos los proyectos" se pueden marcar de varios, pero no generar).
  const proyectosElegidos = new Set((pedidos ?? []).filter((p) => seleccionados.has(p.id)).map((p) => p.proyectoId))
  const variosProyectos = proyectosElegidos.size > 1
  const proyectoDeLaOrden = proyectosElegidos.size === 1 ? [...proyectosElegidos][0] : null

  function handleGenerarOC() {
    if (!proyectoDeLaOrden || seleccionados.size === 0) return
    sessionStorage.setItem(
      CLAVE_SELECCION,
      JSON.stringify({ proyectoId: proyectoDeLaOrden, pedidoIds: Array.from(seleccionados) })
    )
    router.push("/almacen/generar-oc")
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <FiltrosPedidosCompraPanel onConsultar={handleConsultar} cargando={cargando} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {pedidos === null ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige un proyecto (o todos) y presiona Consultar para ver las requisiciones aprobadas listas para comprar.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <TablaPedidosCompra
                pedidos={pedidos}
                seleccionados={seleccionados}
                onToggleSeleccion={toggleSeleccion}
                onPedidoRechazado={handlePedidoRechazado}
              />
            </div>
          )}
        </div>
      </div>

      {seleccionados.size > 0 && (
        <div className="flex shrink-0 items-center justify-between rounded-lg border bg-card px-4 py-3 shadow-lg">
          <span className="text-sm">
            <strong>{seleccionados.size}</strong> {seleccionados.size === 1 ? "requisición" : "requisiciones"} seleccionada
            {seleccionados.size === 1 ? "" : "s"} para comprar
            {variosProyectos && (
              <span className="ml-2 text-destructive">
                · Son de {proyectosElegidos.size} proyectos: una orden de compra es de un solo proyecto.
              </span>
            )}
          </span>
          <Button onClick={handleGenerarOC} disabled={!proyectoDeLaOrden}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            Generar Orden de Compra
          </Button>
        </div>
      )}
    </div>
  )
}