"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ETIQUETA_TIPO_PAGO_CIERRE, type VistaCierreFaltante } from "@/lib/saldo-favor"
import { cerrarOrdenConFaltante, vistaCierreFaltante } from "@/app/(app)/almacen/ordenes-compra/saldos-actions"

// ---------------------------------------------------------------------------
// "Cerrar con faltante" (Paquete C, entrega 2): el proveedor ya no va a
// entregar el resto. Muestra antes qué pasa (lo calcula la base): cada insumo
// queda en lo recibido, lo que faltó vuelve a Requisiciones por comprar, se
// descuenta de los pagos que todavía no se han aprobado y lo ya pagado de más
// queda como saldo a favor del proveedor.
// ---------------------------------------------------------------------------

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const cantidad = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })
const ESTADO_PAGO: Record<string, string> = { programado: "programado", solicitado: "por aprobar", en_espera: "crédito en espera" }

export function CerrarFaltanteDialog({
  ordenId,
  codigo,
  abierto,
  onCerrar,
  onCerrada,
}: {
  ordenId: string
  codigo: string
  abierto: boolean
  onCerrar: () => void
  onCerrada: (mensaje: string) => void
}) {
  const [vista, setVista] = useState<{ ordenId: string; datos: VistaCierreFaltante | null; error: string | null } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    vistaCierreFaltante(ordenId)
      .then((d: VistaCierreFaltante) => vigente && setVista({ ordenId, datos: d, error: null }))
      .catch((e) => vigente && setVista({ ordenId, datos: null, error: e instanceof Error ? e.message : "No se pudo calcular el cierre." }))
    return () => {
      vigente = false
    }
  }, [abierto, ordenId])

  const actual = vista?.ordenId === ordenId ? vista : null
  const d = actual?.datos ?? null

  async function confirmar() {
    if (motivo.trim().length < 3) {
      setError("Escribe el motivo del cierre.")
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const r = await cerrarOrdenConFaltante(ordenId, motivo)
      setMotivo("")
      setVista(null)
      onCerrada(
        `Orden cerrada con faltante (${pesos.format(r.valorFaltante)}).` +
          (r.pagosReducidos > 0 ? ` Se descontaron ${pesos.format(r.pagosReducidos)} de pagos por aprobar.` : "") +
          (r.saldoFavor > 0 ? ` Quedó un saldo a favor de ${pesos.format(r.saldoFavor)} con el proveedor.` : "")
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar la orden.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        if (!v && !guardando) {
          setError(null)
          onCerrar()
        }
      }}
    >
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cerrar {codigo} con faltante</DialogTitle>
          <DialogDescription>
            Para cuando el proveedor ya no va a entregar el resto. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        {!actual ? (
          <p className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Calculando…
          </p>
        ) : actual.error ? (
          <p className="text-sm text-destructive">{actual.error}</p>
        ) : d ? (
          <div className="space-y-4 text-sm">
            {d.motivoNo && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">{d.motivoNo}</p>}

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[560px]">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Insumo</th>
                    <th className="px-3 py-2 text-right font-medium">Pedido</th>
                    <th className="px-3 py-2 text-right font-medium">Recibido</th>
                    <th className="px-3 py-2 text-right font-medium">Faltante</th>
                    <th className="px-3 py-2 text-right font-medium">Valor del faltante</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {d.lineas.map((l) => (
                    <tr key={l.id} className={l.recibido >= l.pedido ? "text-muted-foreground" : ""}>
                      <td className="px-3 py-2">
                        {l.insumoCodigo != null && <span className="text-muted-foreground">{l.insumoCodigo} </span>}
                        {l.insumoDescripcion}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {cantidad.format(l.pedido)} {l.unidad?.toLowerCase() ?? ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{cantidad.format(l.recibido)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{cantidad.format(Math.max(l.pedido - l.recibido, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pesos.format(l.valorFaltante)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-1 rounded-md border bg-muted/30 p-3 tabular-nums">
              <div className="flex justify-between gap-3">
                <span>Total de la orden</span>
                <span>{pesos.format(d.totalActual)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Valor de lo no entregado</span>
                <span>− {pesos.format(d.valorFaltante)}</span>
              </div>
              <div className="flex justify-between gap-3 border-t pt-1 font-medium">
                <span>La orden queda en</span>
                <span>{pesos.format(d.totalNuevo)}</span>
              </div>
            </div>

            <div className="space-y-1">
              <p className="font-medium">Qué pasa con los pagos</p>
              {d.pagos.length === 0 && d.saldoFavor <= 0 && <p className="text-muted-foreground">Ningún pago cambia.</p>}
              {d.pagos.map((p, i) => (
                <p key={i}>
                  {ETIQUETA_TIPO_PAGO_CIERRE[p.tipo] ?? p.tipo} ({ESTADO_PAGO[p.estado] ?? p.estado}): {pesos.format(p.valor)} →{" "}
                  {p.queda > 0 ? pesos.format(p.queda) : "se anula"}
                </p>
              ))}
              {d.saldoFavor > 0 && (
                <p className="rounded-md border-2 border-emerald-500 bg-emerald-50 px-3 py-2 font-medium text-emerald-950">
                  Lo ya pagado de más queda como saldo a favor del proveedor: {pesos.format(d.saldoFavor)}. Se puede usar en la próxima orden a
                  este proveedor en la misma empresa.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Lo que faltó vuelve a Requisiciones por comprar. La orden queda Entregada y Control del proyecto cuenta solo lo recibido.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="motivo-cierre-faltante">Motivo *</Label>
              <Textarea
                id="motivo-cierre-faltante"
                rows={2}
                value={motivo}
                disabled={guardando || !!d.motivoNo}
                placeholder="Por qué el proveedor no entrega el resto"
                onChange={(e) => {
                  setMotivo(e.target.value)
                  setError(null)
                }}
              />
            </div>
            {error && <p className="text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={guardando} onClick={onCerrar}>
                Cancelar
              </Button>
              <Button variant="destructive" disabled={guardando || !!d.motivoNo} onClick={confirmar}>
                {guardando && <Loader2 className="mr-1.5 size-4 animate-spin" />} Cerrar con faltante
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
