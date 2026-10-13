"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { formatearFechaSinHora } from "@/lib/fechas"
import { numero, pesos } from "@/lib/contratos"
import { CLASE_ESTADO_ACTA, ETIQUETA_ESTADO_ACTA, saldoContrato, type ActaDetalle } from "@/lib/actas"
import { obtenerActa } from "@/app/(app)/contratos/actas/actions"

// Detalle de un acta en un diálogo (Elaboración y Aprobación de actas): el
// contrato con su cupo, las líneas y el total. Cada pantalla pone sus botones.
export function DetalleActa({
  id,
  onCerrar,
  acciones,
}: {
  id: string | null
  onCerrar: () => void
  acciones?: (acta: ActaDetalle) => React.ReactNode
}) {
  const [acta, setActa] = useState<ActaDetalle | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let vigente = true
    obtenerActa(id)
      .then((a) => vigente && setActa(a))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudo cargar el acta."))
    return () => {
      vigente = false
    }
  }, [id])

  function cerrar() {
    setActa(null)
    setError(null)
    onCerrar()
  }

  const visible = acta && acta.id === id ? acta : null
  // Cupo visto desde esta acta: lo que usan las demás + esta (si no está rechazada).
  const usado = visible ? visible.otrasActas + (visible.estado === "rechazada" ? 0 : visible.total) : 0

  return (
    <Dialog open={id !== null} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto [scrollbar-width:thin] sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {visible ? `Acta ${visible.numero} · ${visible.numeroContrato}` : "Acta"}
            {visible && (
              <Badge className={`h-6 px-3 text-xs ${CLASE_ESTADO_ACTA[visible.estado]}`}>{ETIQUETA_ESTADO_ACTA[visible.estado]}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !visible ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando acta...
          </p>
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Dato titulo="Contratista">
                {visible.contratistaNombre} <span className="text-muted-foreground">({visible.contratistaDocumento})</span>
              </Dato>
              <Dato titulo="Proyecto">
                {visible.proyectoCodigo} · {visible.proyectoNombre}
              </Dato>
              <Dato titulo="Tipo de contrato">{tituloTipoContrato(visible.tipo)}</Dato>
              <Dato titulo="Elaborada">
                {formatearFechaSinHora(visible.createdAt)}
                {visible.creadoPorNombre ? ` por ${visible.creadoPorNombre}` : ""}
              </Dato>
              <div className="sm:col-span-2">
                <Dato titulo="Objeto">{visible.objeto}</Dato>
              </div>
              {visible.resueltoAt && (
                <Dato titulo={visible.estado === "aprobada" ? "Aprobada" : "Rechazada"}>
                  {formatearFechaSinHora(visible.resueltoAt)}
                  {visible.resueltoPorNombre ? ` por ${visible.resueltoPorNombre}` : ""}
                </Dato>
              )}
              {visible.motivoResolucion && <Dato titulo="Motivo">{visible.motivoResolucion}</Dato>}
            </div>

            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
              <Cifra titulo="Valor del contrato" valor={visible.contratoValor} />
              <Cifra titulo="Otras actas" valor={visible.otrasActas} />
              <Cifra titulo="Esta acta" valor={visible.total} fuerte />
              <Cifra titulo="Saldo del contrato" valor={saldoContrato(visible.contratoValor, usado)} />
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr className="[&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
                    <th className="w-10 text-center">#</th>
                    <th>Ítem</th>
                    <th>Insumo</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-right">Precio</th>
                    <th className="text-right">Base IVA</th>
                    <th className="text-right">IVA %</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.lineas.map((l) => (
                    <tr key={l.orden} className="border-t align-top [&_td]:px-3 [&_td]:py-2">
                      <td className="text-center text-muted-foreground">{l.orden}</td>
                      <td>
                        <span className="font-medium">{l.itemCodigo}</span> {l.itemDescripcion}
                      </td>
                      <td>
                        {l.insumoCodigo != null && <span className="text-muted-foreground">{l.insumoCodigo} · </span>}
                        {l.insumoDescripcion}
                      </td>
                      <td className="text-right tabular-nums">
                        {numero(l.cantidad)}
                        {l.unidad && <span className="block text-xs text-muted-foreground">{l.unidad}</span>}
                      </td>
                      <td className="text-right tabular-nums">{pesos(l.precio)}</td>
                      <td className="text-right tabular-nums">{pesos(l.baseIva)}</td>
                      <td className="text-right tabular-nums">{numero(l.ivaPorcentaje)} %</td>
                      <td className="text-right font-medium tabular-nums">{pesos(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30">
                    <td colSpan={7} className="px-3 py-2 text-right font-semibold">
                      Total del acta
                    </td>
                    <td className="px-3 py-2 text-right text-base font-semibold tabular-nums">{pesos(visible.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {acciones && <DialogFooter>{acciones(visible)}</DialogFooter>}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <p>{children}</p>
    </div>
  )
}

function Cifra({ titulo, valor, fuerte }: { titulo: string; valor: number; fuerte?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={`tabular-nums ${fuerte ? "font-semibold" : ""} ${valor < 0 ? "text-destructive" : ""}`}>{pesos(valor)}</p>
    </div>
  )
}
