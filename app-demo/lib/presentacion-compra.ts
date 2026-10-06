// ---------------------------------------------------------------------------
// Presentación de compra elegida en una línea de la orden ("UM disponible").
//
// Ejemplo: el presupuesto pide 13,08 m² de enchape; la tienda lo vende por
// cajas. Compras elige CAJA y escribe la conversión (1 caja = 2,08 m²): el
// sistema calcula 7 cajas (siempre hacia arriba).
//
// En la base la línea sigue guardando cantidad y precio en la unidad de compra
// DEL INSUMO (la u_m del maestro: de ahí cuelgan Entradas, Inventario, la
// ejecución y el precio promedio de los APU). La presentación (cajas, precio
// por caja) se guarda aparte; ver 20261029000000_oc_presentacion_compra.sql.
//
// Archivo plano (sin "use server"/"use client"): lo comparten las pantallas, las
// Server Actions y el PDF.
// ---------------------------------------------------------------------------

import { normalizarUnidad, unidadesDeCompra } from "@/lib/unidades"

// Presentaciones en las que normalmente se vende un insumo. Se amplía
// agregando una línea acá (la base guarda el texto tal cual).
export const PRESENTACIONES_COMPRA = [
  "CAJA",
  "ROLLO",
  "BULTO",
  "PAQUETE",
  "SACO",
  "BOLSA",
  "BARRA",
  "LÁMINA",
  "TUBO",
  "PLIEGO",
  "TARRO",
  "CUÑETE",
  "GALÓN",
  "KIT",
  "JUEGO",
  "PAR",
  "UNIDAD",
  "METRO",
  "KILOGRAMO",
  "LIBRA",
  "LITRO",
] as const

// Las presentaciones que se ofrecen para un insumo: todas menos la que ya es
// su unidad de compra (esa es la opción "normal" de la lista).
export function presentacionesPara(umInsumo: string | null | undefined): string[] {
  const propia = normalizarUnidad(umInsumo)
  return PRESENTACIONES_COMPRA.filter((p) => normalizarUnidad(p) !== propia)
}

// La conversión admite hasta 4 decimales (la base lo exige).
export const DECIMALES_CONVERSION = 4
// Unidades del insumo por unidad de compra: 6 decimales, así lo recibido en
// Entradas (unidades de compra enteras) suma exactamente lo ordenado.
export const DECIMALES_POR_UM = 6

// Redondea a `d` decimales sin el ruido de la coma flotante.
export const redondear = (n: number, d: number) => {
  const f = 10 ** d
  return Math.round((n + Number.EPSILON) * f) / f
}

export function conversionValida(conversion: number): boolean {
  return (
    Number.isFinite(conversion) && conversion > 0 && redondear(conversion, DECIMALES_CONVERSION) === conversion
  )
}

// Unidades del INSUMO que trae cada unidad de compra, con la conversión
// (en unidades de la requisición) y la relación insumo/requisición del pedido.
export const cantidadPorPresentacion = (conversion: number, factorUnidad: number) =>
  redondear(conversion / factorUnidad, DECIMALES_POR_UM)

// Máximo de unidades de compra que se pueden pedir para lo que falta (en
// unidades de la requisición): hasta cubrirlo, nunca una de más. Misma regla
// que crear_orden_compra.
export function maximoPresentaciones(pendienteUso: number, conversion: number, factorUnidad: number): number {
  const porUm = cantidadPorPresentacion(conversion, factorUnidad)
  if (!(porUm > 0) || !(factorUnidad > 0)) return 0
  return Math.max(unidadesDeCompra(pendienteUso, porUm * factorUnidad), 0)
}

// Datos de la presentación de una línea de la orden.
export type PresentacionLinea = {
  umCompra: string
  conversionCompra: number
  cantidadCompra: number
  precioCompra: number
  // Unidad en la que está expresada la conversión (la de la requisición: m²).
  // Solo para mostrar; la base no la guarda.
  unidadConversion?: string | null
}
