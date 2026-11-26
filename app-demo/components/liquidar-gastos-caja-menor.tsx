"use client"

import { useEffect, useState } from "react"
import { Loader2, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { verSoporteGasto } from "@/components/detalle-legalizacion-caja-menor"
import { esFormula, leerNumeroOFormula } from "@/lib/formula-numero"
import { formatoMoneda } from "@/lib/pagos"
import { formatearFechaSinHora } from "@/lib/fechas"
import {
  CAMPOS_LIQUIDACION_GASTO,
  filaLiquidacionGasto,
  formLiquidacionGasto,
  resumenLiquidacionGastos,
  sinRetencionesGasto,
  valorDe,
  type FormLiquidacionGasto,
  type LegalizacionDetalle,
  type ResultadoLiquidacionGastos,
} from "@/lib/caja-menor"
import { liquidarGastosCajaMenor, obtenerLegalizacion } from "@/app/(app)/ayf/cajas-menores/actions"

// Contabilidad liquida el reembolso de una caja menor GASTO POR GASTO
// (20270101007600): base, IVA y retenciones de cada factura, o «Sin retenciones».
// Puede guardar unos hoy y otros después; cuando están todos, el pago queda
// liquidado con la suma y Financiera lo dispersa como un solo pago.
export function LiquidarGastosCajaMenor({
  abierto,
  pagoId,
  legalizacionId,
  editable,
  onCerrar,
  onGuardado,
}: {
  abierto: boolean
  pagoId: string
  legalizacionId: string
  editable: boolean
  onCerrar: () => void
  onGuardado: (r: ResultadoLiquidacionGastos) => void
}) {
  const [detalle, setDetalle] = useState<LegalizacionDetalle | null>(null)
  const [forms, setForms] = useState<Record<string, FormLiquidacionGasto>>({})
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    obtenerLegalizacion(legalizacionId)
      .then((d: LegalizacionDetalle) => {
        if (!vigente) return
        setDetalle(d)
        setForms(Object.fromEntries(d.gastos.map((g) => [g.id, formLiquidacionGasto(g)])))
      })
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudo cargar la caja menor."))
    return () => {
      vigente = false
    }
  }, [abierto, legalizacionId])

  const cambiar = (id: string, clave: keyof FormLiquidacionGasto, valor: string) =>
    setForms((f) => ({ ...f, [id]: { ...f[id], [clave]: valor } }))

  const leer = (t: string) => leerNumeroOFormula(t)

  // Lo que va escrito en pantalla (para el resumen de abajo).
  const enPantalla =
    detalle?.gastos.map((g) => {
      const f = forms[g.id]
      const vap = f && f.valorAPagar.trim() ? leer(f.valorAPagar) : null
      const ret = (k: "retefuente" | "reteiva" | "reteica") => (f && f[k].trim() ? leer(f[k]) ?? 0 : 0)
      return {
        liquidacion:
          vap != null
            ? { base: null, iva: null, retefuente: ret("retefuente"), reteiva: ret("reteiva"), reteica: ret("reteica"), valorAPagar: vap, liquidadoEn: null, liquidadoPorNombre: null }
            : null,
      }
    }) ?? []
  const resumen = resumenLiquidacionGastos(enPantalla)

  async function guardar() {
    if (!detalle) return
    setGuardando(true)
    setError(null)
    try {
      const filas = detalle.gastos.map((g) => filaLiquidacionGasto(g, forms[g.id], leer))
      const r = valorDe(await liquidarGastosCajaMenor(pagoId, filas))
      onGuardado(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la liquidación.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && !guardando && onCerrar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-7xl">
        <DialogHeader>
          <DialogTitle>Liquidar gastos · caja menor {detalle?.codigo ?? ""}</DialogTitle>
          <DialogDescription>
            Cada gasto se liquida con su factura. Todos se reembolsan: los que no llevan retenciones, con «Sin retenciones».
            Cuando estén todos, el pago queda liquidado con la suma y Financiera lo dispersa como un solo pago.
          </DialogDescription>
        </DialogHeader>

        {!detalle ? (
          error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </p>
          )
        ) : (
          <>
            {editable && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={guardando}
                  onClick={() =>
                    setForms((f) =>
                      Object.fromEntries(
                        detalle.gastos.map((g) => [g.id, f[g.id].valorAPagar.trim() ? f[g.id] : sinRetencionesGasto(g, f[g.id])])
                      )
                    )
                  }
                >
                  Los que faltan, sin retenciones
                </Button>
              </div>
            )}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[1300px] text-sm">
                <thead>
                  <tr>
                    <th className="w-10 px-2 py-2">N°</th>
                    <th className="w-24 px-2 py-2">Fecha</th>
                    <th className="px-2 py-2">Quién vendió</th>
                    <th className="px-2 py-2">Concepto</th>
                    <th className="w-28 px-2 py-2">Valor</th>
                    <th className="w-20 px-2 py-2">Soporte</th>
                    {CAMPOS_LIQUIDACION_GASTO.map((c) => (
                      <th key={c.clave} className="w-28 px-2 py-2">
                        {c.titulo}
                      </th>
                    ))}
                    {editable && <th className="w-32 px-2 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {detalle.gastos.map((g) => (
                    <tr key={g.id} className={g.liquidacion ? "bg-green-50/50" : undefined}>
                      <td className="px-2 py-1.5 text-right align-top tabular-nums">{g.orden}</td>
                      <td className="px-2 py-1.5 align-top">{formatearFechaSinHora(g.fecha)}</td>
                      <td className="px-2 py-1.5 align-top">
                        {g.nombre}
                        <span className="block text-xs text-muted-foreground">
                          {g.documento} · Fact. {g.numeroFactura}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        {g.concepto}
                        <span className="block text-xs text-muted-foreground">{g.destino}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right align-top tabular-nums">{formatoMoneda(g.valor)}</td>
                      <td className="px-2 py-1.5 align-top">
                        <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => verSoporteGasto(g.soporte.ruta)}>
                          <Paperclip className="mr-1 size-3.5" /> Ver
                        </Button>
                      </td>
                      {CAMPOS_LIQUIDACION_GASTO.map((c) => (
                        <td key={c.clave} className="px-2 py-1.5 align-top">
                          <Input
                            value={forms[g.id]?.[c.clave] ?? ""}
                            disabled={!editable || guardando}
                            inputMode="text"
                            title="Puedes escribir una fórmula, como en Excel: =100000*4%"
                            className={`h-8 text-right text-sm tabular-nums ${c.clave === "valorAPagar" ? "font-medium" : ""}`}
                            onChange={(e) => cambiar(g.id, c.clave, e.target.value)}
                            onBlur={() => {
                              const v = forms[g.id]?.[c.clave] ?? ""
                              if (!esFormula(v)) return
                              const n = leer(v)
                              if (n != null) cambiar(g.id, c.clave, String(n).replace(".", ","))
                            }}
                          />
                        </td>
                      ))}
                      {editable && (
                        <td className="px-2 py-1.5 align-top">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={guardando}
                            onClick={() => setForms((f) => ({ ...f, [g.id]: sinRetencionesGasto(g, f[g.id]) }))}
                          >
                            Sin retenciones
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">
                {resumen.liquidados} de {resumen.total} gasto(s) con valor a pagar
                {resumen.liquidados < resumen.total ? " (puedes guardar y terminar después)" : ""}
              </span>
              <span>
                Retenciones: <span className="tabular-nums">{formatoMoneda(resumen.retenciones)}</span> · Valor a pagar del reembolso:{" "}
                <span className="font-semibold tabular-nums">{formatoMoneda(resumen.valorAPagar)}</span> de{" "}
                <span className="tabular-nums">{formatoMoneda(detalle.valorTotal)}</span>
              </span>
            </div>
            {!editable && (
              <p className="text-xs text-muted-foreground">
                Solo consulta: se liquida cuando el pago está en Por liquidar u Observados. Para cambiar un gasto de un pago ya
                liquidado, devuelve el pago a Por liquidar.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={guardando} onClick={onCerrar}>
            Cerrar
          </Button>
          {editable && detalle && (
            <Button type="button" disabled={guardando} onClick={guardar}>
              {guardando && <Loader2 className="mr-1 size-4 animate-spin" />} Guardar liquidación
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
