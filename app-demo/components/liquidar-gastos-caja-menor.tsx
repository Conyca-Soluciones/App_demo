"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, Loader2, Paperclip } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { esFormula, leerNumeroOFormula } from "@/lib/formula-numero"
import { formatoMoneda, rutaSoportePago } from "@/lib/pagos"
import { formatearFechaSinHora } from "@/lib/fechas"
import { rutaSoporteGasto } from "@/lib/caja-menor-consolidado"
import {
  CAMPOS_LIQUIDACION_GASTO,
  filaLiquidacionGasto,
  formLiquidacionGasto,
  resumenLiquidacionGastos,
  sinRetencionesGasto,
  valorDe,
  type FormLiquidacionGasto,
  type GastoDetalle,
  type LegalizacionDetalle,
  type ResultadoLiquidacionGastos,
} from "@/lib/caja-menor"
import { liquidarGastosCajaMenor, obtenerLegalizacion } from "@/app/(app)/ayf/cajas-menores/actions"

// Contabilidad liquida el reembolso de una caja menor GASTO POR GASTO
// (20270101007600): base, IVA y retenciones de cada factura, o «Sin retenciones».
// Puede guardar unos hoy y otros después; cuando están todos, el pago queda
// liquidado con la suma y Financiera lo dispersa como un solo pago.
// Ocupa toda la pantalla (no va encima de la ventana del pago); en celular cada
// gasto es una tarjeta.
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

  // Escape vuelve al Consolidado.
  useEffect(() => {
    if (!abierto) return
    const alTeclear = (e: KeyboardEvent) => e.key === "Escape" && !guardando && onCerrar()
    window.addEventListener("keydown", alTeclear)
    return () => window.removeEventListener("keydown", alTeclear)
  }, [abierto, guardando, onCerrar])

  if (!abierto || typeof document === "undefined") return null

  const cambiar = (id: string, clave: keyof FormLiquidacionGasto, valor: string) =>
    setForms((f) => ({ ...f, [id]: { ...f[id], [clave]: valor } }))
  const leer = (t: string) => leerNumeroOFormula(t)
  const resolverFormula = (id: string, clave: keyof FormLiquidacionGasto) => {
    const v = forms[id]?.[clave] ?? ""
    if (!esFormula(v)) return
    const n = leer(v)
    if (n != null) cambiar(id, clave, String(n).replace(".", ","))
  }

  // Lo que va escrito en pantalla (para el resumen).
  const enPantalla =
    detalle?.gastos.map((g) => {
      const f = forms[g.id]
      const vap = f && f.valorAPagar.trim() ? leer(f.valorAPagar) : null
      const ret = (k: "retefuente" | "reteiva" | "reteica") => (f && f[k].trim() ? (leer(f[k]) ?? 0) : 0)
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
      onGuardado(valorDe(await liquidarGastosCajaMenor(pagoId, filas)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la liquidación.")
    } finally {
      setGuardando(false)
    }
  }

  const campo = (g: GastoDetalle, c: (typeof CAMPOS_LIQUIDACION_GASTO)[number], clase = "") => (
    <Input
      value={forms[g.id]?.[c.clave] ?? ""}
      disabled={!editable || guardando}
      inputMode="text"
      aria-label={`${c.titulo} del gasto ${g.orden}`}
      title="Puedes escribir una fórmula, como en Excel: =100000*4%"
      className={`h-9 text-right tabular-nums ${c.clave === "valorAPagar" ? "font-medium" : ""} ${clase}`}
      onChange={(e) => cambiar(g.id, c.clave, e.target.value)}
      onBlur={() => resolverFormula(g.id, c.clave)}
    />
  )
  const botonSin = (g: GastoDetalle) =>
    editable ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={guardando}
        onClick={() => setForms((f) => ({ ...f, [g.id]: sinRetencionesGasto(g, f[g.id]) }))}
      >
        Sin retenciones
      </Button>
    ) : null
  const verSoporte = (g: GastoDetalle) => (
    <a
      href={rutaSoporteGasto(g.id)}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ size: "sm", variant: "outline", className: "h-8 gap-1 px-2" })}
    >
      <Paperclip className="h-3.5 w-3.5" /> Ver
    </a>
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label="Liquidar gastos de la caja menor">
      {/* Barra de arriba: volver, título y guardar (siempre a la vista). */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <Button type="button" variant="ghost" size="sm" disabled={guardando} onClick={onCerrar}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Volver
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">Liquidar gastos · caja menor {detalle?.codigo ?? ""}</h2>
          {detalle && (
            <p className="truncate text-xs text-muted-foreground">
              {detalle.responsableNombre} · {detalle.nGastos} gasto(s) · {formatoMoneda(detalle.valorTotal)}
            </p>
          )}
        </div>
        <a
          href={rutaSoportePago(pagoId)}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ size: "sm", variant: "outline", className: "gap-1" })}
        >
          <Paperclip className="h-4 w-4" /> Ver soporte
        </a>
        {editable && detalle && (
          <Button type="button" size="sm" disabled={guardando} onClick={guardar}>
            {guardando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar liquidación
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-4">
          <p className="text-sm text-muted-foreground">
            Cada gasto se liquida con su factura. Todos se reembolsan: los que no llevan retenciones, con «Sin retenciones».
            Puedes guardar unos hoy y terminar después. Cuando estén todos, el pago queda liquidado con la suma y Financiera lo
            dispersa como un solo pago.
          </p>

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

              {/* Celular y tablet angosta: una tarjeta por gasto. */}
              <div className="space-y-3 md:hidden">
                {detalle.gastos.map((g) => (
                  <div key={g.id} className={`space-y-3 rounded-lg border p-3 ${g.liquidacion ? "border-green-200 bg-green-50/40" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {g.orden}. {g.nombre}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {g.documento} · Fact. {g.numeroFactura} · {formatearFechaSinHora(g.fecha)}
                        </p>
                        <p className="text-sm">
                          {g.concepto} <span className="text-muted-foreground">· {g.destino}</span>
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-semibold tabular-nums">{formatoMoneda(g.valor)}</p>
                        {verSoporte(g)}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {CAMPOS_LIQUIDACION_GASTO.map((c) => (
                        <label key={c.clave} className="min-w-0 space-y-1">
                          <span className="text-xs text-muted-foreground">{c.titulo}</span>
                          {campo(g, c)}
                        </label>
                      ))}
                    </div>
                    {editable && <div className="flex justify-end">{botonSin(g)}</div>}
                  </div>
                ))}
              </div>

              {/* Pantalla ancha: tabla. */}
              <div className="hidden overflow-x-auto rounded-md border md:block">
                <table className="w-full min-w-[1200px] text-sm">
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
                        <td className="px-2 py-1.5 align-top">{verSoporte(g)}</td>
                        {CAMPOS_LIQUIDACION_GASTO.map((c) => (
                          <td key={c.clave} className="px-2 py-1.5 align-top">
                            {campo(g, c)}
                          </td>
                        ))}
                        {editable && <td className="px-2 py-1.5 align-top">{botonSin(g)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-1 rounded-md border bg-muted/30 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="text-muted-foreground">
                  {resumen.liquidados} de {resumen.total} gasto(s) con valor a pagar
                  {resumen.liquidados < resumen.total ? " (puedes guardar y terminar después)" : ""}
                </span>
                <span>
                  Retenciones: <span className="tabular-nums">{formatoMoneda(resumen.retenciones)}</span> · Valor a pagar:{" "}
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
              {editable && (
                <div className="flex justify-end pb-6">
                  <Button type="button" disabled={guardando} onClick={guardar}>
                    {guardando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar liquidación
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
