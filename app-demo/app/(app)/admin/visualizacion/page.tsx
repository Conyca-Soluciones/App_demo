"use client"

import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { COMODIN_LISTAR } from "@/lib/busqueda"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import { useEffect, useMemo, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts"
import { Badge } from "@/components/ui/badge"
import { ESTADO_VISIBLE_BADGE } from "@/lib/ordenes-compra-estado"
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
import {
  obtenerResumenEjecucion,
  type ProyectoParaVisualizacion,
  type ResumenEjecucionProyecto,
  type OrdenCompraEstado,
} from "./actions"

// Un insumo se pinta en rojo cuando lo comprado supera en más de este
// porcentaje lo presupuestado -- mismo umbral que dispara la notificación
// "Insumo con sobrecosto (+10%)" al admin (ver migración
// notificar_insumo_sobre_presupuesto).
const UMBRAL_SOBRECOSTO_PORCENTAJE = 10

const formatoMoneda = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })

function Tile({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="mt-1 text-2xl font-semibold">{valor}</p>
      {detalle && <p className="mt-0.5 text-xs text-muted-foreground">{detalle}</p>}
    </div>
  )
}

function colorPorPorcentaje(porcentaje: number) {
  return porcentaje >= 100 ? "#10b981" : porcentaje >= 50 ? "#14b8a6" : "#f59e0b"
}

// Gauge radial de % ejecutado -- RadialBarChart con una sola barra de 0 a
// 100 simula un medidor de media luna. Genérico: se usa tanto para
// "comprado" (cuánto se ha pedido) como para "salido" (avance REAL de
// obra, lo que de verdad se ha usado).
function GraficaAvance({
  titulo,
  etiquetaValor,
  valor,
  presupuestado,
}: {
  titulo: string
  etiquetaValor: string
  valor: number
  presupuestado: number
}) {
  const pct = presupuestado > 0 ? (valor / presupuestado) * 100 : 0
  const acotado = Math.max(0, Math.min(100, pct))
  const data = [{ nombre: "ejecutado", valor: acotado }]

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="mb-1 text-sm font-medium">{titulo}</p>
      <div className="relative h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={data}
            startAngle={180}
            endAngle={0}
            innerRadius="72%"
            outerRadius="100%"
            barSize={22}
            cy="85%"
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              dataKey="valor"
              cornerRadius={11}
              fill={colorPorPorcentaje(acotado)}
              background={{ fill: "hsl(var(--muted))" }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end pb-3">
          <span className="text-3xl font-semibold">{pct.toFixed(1)}%</span>
        </div>
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>
          {formatoMoneda.format(valor)} {etiquetaValor}
        </span>
        <span>{formatoMoneda.format(presupuestado)} presupuestado</span>
      </div>
    </div>
  )
}

export default function VisualizacionPage() {
  // El proyecto se elige en /inicio (landing); acá solo se lee.
  const { proyecto: proyectoActual } = useProyectoActual()
  const proyectoId = proyectoActual?.id ?? null
  const [resumen, setResumen] = useState<ResumenEjecucionProyecto | null>(null)
  const [cargandoResumen, setCargandoResumen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busquedaInsumo, setBusquedaInsumo] = useState("")

  useEffect(() => {
    if (!proyectoId) {
      setResumen(null)
      return
    }
    setCargandoResumen(true)
    setError(null)
    obtenerResumenEjecucion(proyectoId)
      .then(setResumen)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el estado de obra."))
      .finally(() => setCargandoResumen(false))
  }, [proyectoId])

  const totales = useMemo(() => {
    if (!resumen) return null

    const insumosPresupuestados = resumen.insumos.filter((i) => i.cantidadPresupuestada > 0)
    const totalPresupuestado = insumosPresupuestados.reduce((acc, i) => acc + i.valorPresupuestado, 0)
    const totalComprado = resumen.insumos.reduce((acc, i) => acc + i.valorComprado, 0)
    const totalSalido = resumen.insumos.reduce((acc, i) => acc + i.valorSalida, 0)
    const insumosConCompra = insumosPresupuestados.filter((i) => i.cantidadComprada > 0).length
    const pctEjecutado = totalPresupuestado > 0 ? (totalComprado / totalPresupuestado) * 100 : 0
    const pctAvanceReal = totalPresupuestado > 0 ? (totalSalido / totalPresupuestado) * 100 : 0
    const pctInsumosComprados =
      insumosPresupuestados.length > 0 ? (insumosConCompra / insumosPresupuestados.length) * 100 : 0

    const ocPorEstado = { pendiente_aprobacion: 0, aprobada: 0, rechazada: 0, cancelada: 0 } as Record<OrdenCompraEstado, number>
    for (const o of resumen.ordenes) ocPorEstado[o.estado] += 1

    return {
      totalPresupuestado,
      totalComprado,
      totalSalido,
      pctEjecutado,
      pctAvanceReal,
      insumosConCompra,
      totalInsumosPresupuestados: insumosPresupuestados.length,
      pctInsumosComprados,
      ocPorEstado,
    }
  }, [resumen])

  const insumosOrdenados = useMemo(() => {
    if (!resumen) return []
    return [...resumen.insumos].sort((a, b) => b.valorPresupuestado - a.valorPresupuestado)
  }, [resumen])

  const insumosFiltrados = useMemo(() => {
    const q = busquedaInsumo.trim().toLowerCase()
    if (!q || q === COMODIN_LISTAR) return insumosOrdenados
    return insumosOrdenados.filter((i) => i.insumoDescripcion.toLowerCase().includes(q))
  }, [insumosOrdenados, busquedaInsumo])

  return (
    <>
    <EncabezadoPagina
      titulo="Estado de obra"
      subtitulo="Presupuestado vs. comprado por proyecto, a partir de las órdenes de compra aprobadas."
      conProyecto
    />
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!proyectoActual ? (
        <SinProyecto />
      ) : cargandoResumen || !totales || !resumen ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando estado de obra...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <GraficaAvance
              titulo="Comprado (OC aprobadas)"
              etiquetaValor="comprado"
              valor={totales.totalComprado}
              presupuestado={totales.totalPresupuestado}
            />
            <GraficaAvance
              titulo="Avance real de obra (salidas de bodega)"
              etiquetaValor="salido"
              valor={totales.totalSalido}
              presupuestado={totales.totalPresupuestado}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile
              etiqueta="Presupuestado en insumos"
              valor={formatoMoneda.format(totales.totalPresupuestado)}
              detalle="Suma de valor_total de ítems con APU"
            />
            <Tile
              etiqueta="Comprado (OC aprobadas)"
              valor={formatoMoneda.format(totales.totalComprado)}
            />
            <Tile
              etiqueta="Salido de bodega"
              valor={formatoMoneda.format(totales.totalSalido)}
              detalle="Lo que realmente ha entrado a obra"
            />
            <Tile
              etiqueta="Insumos con compra iniciada"
              valor={`${totales.insumosConCompra} / ${totales.totalInsumosPresupuestados}`}
              detalle={`${totales.pctInsumosComprados.toFixed(0)}% de los insumos presupuestados`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Órdenes de compra:</span>
            <Badge variant="secondary">{totales.ocPorEstado.pendiente_aprobacion} pendientes</Badge>
            <Badge variant="default">{totales.ocPorEstado.aprobada} aprobadas</Badge>
            <Badge variant="destructive">{totales.ocPorEstado.rechazada} rechazadas</Badge>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-4">
              <h2 className="text-sm font-medium">Avance por insumo</h2>
              <div className="relative w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busquedaInsumo}
                  onChange={(e) => setBusquedaInsumo(e.target.value)}
                  placeholder="Buscar insumo..."
                  className="h-9 pl-8"
                />
              </div>
            </div>

            {insumosOrdenados.length === 0 ? (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Este proyecto todavía no tiene insumos presupuestados con APU.
              </p>
            ) : insumosFiltrados.length === 0 ? (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Ningún insumo coincide con "{busquedaInsumo}".
              </p>
            ) : (
              <div className="max-h-[32rem] overflow-auto rounded-lg border shadow-sm">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur supports-[backdrop-filter]:bg-muted/50">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Insumo
                      </TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        
                        <br />
                        Precio unitario promedio de compra
                      </TableHead>
                      <TableHead className="border-l text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Precio unit.
                        <br />
                        presupuesto
                      </TableHead>
                      <TableHead className="border-l text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cant.
                        <br />
                        presupuestada
                      </TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cant.
                        <br />
                        comprada
                      </TableHead>
                      <TableHead className="border-l text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cant.
                        <br />
                        salida
                      </TableHead>
                      <TableHead className="border-l text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Comprado
                      </TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Salido
                      </TableHead>
                      <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Presupuestado
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {insumosFiltrados.map((i, idx) => {
                      const pctSobre =
                        i.valorPresupuestado > 0 ? (i.valorComprado / i.valorPresupuestado - 1) * 100 : null
                      const sobrecosto = pctSobre !== null && pctSobre > UMBRAL_SOBRECOSTO_PORCENTAJE
                      // Precio unitario = valor total / cantidad -- se deriva acá en vez
                      // de traerlo aparte porque resumen_ejecucion_proyecto ya trae ambos
                      // (cantidad y valor) sumados de forma consistente por insumo.
                      const precioUnitComprado = i.cantidadComprada > 0 ? i.valorComprado / i.cantidadComprada : null
                      const precioUnitPresupuesto =
                        i.cantidadPresupuestada > 0 ? i.valorPresupuestado / i.cantidadPresupuestada : null
                      const um = i.insumoUm ? ` ${i.insumoUm}` : ""
                      return (
                        <TableRow
                          key={i.insumoId}
                          className={
                            sobrecosto
                              ? "bg-red-50 hover:bg-red-100"
                              : idx % 2 === 1
                                ? "bg-muted/25"
                                : undefined
                          }
                        >
                          <TableCell className="max-w-sm whitespace-normal break-words align-top py-3">
                            <span className="tabular-nums text-muted-foreground">{i.insumoCodigo} · </span>
                            {i.insumoDescripcion}
                          </TableCell>
                          <TableCell className="text-right align-top py-3 tabular-nums">
                            <span className={sobrecosto ? "font-semibold text-red-700" : ""}>
                              {precioUnitComprado !== null ? formatoMoneda.format(precioUnitComprado) : "—"}
                            </span>
                            {sobrecosto && pctSobre !== null && (
                              <Badge variant="destructive" className="ml-1.5 align-middle text-[10px] font-medium">
                                +{pctSobre.toFixed(0)}%
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="border-l text-right align-top py-3 tabular-nums text-muted-foreground">
                            {precioUnitPresupuesto !== null ? formatoMoneda.format(precioUnitPresupuesto) : "—"}
                          </TableCell>
                          <TableCell className="border-l text-right align-top py-3 tabular-nums text-muted-foreground">
                            {formatoNumero.format(i.cantidadPresupuestada)}
                            {um}
                          </TableCell>
                          <TableCell className="text-right align-top py-3 tabular-nums text-muted-foreground">
                            {formatoNumero.format(i.cantidadComprada)}
                            {um}
                          </TableCell>
                          <TableCell className="border-l text-right align-top py-3 tabular-nums text-muted-foreground">
                            {formatoNumero.format(i.cantidadSalida)}
                            {um}
                          </TableCell>
                          <TableCell
                            className={`border-l text-right align-top py-3 tabular-nums ${sobrecosto ? "font-semibold text-red-700" : ""}`}
                          >
                            {formatoMoneda.format(i.valorComprado)}
                          </TableCell>
                          <TableCell className="text-right align-top py-3 tabular-nums text-emerald-700">
                            {formatoMoneda.format(i.valorSalida)}
                          </TableCell>
                          <TableCell className="text-right align-top py-3 tabular-nums text-muted-foreground">
                            {formatoMoneda.format(i.valorPresupuestado)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-medium">Órdenes de compra del proyecto</h2>
            {resumen.ordenes.length === 0 ? (
              <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Este proyecto todavía no tiene órdenes de compra.
              </p>
            ) : (
              <div className="overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>N°</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resumen.ordenes.map((o) => {
                      const badge = ESTADO_VISIBLE_BADGE[o.estado]
                      return (
                        <TableRow key={o.id}>
                          <TableCell>{o.numero}</TableCell>
                          <TableCell>{o.proveedorNombre}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={badge.clase}>{badge.label}</Badge>
                          </TableCell>
                          <TableCell>{formatoFecha(o.createdAt)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </>
      )}
    </main>
    </>
  )
}