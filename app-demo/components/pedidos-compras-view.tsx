// pedidos-compras-view.tsx
"use client"

import { useEffect, useState } from "react"
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
  const router = useRouter()
  const [pedidos, setPedidos] = useState<PedidoParaComprar[] | null>(null)
  const [proyectoConsultado, setProyectoConsultado] = useState<string | null>(null)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { proyecto: proyectoActual } = useProyectoActual()

  // Al cambiar de proyecto se descarta lo consultado del anterior.
  useEffect(() => {
    setPedidos(null)
    setProyectoConsultado(null)
    setSeleccionados(new Set())
  }, [proyectoActual?.id])

  async function handleConsultar(filtros: FiltrosPedidosCompra) {
    setCargando(true)
    setError(null)
    try {
      const data = await listarPedidosParaComprar(filtros)
      setPedidos(data)
      setProyectoConsultado(filtros.proyectoId)
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

  // Marca o desmarca varias líneas a la vez (una requisición completa).
  function seleccionarVarios(ids: string[], seleccionar: boolean) {
    setSeleccionados((prev) => {
      const siguiente = new Set(prev)
      for (const id of ids) {
        if (seleccionar) siguiente.add(id)
        else siguiente.delete(id)
      }
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

  function handleGenerarOC() {
    if (!proyectoConsultado || seleccionados.size === 0) return
    sessionStorage.setItem(
      CLAVE_SELECCION,
      JSON.stringify({ proyectoId: proyectoConsultado, pedidoIds: Array.from(seleccionados) })
    )
    router.push("/almacen/generar-oc")
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">Comprar requisiciones</h1>

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
              Elige un proyecto y presiona Consultar para ver los pedidos aprobados listos para comprar.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <TablaPedidosCompra
                pedidos={pedidos}
                seleccionados={seleccionados}
                onToggleSeleccion={toggleSeleccion}
                onSeleccionarVarios={seleccionarVarios}
                onPedidoRechazado={handlePedidoRechazado}
              />
            </div>
          )}
        </div>
      </div>

      {seleccionados.size > 0 && (
        <div className="flex shrink-0 items-center justify-between rounded-lg border bg-card px-4 py-3 shadow-lg">
          <span className="text-sm">
            <strong>{seleccionados.size}</strong> requisición{seleccionados.size === 1 ? "" : "es"} seleccionada
            {seleccionados.size === 1 ? "" : "s"} para comprar
          </span>
          <Button onClick={handleGenerarOC}>
            <ShoppingCart className="mr-2 h-4 w-4" />
            Generar Orden de Compra
          </Button>
        </div>
      )}
    </div>
  )
}