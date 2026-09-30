"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import { etiquetaProyecto } from "@/lib/proyecto-actual"
import {
  obtenerInventarioProyecto,
  type InsumoInventario,
} from "@/app/(app)/almacen/inventario/actions"

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })
const formatoMoneda = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})

export function InventarioView() {
  // El proyecto se elige en /inicio (landing); acá solo se lee.
  const { proyecto: proyectoActual } = useProyectoActual()
  const proyectoId = proyectoActual?.id ?? null
  const [inventario, setInventario] = useState<InsumoInventario[] | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!proyectoId) {
      setInventario(null)
      return
    }
    setInventario(null)
    setError(null)
    obtenerInventarioProyecto(proyectoId)
      .then((filas: InsumoInventario[]) => setInventario(filas))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el inventario."))
  }, [proyectoId])

  const filtrado = useMemo(() => {
    if (!inventario) return []
    const q = busqueda.trim().toLowerCase()
    if (!q) return inventario
    return inventario.filter(
      (i) =>
        i.insumoDescripcion.toLowerCase().includes(q) || String(i.insumoCodigo).includes(q)
    )
  }, [inventario, busqueda])

  const valorTotal = useMemo(
    () => filtrado.reduce((acc, i) => acc + i.valorInventario, 0),
    [filtrado]
  )
  const hayNegativos = (inventario ?? []).some((i) => i.cantidadDisponible < 0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Inventario</h1>
        <p className="text-sm text-muted-foreground">
          Lo que hay en bodega por proyecto: entradas menos salidas, valorado a costo promedio.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          Proyecto:{" "}
          <span className="font-medium text-foreground">
            {proyectoActual ? etiquetaProyecto(proyectoActual) : "sin seleccionar"}
          </span>
        </p>

        {inventario && (
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar insumo o código"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {hayNegativos && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Hay insumos con saldo negativo: tienen salidas registradas sin una entrada que las
          respalde.
        </div>
      )}

      {!proyectoId ? (
        <SinProyecto />
      ) : inventario === null && !error ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando inventario...
        </div>
      ) : filtrado.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {inventario && inventario.length > 0
            ? "Ningún insumo coincide con la búsqueda."
            : "Este proyecto todavía no tiene movimientos de bodega."}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Insumo</TableHead>
                <TableHead>UM</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Salidas</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="text-right">Costo promedio</TableHead>
                <TableHead className="text-right">Valor en bodega</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrado.map((i) => (
                <TableRow key={i.insumoId}>
                  <TableCell>{i.insumoCodigo}</TableCell>
                  <TableCell>{i.insumoDescripcion}</TableCell>
                  <TableCell>{i.insumoUm ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatoNumero.format(i.cantidadEntrada)}</TableCell>
                  <TableCell className="text-right">{formatoNumero.format(i.cantidadSalida)}</TableCell>
                  <TableCell
                    className={`text-right font-medium ${i.cantidadDisponible < 0 ? "text-destructive" : ""}`}
                  >
                    {formatoNumero.format(i.cantidadDisponible)}
                  </TableCell>
                  <TableCell className="text-right">{formatoMoneda.format(i.costoPromedio)}</TableCell>
                  <TableCell className="text-right">{formatoMoneda.format(i.valorInventario)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={7} className="text-right">
                  Valor total en bodega
                </TableCell>
                <TableCell className="text-right">{formatoMoneda.format(valorTotal)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
