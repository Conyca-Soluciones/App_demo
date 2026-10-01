"use client"

import { formatearFechaSinHora } from "@/lib/fechas"

import { useState } from "react"
import { FileText, Paperclip } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { rechazarPedidoCompras, type PedidoParaComprar } from "@/app/(app)/almacen/comprar-pedidos/actions"

const formatoMoneda = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

type TablaPedidosCompraProps = {
  pedidos: PedidoParaComprar[]
  seleccionados: Set<string>
  onToggleSeleccion: (id: string) => void
  onSeleccionarVarios: (ids: string[], seleccionar: boolean) => void
  onPedidoRechazado: (id: string) => void
}

export function TablaPedidosCompra({
  pedidos,
  seleccionados,
  onToggleSeleccion,
  onSeleccionarVarios,
  onPedidoRechazado,
}: TablaPedidosCompraProps) {
  const [pedidoARechazar, setPedidoARechazar] = useState<PedidoParaComprar | null>(null)
  const [motivo, setMotivo] = useState("")
  const [rechazando, setRechazando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmarRechazo() {
    if (!pedidoARechazar || !motivo.trim()) return
    setRechazando(true)
    setError(null)
    try {
      await rechazarPedidoCompras(pedidoARechazar.id, motivo.trim())
      onPedidoRechazado(pedidoARechazar.id)
      setPedidoARechazar(null)
      setMotivo("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar la requisición.")
    } finally {
      setRechazando(false)
    }
  }

  // Agrupadas por requisición (Requisición 1: insumo A, B, C...), en el orden
  // en que llegan (urgentes y más próximas primero). Compras elige los insumos
  // que quiere, de una o de varias requisiciones, para cada orden de compra.
  // Map por id: O(n). Con grupos.find dentro del ciclo era O(n × requisiciones).
  const grupos: { id: string; numero: number | null; lineas: PedidoParaComprar[] }[] = []
  const grupoPorId = new Map<string, (typeof grupos)[number]>()
  for (const p of pedidos) {
    let g = grupoPorId.get(p.requisicionId)
    if (!g) {
      g = { id: p.requisicionId, numero: p.requisicionNumero, lineas: [] }
      grupoPorId.set(p.requisicionId, g)
      grupos.push(g)
    }
    g.lineas.push(p)
  }

  if (pedidos.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        No hay requisiciones aprobadas pendientes de comprar con estos filtros.
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-64">Insumo</TableHead>
              <TableHead>UM</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Vr. Unit. Proyectado</TableHead>
              <TableHead>Solicitante</TableHead>
              <TableHead>Fecha Ped.</TableHead>
              <TableHead>Fecha Req.</TableHead>
              <TableHead>Adjuntos</TableHead>
              <TableHead>Obs</TableHead>
              <TableHead className="text-center">Urgente</TableHead>
              <TableHead className="text-center">Rechazar</TableHead>
              <TableHead className="text-center">Comprar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grupos.flatMap((grupo) => {
              const ids = grupo.lineas.map((l) => l.id)
              const nMarcadas = ids.filter((id) => seleccionados.has(id)).length
              const primera = grupo.lineas[0]
              const encabezado = (
                <TableRow key={`req-${grupo.id}`} className="bg-muted/60 hover:bg-muted/60">
                  <TableCell colSpan={12} className="whitespace-normal py-2">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                      <span className="font-semibold">
                        Requisición {grupo.numero ?? "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {grupo.lineas.length} {grupo.lineas.length === 1 ? "insumo" : "insumos"} pendientes de comprar
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {primera.solicitadoPorNombre ?? "—"} · {formatoFecha(primera.fechaPedido)}
                      </span>
                      <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
                        <Checkbox
                          aria-label={`Comprar todos los insumos de la requisición ${grupo.numero ?? ""}`}
                          checked={nMarcadas === ids.length}
                          onCheckedChange={(v) => onSeleccionarVarios(ids, v === true)}
                        />
                        Seleccionar todos
                      </label>
                    </div>
                  </TableCell>
                </TableRow>
              )
              return [encabezado, ...grupo.lineas.map((pedido) => {
              const comprometido = pedido.cantidadPendiente < pedido.cantidad

              return (
                <TableRow key={pedido.id} className={pedido.urgente ? "bg-amber-50" : undefined}>
                  {/* whitespace-normal: TableCell trae nowrap por defecto y los
                      nombres largos se salían de la columna encima de las
                      demás. Ahora bajan de línea dentro de su ancho. */}
                  <TableCell className="min-w-64 max-w-md whitespace-normal break-words">
                    <span className="text-muted-foreground">{pedido.insumoCodigo} · </span>
                    {pedido.insumoDescripcion}
                  </TableCell>
                  <TableCell>{pedido.um ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end">
                      <span>{pedido.cantidadPendiente.toLocaleString("es-CO")}</span>
                      {comprometido ? (
                        <span
                          className="text-xs text-muted-foreground line-through"
                          title="Cantidad originalmente pedida — parte ya se compró en otra orden"
                        >
                          {pedido.cantidad.toLocaleString("es-CO")}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {pedido.valorUnitarioProyectado != null
                      ? formatoMoneda.format(pedido.valorUnitarioProyectado)
                      : "—"}
                  </TableCell>
                  <TableCell>{pedido.solicitadoPorNombre ?? "—"}</TableCell>
                  <TableCell>{formatoFecha(pedido.fechaPedido)}</TableCell>
                  <TableCell>{formatearFechaSinHora(pedido.fechaRequerida)}</TableCell>
                  <TableCell>
                    {pedido.soporteUrl ? (
                      <a
                        href={pedido.soporteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                        aria-label="Ver adjunto"
                      >
                        <Paperclip className="h-4 w-4" />
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {pedido.observaciones ? (
                      <span title={pedido.observaciones}>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {pedido.urgente ? (
                      <Badge variant="destructive">Urgente</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      aria-label={`Rechazar requisición de ${pedido.insumoDescripcion}`}
                      onCheckedChange={(v) => {
                        if (v === true) {
                          setError(null)
                          setPedidoARechazar(pedido)
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      aria-label={`Comprar requisición de ${pedido.insumoDescripcion}`}
                      checked={seleccionados.has(pedido.id)}
                      onCheckedChange={() => onToggleSeleccion(pedido.id)}
                    />
                  </TableCell>
                </TableRow>
              )
            })]
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={pedidoARechazar !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPedidoARechazar(null)
            setMotivo("")
            setError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar requisición</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {pedidoARechazar?.insumoDescripcion} — {pedidoARechazar?.cantidadPendiente} {pedidoARechazar?.um}
            {pedidoARechazar && pedidoARechazar.cantidadPendiente < pedidoARechazar.cantidad ? (
              <span> (de {pedidoARechazar.cantidad} solicitadas originalmente)</span>
            ) : null}
          </p>

          {error ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <Textarea
            placeholder="Motivo del rechazo (obligatorio)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setPedidoARechazar(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || rechazando}
              onClick={confirmarRechazo}
            >
              {rechazando ? "Rechazando..." : "Rechazar requisición"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}