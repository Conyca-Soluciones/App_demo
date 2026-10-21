"use client"

import { COMODIN_LISTAR } from "@/lib/busqueda"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { PanelFiltros } from "@/components/panel-filtros"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import {
  obtenerInventarioProyecto,
  type InsumoInventario,
} from "@/app/(app)/almacen/inventario/actions"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC, VentanaDetalle } from "@/components/ventana-detalle"

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })
const formatoMoneda = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})

export function InventarioView() {
  // Proyecto escogido en /inicio o en la barra de arriba (ver
  // lib/proyecto-actual.ts). key: al cambiar de proyecto se empieza de cero.
  const proyectoId = useProyectoActual().proyecto?.id ?? null
  return <InventarioDeProyecto key={proyectoId ?? "ninguno"} proyectoId={proyectoId} />
}

function InventarioDeProyecto({ proyectoId }: { proyectoId: string | null }) {
  const [inventario, setInventario] = useState<InsumoInventario[] | null>(null)
  // Filtro por insumo: el elegido en el panel y el ya aplicado (al Consultar).
  const [insumo, setInsumo] = useState<OpcionBuscador | null>(null)
  const [insumoAplicado, setInsumoAplicado] = useState<OpcionBuscador | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viendo, setViendo] = useState<InsumoInventario | null>(null)

  useEffect(() => {
    if (!proyectoId) return
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

  const columnas: ColumnaExcel<InsumoInventario>[] = [
    { clave: "codigo", titulo: "Código", ancho: 90, fija: true, texto: (i) => String(i.insumoCodigo), valorOrden: (i) => Number(i.insumoCodigo), claseCelda: "tabular-nums" },
    { clave: "insumo", titulo: "Insumo", ancho: 280, flexible: true, texto: (i) => i.insumoDescripcion },
    { clave: "um", titulo: "UM", ancho: 130, texto: (i) => i.insumoUm ?? "" },
    { clave: "entradas", titulo: "Entradas", ancho: 110, alinear: "right", texto: (i) => formatoNumero.format(i.cantidadEntrada), valorOrden: (i) => i.cantidadEntrada, claseCelda: "tabular-nums" },
    { clave: "salidas", titulo: "Salidas", ancho: 110, alinear: "right", texto: (i) => formatoNumero.format(i.cantidadSalida), valorOrden: (i) => i.cantidadSalida, claseCelda: "tabular-nums" },
    {
      clave: "disponible",
      titulo: "Disponible",
      ancho: 110,
      alinear: "right",
      texto: (i) => formatoNumero.format(i.cantidadDisponible),
      valorOrden: (i) => i.cantidadDisponible,
      celda: (i) => (
        <span className={`font-medium tabular-nums ${i.cantidadDisponible < 0 ? "text-destructive" : ""}`}>
          {formatoNumero.format(i.cantidadDisponible)}
        </span>
      ),
    },
    { clave: "costo", titulo: "Costo promedio", ancho: 140, alinear: "right", texto: (i) => formatoMoneda.format(i.costoPromedio), valorOrden: (i) => i.costoPromedio, claseCelda: "tabular-nums" },
    { clave: "valor", titulo: "Valor en bodega", ancho: 150, alinear: "right", texto: (i) => formatoMoneda.format(i.valorInventario), valorOrden: (i) => i.valorInventario, claseCelda: "tabular-nums" },
  ]
  const { ordenadas, orden, ordenar } = useOrdenExcel(filtrado, columnas)
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
        <div className="space-y-2">
          <TablaExcel
            filas={ordenadas}
            columnas={columnas}
            claveFila={(i) => i.insumoId}
            orden={orden}
            onOrdenar={ordenar}
            onDobleClickFila={setViendo}
            tituloFila={AYUDA_DOBLE_CLIC}
            tarjeta={{
              titulo: (i) => i.insumoDescripcion,
              subtitulo: (i) => `Código ${i.insumoCodigo}`,
              campos: ["um", "entradas", "salidas", "disponible", "costo", "valor"],
            }}
          />
          <div className="flex justify-end rounded-lg border bg-muted/40 px-3 py-2 text-sm font-semibold">
            Valor total en bodega: <span className="ml-2 tabular-nums">{formatoMoneda.format(valorTotal)}</span>
          </div>
        </div>
      )}
      </div>
      <VentanaDetalle
        abierta={viendo !== null}
        onCerrar={() => setViendo(null)}
        titulo={viendo?.insumoDescripcion}
        subtitulo={viendo ? `Código ${viendo.insumoCodigo}` : undefined}
        campos={
          viendo
            ? [
                { etiqueta: "UM", valor: viendo.insumoUm ?? "" },
                { etiqueta: "Entradas", valor: formatoNumero.format(viendo.cantidadEntrada) },
                { etiqueta: "Salidas", valor: formatoNumero.format(viendo.cantidadSalida) },
                {
                  etiqueta: "Disponible",
                  valor: (
                    <span className={viendo.cantidadDisponible < 0 ? "font-medium text-destructive" : "font-medium"}>
                      {formatoNumero.format(viendo.cantidadDisponible)}
                    </span>
                  ),
                },
                { etiqueta: "Costo promedio", valor: formatoMoneda.format(viendo.costoPromedio) },
                { etiqueta: "Valor en bodega", valor: formatoMoneda.format(viendo.valorInventario) },
              ]
            : []
        }
      />
    </div>
  )
}
