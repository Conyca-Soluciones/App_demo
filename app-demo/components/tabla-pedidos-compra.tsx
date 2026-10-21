"use client"

import { formatearFechaSinHora } from "@/lib/fechas"

import { useState } from "react"
import { FileText, X } from "lucide-react"
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
import { AYUDA_DOBLE_CLIC, VentanaDetalle } from "@/components/ventana-detalle"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"

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
  const [viendo, setViendo] = useState<PedidoParaComprar | null>(null)
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

  const columnas: ColumnaExcel<PedidoParaComprar>[] = [
    {
      clave: "requisicion",
      titulo: "# Requisición",
      ancho: 120,
      fija: true,
      texto: (p) => (p.requisicionNumero != null ? String(p.requisicionNumero) : ""),
      valorOrden: (p) => p.requisicionNumero,
      claseCelda: "font-medium tabular-nums",
    },
    { clave: "insumo", titulo: "Insumo", ancho: 280, flexible: true, texto: (p) => `${p.insumoCodigo} · ${p.insumoDescripcion}` },
    { clave: "um", titulo: "UM", ancho: 120, texto: (p) => p.um ?? "" },
    {
      clave: "cantidad",
      titulo: "Cantidad",
      ancho: 130,
      alinear: "right",
      texto: (p) => p.cantidadPendiente.toLocaleString("es-CO"),
      valorOrden: (p) => p.cantidadPendiente,
      celda: (p) => {
        const conversion = textoConversionCompra(p.cantidadUso, p.unidadUso, p.factor, p.um)
        return (
          <span className="flex flex-col items-end leading-tight tabular-nums">
            <span>{p.cantidadPendiente.toLocaleString("es-CO")}</span>
            {conversion && <span className="text-[11px] text-muted-foreground">{conversion}</span>}
          </span>
        )
      },
    },
    {
      clave: "valor",
      titulo: "Vr. Unit. Proyectado",
      ancho: 150,
      alinear: "right",
      texto: (p) => (p.valorUnitarioProyectado != null ? formatoMoneda.format(p.valorUnitarioProyectado) : ""),
      valorOrden: (p) => p.valorUnitarioProyectado,
      claseCelda: "tabular-nums",
    },
    { clave: "solicitante", titulo: "Solicitante", ancho: 150, texto: (p) => p.solicitadoPorNombre ?? "" },
    { clave: "pedido", titulo: "Fecha Ped.", ancho: 110, alinear: "center", texto: (p) => formatoFecha(p.fechaPedido), valorOrden: (p) => p.fechaPedido, claseCelda: "tabular-nums" },
    {
      clave: "requerida",
      titulo: "Fecha Req.",
      ancho: 110,
      alinear: "center",
      texto: (p) => formatearFechaSinHora(p.fechaRequerida),
      valorOrden: (p) => p.fechaRequerida,
      claseCelda: "tabular-nums",
    },
    {
      clave: "obs",
      titulo: "Obs",
      ancho: 70,
      alinear: "center",
      ordenable: false,
      texto: (p) => p.observaciones ?? "",
      celda: (p) =>
        p.observaciones ? (
          <span title={p.observaciones}>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        ),
    },
    {
      clave: "urgente",
      titulo: "Urgente",
      ancho: 100,
      alinear: "center",
      texto: (p) => (p.urgente ? "Urgente" : ""),
      celda: (p) => (p.urgente ? <Badge variant="destructive">Urgente</Badge> : <span className="text-muted-foreground/60">—</span>),
    },
    {
      clave: "rechazar",
      titulo: "Rechazar",
      ancho: 90,
      alinear: "center",
      ordenable: false,
      texto: () => "",
      celda: (p) => (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
          title={esParcial(p) ? "Cerrar saldo" : "Rechazar"}
          disabled={p.cantidadPendiente <= 0}
          aria-label={`${esParcial(p) ? "Cerrar saldo de la requisición de" : "Rechazar insumo"} ${p.insumoDescripcion}`}
          onClick={() => {
            setError(null)
            setPedidoARechazar(p)
          }}
        >
          <X className="h-5 w-5" strokeWidth={3} />
        </Button>
      ),
    },
    {
      clave: "comprar",
      titulo: "Comprar",
      ancho: 90,
      alinear: "center",
      ordenable: false,
      texto: () => "",
      celda: (p) => (
        <Checkbox
          aria-label={`Comprar requisición de ${p.insumoDescripcion}`}
          disabled={p.cantidadPendiente <= 0}
          checked={seleccionados.has(p.id)}
          onCheckedChange={() => onToggleSeleccion(p.id)}
        />
      ),
    },
  ]
  const { ordenadas, orden, ordenar } = useOrdenExcel(ordenados, columnas)

  if (pedidos.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        No hay requisiciones aprobadas con estos filtros.
      </div>
    )
  }

  return (
    <>
      <TablaExcel
        filas={ordenadas}
        columnas={columnas}
        claveFila={(p) => p.id}
        orden={orden}
        onOrdenar={ordenar}
        onDobleClickFila={setViendo}
        tituloFila={AYUDA_DOBLE_CLIC}
        fondoFila={(p) => (p.urgente ? "bg-amber-50" : undefined)}
        tarjeta={{
          titulo: (p) => `${p.insumoCodigo} · ${p.insumoDescripcion}`,
          subtitulo: (p) => `Requisición # ${p.requisicionNumero ?? "—"} · ${p.solicitadoPorNombre ?? "—"}`,
          esquina: (p) => columnas.find((c) => c.clave === "comprar")!.celda!(p),
          campos: ["um", "cantidad", "valor", "requerida", "urgente", "rechazar"],
        }}
      />

      <VentanaDetalle
        abierta={viendo !== null}
        onCerrar={() => setViendo(null)}
        titulo={viendo ? `${viendo.insumoCodigo} · ${viendo.insumoDescripcion}` : ""}
        subtitulo={viendo ? `Requisición # ${viendo.requisicionNumero ?? "—"}` : undefined}
        campos={
          viendo
            ? [
                { etiqueta: "UM", valor: viendo.um ?? "" },
                {
                  etiqueta: "Cantidad pendiente",
                  valor: `${viendo.cantidadPendiente.toLocaleString("es-CO")}${
                    textoConversionCompra(viendo.cantidadUso, viendo.unidadUso, viendo.factor, viendo.um)
                      ? ` (${textoConversionCompra(viendo.cantidadUso, viendo.unidadUso, viendo.factor, viendo.um)})`
                      : ""
                  }`,
                },
                {
                  etiqueta: "Vr. unit. proyectado",
                  valor: viendo.valorUnitarioProyectado != null ? formatoMoneda.format(viendo.valorUnitarioProyectado) : "",
                },
                { etiqueta: "Solicitante", valor: viendo.solicitadoPorNombre ?? "" },
                { etiqueta: "Fecha de la requisición", valor: formatoFecha(viendo.fechaPedido) },
                { etiqueta: "Fecha requerida", valor: formatearFechaSinHora(viendo.fechaRequerida) },
                { etiqueta: "Urgente", valor: viendo.urgente ? "Sí" : "No" },
                { etiqueta: "Observaciones", valor: viendo.observaciones ?? "", ancho: "completo" as const },
              ]
            : []
        }
        acciones={
          viendo && (
            <>
              <Button
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                disabled={viendo.cantidadPendiente <= 0}
                onClick={() => {
                  setError(null)
                  setPedidoARechazar(viendo)
                }}
              >
                <X className="mr-1.5 h-4 w-4" />
                {esParcial(viendo) ? "Cerrar saldo" : "Rechazar"}
              </Button>
              <Button
                variant={seleccionados.has(viendo.id) ? "outline" : "default"}
                disabled={viendo.cantidadPendiente <= 0}
                onClick={() => onToggleSeleccion(viendo.id)}
              >
                {seleccionados.has(viendo.id) ? "Quitar de la compra" : "Marcar para comprar"}
              </Button>
            </>
          )
        }
      />

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
              {pedidoARechazar && esParcial(pedidoARechazar) ? "Cerrar saldo de la requisición" : "Rechazar insumo"}
            </DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            {pedidoARechazar?.insumoDescripcion} — {pedidoARechazar?.cantidadPendiente} {pedidoARechazar?.um}
            {pedidoARechazar && pedidoARechazar.cantidadPendiente < pedidoARechazar.cantidad ? (
              <span> (de {pedidoARechazar.cantidad} solicitadas originalmente)</span>
            ) : null}
          </p>
          {pedidoARechazar && !esParcial(pedidoARechazar) && (
            <p className="text-sm text-muted-foreground">
              Solo se rechaza este insumo; el resto de la requisición sigue igual.
            </p>
          )}

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
                  : "Rechazar insumo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}