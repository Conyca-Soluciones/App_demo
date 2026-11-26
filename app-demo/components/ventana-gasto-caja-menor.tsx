"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, Loader2, Paperclip } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EtiquetaEtapa } from "@/components/ventana-pago-liquidacion"
import { esFormula, leerNumeroOFormula } from "@/lib/formula-numero"
import { formatoMoneda, type Pago } from "@/lib/pagos"
import { formatearFechaSinHora } from "@/lib/fechas"
import { rutaSoporteGasto } from "@/lib/caja-menor-consolidado"
import {
  CAMPOS_LIQUIDACION_GASTO,
  filaLiquidacionGasto,
  sinRetencionesGasto,
  valorDe,
  type FormLiquidacionGasto,
  type ResultadoLiquidacionGastos,
} from "@/lib/caja-menor"
import { liquidarGastosCajaMenor } from "@/app/(app)/ayf/cajas-menores/actions"

const aTexto = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","))

function formDe(f: Pago): FormLiquidacionGasto {
  return {
    base: aTexto(f.liqBase),
    iva: aTexto(f.liqIva),
    retefuente: aTexto(f.retefuente),
    reteiva: aTexto(f.reteiva),
    reteica: aTexto(f.reteica),
    valorAPagar: aTexto(f.valorAPagar),
  }
}

// Doble clic en una fila de gasto de caja menor del Consolidado (20270101007600):
// el gasto como si fuera un pago (quién vendió, factura, soporte) con su
// liquidación y Anterior / Siguiente entre los gastos de la lista. Se guarda en
// el gasto; con todos liquidados, el pago del reembolso queda liquidado con la suma.
export function VentanaGastoCajaMenor({
  filas,
  indice,
  padre,
  puedeLiquidar,
  onIndice,
  onCerrar,
  onGuardado,
}: {
  // Las filas de gasto de la tabla, en su orden.
  filas: Pago[]
  indice: number | null
  // El pago del reembolso de la fila que se ve.
  padre: Pago | null
  puedeLiquidar: boolean
  onIndice: (i: number) => void
  onCerrar: () => void
  onGuardado: (pagoId: string, r: ResultadoLiquidacionGastos) => void
}) {
  const fila = indice != null ? filas[indice] : null
  return (
    <Dialog open={fila != null} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        {fila && fila.cajaMenorGasto && (
          <Contenido
            key={fila.id}
            fila={fila}
            padre={padre}
            puedeLiquidar={puedeLiquidar}
            posicion={`${(indice ?? 0) + 1} de ${filas.length}`}
            anterior={indice != null && indice > 0 ? () => onIndice(indice - 1) : null}
            siguiente={indice != null && indice < filas.length - 1 ? () => onIndice(indice + 1) : null}
            onGuardado={onGuardado}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <div className="text-sm font-medium break-words">{children}</div>
    </div>
  )
}

function Contenido({
  fila,
  padre,
  puedeLiquidar,
  posicion,
  anterior,
  siguiente,
  onGuardado,
}: {
  fila: Pago
  padre: Pago | null
  puedeLiquidar: boolean
  posicion: string
  anterior: (() => void) | null
  siguiente: (() => void) | null
  onGuardado: (pagoId: string, r: ResultadoLiquidacionGastos) => void
}) {
  const g = fila.cajaMenorGasto!
  const [form, setForm] = useState<FormLiquidacionGasto>(() => formDe(fila))
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // Se liquida mientras el reembolso esté en Por liquidar u Observados.
  const enLiquidacion =
    padre?.estado === "aprobado" && (padre.liquidacionEstado === "por_liquidar" || padre.liquidacionEstado === "observado")
  const editable = puedeLiquidar && enLiquidacion
  const gastoBase = { id: g.gastoId, orden: g.orden, valor: fila.valor }

  async function guardar(f: FormLiquidacionGasto, luegoSiguiente: boolean) {
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const datos = filaLiquidacionGasto(gastoBase, f, (t) => leerNumeroOFormula(t))
      const r = valorDe(await liquidarGastosCajaMenor(g.pagoId, [datos]))
      setForm(f)
      onGuardado(g.pagoId, r)
      if (luegoSiguiente && siguiente) siguiente()
      else
        setAviso(
          r.pagoLiquidado
            ? "Todos los gastos liquidados: el reembolso quedó liquidado con la suma."
            : `Guardado. Van ${r.liquidados} de ${r.gastos} gastos de esta caja menor.`
        )
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Caja menor {g.codigo} · gasto {g.orden}
            <EtiquetaEtapa pago={fila} />
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground tabular-nums">{posicion}</span>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={!anterior || ocupado} onClick={() => anterior?.()} aria-label="Gasto anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={!siguiente || ocupado} onClick={() => siguiente?.()} aria-label="Gasto siguiente">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <DialogDescription>{fila.concepto}</DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-3 rounded-md border p-3 sm:grid-cols-3">
        <Dato titulo="Quién vendió">
          {fila.terceroNombre}
          <span className="block text-xs font-normal text-muted-foreground">{fila.terceroDocumento}</span>
        </Dato>
        <Dato titulo="Factura">{fila.numeroFactura ?? "—"}</Dato>
        <Dato titulo="Fecha">{formatearFechaSinHora(g.fecha)}</Dato>
        <Dato titulo="Valor del gasto">{formatoMoneda(fila.valor)}</Dato>
        <Dato titulo="Reembolso a">{padre?.terceroNombre ?? "—"}</Dato>
        <Dato titulo="Soporte">
          <a
            href={rutaSoporteGasto(g.gastoId)}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: "sm", variant: "outline", className: "h-7 gap-1 px-2" })}
          >
            <Paperclip className="h-3.5 w-3.5" /> {g.soporteNombre || "Ver"}
          </a>
        </Dato>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <h3 className="text-sm font-medium">Liquidación del gasto</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CAMPOS_LIQUIDACION_GASTO.map((c) => (
            <label key={c.clave} className="min-w-0 space-y-1">
              <span className="text-xs text-muted-foreground">{c.titulo}</span>
              <Input
                inputMode="text"
                title="Puedes escribir una fórmula, como en Excel: =100000*4%"
                className={`tabular-nums ${c.clave === "valorAPagar" ? "font-medium" : ""}`}
                value={form[c.clave]}
                disabled={!editable || ocupado}
                onChange={(e) => setForm((f) => ({ ...f, [c.clave]: e.target.value }))}
                onBlur={() => {
                  const v = form[c.clave]
                  if (!esFormula(v)) return
                  const n = leerNumeroOFormula(v)
                  if (n != null) setForm((f) => ({ ...f, [c.clave]: aTexto(n) }))
                }}
                onKeyDown={(e) => e.key === "Enter" && editable && guardar(form, true)}
              />
            </label>
          ))}
        </div>
        {!editable && (
          <p className="text-xs text-muted-foreground">
            {padre?.liquidacionEstado === "liquidado"
              ? "El reembolso ya está liquidado. Para cambiar un gasto, devuelve el pago del reembolso a Por liquidar."
              : "Se liquida cuando Financiera envía el reembolso a liquidar."}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {aviso && <p className="text-sm text-green-800">{aviso}</p>}
        {editable && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => guardar(sinRetencionesGasto(gastoBase, form), true)}>
              Liquidar sin retenciones
            </Button>
            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => guardar(form, false)}>
              Guardar liquidación
            </Button>
            <Button size="sm" disabled={ocupado || !siguiente} onClick={() => guardar(form, true)}>
              {ocupado && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Guardar y siguiente
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
