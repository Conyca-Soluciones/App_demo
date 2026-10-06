"use client"

import { formatearFechaSinHora } from "@/lib/fechas"

import { useState } from "react"
import { FileText, X } from "lucide-react"
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
import {
  cerrarSaldoPedido,
  rechazarPedidoCompras,
  type PedidoParaComprar,
} from "@/app/(app)/almacen/comprar-pedidos/actions"
import { nombreUnidad, textoConversionCompra } from "@/lib/unidades"

// Ya se compró algo, pero no todo: no se "rechaza", se cierra el saldo.
const esParcial = (p: PedidoParaComprar) => p.pendienteUso < p.cantidadUso - 1e-9
const formatoCant = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

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
  onPedidoRechazado: (id: string) => void
}

export function TablaPedidosCompra({
  pedidos,
  seleccionados,
  onToggleSeleccion,
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
      if (esParcial(pedidoARechazar)) await cerrarSaldoPedido(pedidoARechazar.id, motivo.trim())
      else await rechazarPedidoCompras(pedidoARechazar.id, motivo.trim())
      onPedidoRechazado(pedidoARechazar.id)
      setPedidoARechazar(null)
      setMotivo("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar la requisición.")
    } finally {
      setRechazando(false)
    }
  }

  // Lista plana, de la requisición más baja a la más alta (las del mismo número
  // conservan el orden en que llegan). Un solo ordenamiento: O(n log n).
  const SIN_NUMERO = Number.MAX_SAFE_INTEGER
  const ordenados = [...pedidos].sort(
    (x, y) => (x.requisicionNumero ?? SIN_NUMERO) - (y.requisicionNumero ?? SIN_NUMERO)
  )

  if (pedidos.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        No hay requisiciones aprobadas con estos filtros.
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap"># Requisición</TableHead>
              <TableHead className="min-w-64">Insumo</TableHead>
              <TableHead>UM</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Vr. Unit. Proyectado</TableHead>
              <TableHead>Solicitante</TableHead>
              <TableHead>Fecha Ped.</TableHead>
              <TableHead>Fecha Req.</TableHead>
              <TableHead>Obs</TableHead>
              <TableHead className="text-center">Urgente</TableHead>
              <TableHead className="text-center">Rechazar</TableHead>
              <TableHead className="text-center">Comprar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordenados.map((pedido) => {
              return (
                <TableRow key={pedido.id} className={pedido.urgente ? "bg-amber-50" : undefined}>
                  <TableCell className="font-medium">{pedido.requisicionNumero ?? "—"}</TableCell>
                  {/* whitespace-normal: TableCell trae nowrap por defecto y los
                      nombres largos se salían de la columna encima de las
                      demás. Ahora bajan de línea dentro de su ancho. */}
                  <TableCell className="min-w-64 max-w-md whitespace-normal break-words">
                    <span className="text-muted-foreground">{pedido.insumoCodigo} · </span>
                    {pedido.insumoDescripcion}
                  </TableCell>
                  <TableCell>{pedido.um ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {pedido.cantidadPendiente.toLocaleString("es-CO")}
                    {textoConversionCompra(pedido.cantidadUso, pedido.unidadUso, pedido.factor, pedido.um) && (
                      <span className="block whitespace-nowrap text-[11px] text-muted-foreground">
                        {textoConversionCompra(pedido.cantidadUso, pedido.unidadUso, pedido.factor, pedido.um)}
                      </span>
                    )}
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                      title={esParcial(pedido) ? "Cerrar saldo" : "Rechazar"}
                      disabled={pedido.cantidadPendiente <= 0}
                      aria-label={`${esParcial(pedido) ? "Cerrar saldo de" : "Rechazar"} requisición de ${pedido.insumoDescripcion}`}
                      onClick={() => {
                        setError(null)
                        setPedidoARechazar(pedido)
                      }}
                    >
                      <X className="h-5 w-5" strokeWidth={3} />
                    </Button>
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      aria-label={`Comprar requisición de ${pedido.insumoDescripcion}`}
                      disabled={pedido.cantidadPendiente <= 0}
                      checked={seleccionados.has(pedido.id)}
                      onCheckedChange={() => onToggleSeleccion(pedido.id)}
                    />
                  </TableCell>
                </TableRow>
              )
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
            <DialogTitle>
              {pedidoARechazar && esParcial(pedidoARechazar) ? "Cerrar saldo de la requisición" : "Rechazar requisición"}
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {pedidoARechazar?.insumoDescripcion} — {pedidoARechazar?.cantidadPendiente} {pedidoARechazar?.um}
            {pedidoARechazar && pedidoARechazar.cantidadPendiente < pedidoARechazar.cantidad ? (
              <span> (de {pedidoARechazar.cantidad} solicitadas originalmente)</span>
            ) : null}
          </p>

          {pedidoARechazar && esParcial(pedidoARechazar) && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Ya se compraron {formatoCant(pedidoARechazar.cantidadUso - pedidoARechazar.pendienteUso)} de{" "}
              {formatoCant(pedidoARechazar.cantidadUso)} {nombreUnidad(pedidoARechazar.unidadUso)}. Al cerrar el saldo,
              lo que falta ({formatoCant(pedidoARechazar.pendienteUso)}) se libera del presupuesto, la requisición queda en
              lo comprado y se avisa a quien la pidió.
            </p>
          )}

          {error ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <Textarea
            placeholder={
              pedidoARechazar && esParcial(pedidoARechazar)
                ? "Motivo del cierre (obligatorio)"
                : "Motivo del rechazo (obligatorio)"
            }
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
              {pedidoARechazar && esParcial(pedidoARechazar)
                ? rechazando
                  ? "Cerrando..."
                  : "Cerrar saldo"
                : rechazando
                  ? "Rechazando..."
                  : "Rechazar requisición"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}