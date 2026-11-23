// Requisiciones en la unidad de compra del insumo (decisión del usuario, 2026-11-23).
//
// El ingeniero pide en la unidad de la maestra de insumos (rollos), pero el cupo del
// presupuesto vive en la unidad de la línea del APU (metros): 1 rollo = `factor` m
// (item_apu.factor_unidad). La base sigue guardando la cantidad en metros y
// revisando el tope en metros (disponible_insumo_item); aquí solo se convierte.
//
// - Lo disponible se muestra en unidades de compra COMPLETAS, hacia abajo: con 250 m
//   y rollos de 100 m se pueden pedir 2 rollos (3 = 300 m pasaría del presupuesto).
// - Lo pedido (n unidades de compra) se manda a la base como n × factor metros.
// - Una línea en otra unidad que la del insumo y sin conversión no se puede pedir
//   ("conversión de unidad pendiente"): se arregla en el APU.

import { lineaNecesitaConversion, normalizarUnidad } from "@/lib/unidades"

const TOLERANCIA = 1e-9

/** Unidades de compra completas que caben en lo disponible (en la unidad del APU). */
export function disponibleEnCompra(disponibleUso: number, factor: number): number {
  if (!(factor > 0) || !(disponibleUso > 0)) return 0
  return Math.floor(disponibleUso / factor + TOLERANCIA)
}

/** Cantidad en la unidad del APU que equivale a `cantidadCompra` unidades de compra. */
export function cantidadEnUso(cantidadCompra: number, factor: number): number {
  return Math.round(cantidadCompra * (factor > 0 ? factor : 1) * 10_000) / 10_000
}

/** Cantidad guardada (unidad del APU) en unidades de compra (puede no ser entera en requisiciones viejas). */
export function cantidadEnCompra(cantidadUso: number, factor: number): number {
  return Math.round((cantidadUso / (factor > 0 ? factor : 1)) * 1_000_000) / 1_000_000
}

/** ¿La línea del APU está en otra unidad que la del insumo y sin conversión? */
export function conversionPendiente(unidadLinea: string | null | undefined, umInsumo: string | null | undefined, factor: number): boolean {
  // Igual que _conversion_pendiente en la base: unidad conocida (no "Ins") y distinta.
  if (factor !== 1 || !normalizarUnidad(umInsumo)) return false
  return lineaNecesitaConversion(unidadLinea, umInsumo)
}
