// ---------------------------------------------------------------------------
// Caja menor en el Consolidado (20270101007600, decisión del usuario 2026-11-26):
// el reembolso es UN pago (lo que se dispersa), pero Contabilidad ve y liquida
// cada gasto como si fuera un pago: en la tabla, debajo del reembolso, sale una
// fila por gasto con las mismas columnas, y en el Excel de liquidación el
// reembolso se reemplaza por sus gastos. Las filas de gasto son "pagos" de
// mentira (id "gasto:<pago>:<gasto>"); lo que se escribe se guarda en el gasto
// (liquidar_gastos_caja_menor) y, con todos liquidados, el pago queda liquidado
// con la suma.
//
// Archivo plano (pruebas en tests/caja-menor-consolidado.test.ts).
// ---------------------------------------------------------------------------

import type { FilaLiquidacion, Pago } from "@/lib/pagos"
import type { GastoDetalle } from "@/lib/caja-menor"

/** Los gastos de la caja menor de un pago (el reembolso). */
export type GastosDePago = {
  pagoId: string
  legalizacionId: string
  codigo: string // CM-001-0001
  pagoLiquidacionEstado: string | null
  gastos: GastoDetalle[]
}

const PREFIJO = "gasto:"

export const idFilaGasto = (pagoId: string, gastoId: string) => `${PREFIJO}${pagoId}:${gastoId}`

export function leerIdFilaGasto(id: string): { pagoId: string; gastoId: string } | null {
  if (!id.startsWith(PREFIJO)) return null
  const [pagoId, gastoId] = id.slice(PREFIJO.length).split(":")
  return pagoId && gastoId ? { pagoId, gastoId } : null
}

export const esFilaGasto = (p: Pick<Pago, "id">) => p.id.startsWith(PREFIJO)

/** Enlace fijo al soporte de un gasto (como /ayf/soporte-pago/<pago>). */
export const rutaSoporteGasto = (gastoId: string) => `/ayf/soporte-pago/gasto/${gastoId}`

/** Un gasto como fila de pago: las columnas del Consolidado lo muestran igual que un pago. */
export function filaDeGasto(padre: Pago, cm: Pick<GastosDePago, "codigo">, g: GastoDetalle): Pago {
  const l = g.liquidacion
  return {
    ...padre,
    id: idFilaGasto(padre.id, g.id),
    concepto: `${g.concepto} · ${g.destino}`,
    valor: g.valor,
    valorDocumento: g.valor,
    origen: `${cm.codigo} · gasto ${g.orden}`,
    referencia: padre.referencia ? `${padre.referencia} · ${g.orden}` : null,
    terceroId: null,
    terceroNombre: g.nombre,
    terceroDocumento: g.documento,
    terceroRut: null,
    numeroFactura: g.numeroFactura,
    cuentaId: null,
    cuentaTexto: "Caja menor (efectivo)",
    cuentaVerificada: true,
    cuentaTitular: null,
    novedad: null,
    baseGravable: null,
    iva: null,
    descuentoAnticipos: 0,
    retencionGarantia: 0,
    otrosDescuentos: 0,
    // Un gasto liquidado se ve "Liquidado" aunque el pago siga por liquidar.
    liquidacionEstado: l ? "liquidado" : padre.liquidacionEstado,
    liqBase: l?.base ?? null,
    liqIva: l?.iva ?? null,
    retefuente: l?.retefuente ?? null,
    reteiva: l?.reteiva ?? null,
    reteica: l?.reteica ?? null,
    asumidas: l ? 0 : null,
    liquidaciones: l ? 0 : null,
    liqAnticiposDescuentos: l ? 0 : null,
    valorAPagar: l?.valorAPagar ?? null,
    ultimoComentario: null,
    requisicionAdminLote: null,
    cajaMenorGasto: {
      pagoId: padre.id,
      gastoId: g.id,
      orden: g.orden,
      codigo: cm.codigo,
      fecha: g.fecha,
      soporteNombre: g.soporte.nombre,
    },
  }
}

/**
 * La lista de la tabla: cada pago y, debajo de un reembolso de caja menor
 * desplegado, una fila por gasto. `desplegado(pagoId)` dice si se muestran.
 */
export function conFilasDeGastos(
  pagos: Pago[],
  gastos: Record<string, GastosDePago>,
  desplegado: (pagoId: string) => boolean
): Pago[] {
  const salida: Pago[] = []
  for (const p of pagos) {
    const cm = gastos[p.id]
    salida.push(cm ? { ...p, cajaMenor: { legalizacionId: cm.legalizacionId, codigo: cm.codigo, nGastos: cm.gastos.length } } : p)
    if (cm && desplegado(p.id)) for (const g of cm.gastos) salida.push(filaDeGasto(p, cm, g))
  }
  return salida
}

/** Excel de liquidación: el reembolso de caja menor se reemplaza por una fila por gasto. */
export function paraExcelConGastos(pagos: Pago[], gastos: Record<string, GastosDePago>): Pago[] {
  const salida: Pago[] = []
  for (const p of pagos) {
    const cm = gastos[p.id]
    if (cm && cm.gastos.length > 0) for (const g of cm.gastos) salida.push(filaDeGasto(p, cm, g))
    else salida.push(p)
  }
  return salida
}

export type FilaGastoParaGuardar = {
  gasto_id: string
  base: number | null
  iva: number | null
  retefuente: number | null
  reteiva: number | null
  reteica: number | null
  valor_a_pagar: number | null
  sin_retenciones: boolean
}

/**
 * Separa lo leído del Excel: filas de pagos de siempre, filas de gasto
 * agrupadas por su pago (para liquidar_gastos_caja_menor) y los comentarios
 * escritos en filas de gasto (van como observación del pago del reembolso).
 */
export function separarFilasDeGastos(filas: FilaLiquidacion[]): {
  pagos: FilaLiquidacion[]
  gastosPorPago: Map<string, { filaId: string; fila: FilaGastoParaGuardar }[]>
  comentariosPorPago: Map<string, string[]>
} {
  const pagos: FilaLiquidacion[] = []
  const gastosPorPago = new Map<string, { filaId: string; fila: FilaGastoParaGuardar }[]>()
  const comentariosPorPago = new Map<string, string[]>()
  for (const f of filas) {
    const id = leerIdFilaGasto(f.pagoId)
    if (!id) {
      pagos.push(f)
      continue
    }
    if (f.comentario) {
      const lista = comentariosPorPago.get(id.pagoId) ?? []
      lista.push(f.comentario)
      comentariosPorPago.set(id.pagoId, lista)
    }
    if (f.valorAPagar == null && !f.sinRetenciones) continue
    const lista = gastosPorPago.get(id.pagoId) ?? []
    lista.push({
      filaId: f.pagoId,
      fila: {
        gasto_id: id.gastoId,
        base: f.base,
        iva: f.iva,
        retefuente: f.retefuente,
        reteiva: f.reteiva,
        reteica: f.reteica,
        valor_a_pagar: f.valorAPagar,
        sin_retenciones: f.sinRetenciones,
      },
    })
    gastosPorPago.set(id.pagoId, lista)
  }
  return { pagos, gastosPorPago, comentariosPorPago }
}

/**
 * ¿Las filas del Excel dicen lo mismo que la liquidación guardada? (Para que un
 * Excel de ida y vuelta no falle en un reembolso ya liquidado.)
 */
export function mismaLiquidacionDeGastos(filas: FilaGastoParaGuardar[], gastos: GastoDetalle[]): boolean {
  const porId = new Map(gastos.map((g) => [g.id, g]))
  const igual = (a: number | null | undefined, b: number | null | undefined) => Math.abs((a ?? 0) - (b ?? 0)) < 0.005
  return filas.every((f) => {
    const g = porId.get(f.gasto_id)
    const l = g?.liquidacion
    if (!g || !l) return false
    if (f.sin_retenciones) return igual(l.valorAPagar, g.valor) && igual(l.retefuente + l.reteiva + l.reteica, 0)
    return (
      igual(f.valor_a_pagar, l.valorAPagar) &&
      igual(f.retefuente, l.retefuente) &&
      igual(f.reteiva, l.reteiva) &&
      igual(f.reteica, l.reteica)
    )
  })
}
