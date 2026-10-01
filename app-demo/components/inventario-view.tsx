"use client"

import { COMODIN_LISTAR } from "@/lib/busqueda"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { PanelFiltros } from "@/components/panel-filtros"
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
  // Proyecto escogido en /inicio o en el selector del header (ver
  // lib/proyecto-actual.ts).
  const proyectoId = useProyectoActual().proyecto?.id ?? null
  const [inventario, setInventario] = useState<InsumoInventario[] | null>(null)
  // Filtro por insumo: el elegido en el panel y el ya aplicado (al Consultar).
  const [insumo, setInsumo] = useState<OpcionBuscador | null>(null)
  const [insumoAplicado, setInsumoAplicado] = useState<OpcionBuscador | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!proyectoId) {
      setInventario(null)
      return
    }
    setInventario(null)
    setInsumo(null)
    setInsumoAplicado(null)
    setError(null)
    obtenerInventarioProyecto(proyectoId)
      .then((filas: InsumoInventario[]) => setInventario(filas))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el inventario."))
  }, [proyectoId])

  // Las opciones del filtro son los insumos que hay en el inventario del
  // proyecto (escribe 2 letras, o _ para verlos todos).
  const buscarInsumo = useCallback(
    async (termino: string): Promise<OpcionBuscador[]> => {
      const q = termino.trim().toLowerCase()
      return (inventario ?? [])
        .filter(
          (i) =>
            q === COMODIN_LISTAR ||
            i.insumoDescripcion.toLowerCase().includes(q) ||
            String(i.insumoCodigo).includes(q)
        )
        .slice(0, q === COMODIN_LISTAR ? 50 : 15)
        .map((i) => ({
          id: i.insumoId,
          etiqueta: i.insumoDescripcion,
          subetiqueta: `${i.insumoCodigo} · ${i.insumoUm ?? ""}`,
        }))
    },
    [inventario]
  )

  const filtrado = useMemo(() => {
    if (!inventario) return []
    if (!insumoAplicado) return inventario
    return inventario.filter((i) => i.insumoId === insumoAplicado.id)
  }, [inventario, insumoAplicado])

  const valorTotal = useMemo(
    () => filtrado.reduce((acc, i) => acc + i.valorInventario, 0),
    [filtrado]
  )
  const hayNegativos = (inventario ?? []).some((i) => i.cantidadDisponible < 0)

  return (
    <div className="flex h-full min-h-0 gap-4">
      {proyectoId && inventario && (
        <PanelFiltros
          onConsultar={() => setInsumoAplicado(insumo)}
          onLimpiar={() => {
            setInsumo(null)
            setInsumoAplicado(null)
          }}
          ayuda="Sin filtro se muestra todo el inventario del proyecto."
        >
          <div className="space-y-1.5">
            <Label>Insumo</Label>
            <BuscadorAsync
              placeholder="Buscar insumo"
              valorSeleccionado={insumo}
              onSeleccionar={setInsumo}
              buscar={buscarInsumo}
            />
          </div>
        </PanelFiltros>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
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
            ? "Ningún insumo coincide con el filtro."
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
    </div>
  )
}
