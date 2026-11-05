// Tipo de pago de una orden de compra (20261228000000, decisión del usuario):
// De contado, Crédito o Fiducia, obligatorio al generar la orden. Con Crédito
// se escribe la fecha (futura) en que se debe pagar. Es INFORMATIVO: el pago
// llega a Aprobación de pagos como siempre (aprobarlo aprueba la orden) y A&F
// ve el tipo y la fecha para pagarlo a tiempo. Es aparte del método de pago
// (Transferencia o PSE). La base vuelve a validar (_fijar_tipo_pago_orden).
// Archivo plano: lo usan la pantalla y las actions.

export type TipoPagoOC = "contado" | "credito" | "fiducia"

export const TIPOS_PAGO_OC: { valor: TipoPagoOC; titulo: string }[] = [
  { valor: "contado", titulo: "De contado" },
  { valor: "credito", titulo: "Crédito" },
  { valor: "fiducia", titulo: "Fiducia" },
]

export const ETIQUETA_TIPO_PAGO_OC: Record<TipoPagoOC, string> = {
  contado: "De contado",
  credito: "Crédito",
  fiducia: "Fiducia",
}

export const esTipoPagoOC = (x: unknown): x is TipoPagoOC => x === "contado" || x === "credito" || x === "fiducia"

/** Primer error (null = completo). hoy = "AAAA-MM-DD" en Colombia. */
export function validarTipoPagoOC(tipo: TipoPagoOC | null, fechaCredito: string, hoy: string): string | null {
  if (!tipo) return "Elige el tipo de pago: de contado, crédito o fiducia."
  if (tipo === "credito") {
    if (!fechaCredito) return "Escribe la fecha en que se debe pagar el crédito."
    if (fechaCredito <= hoy) return "La fecha de pago del crédito tiene que ser posterior a hoy."
  }
  return null
}

/** Los campos de crearOrdenCompra (aparte del método de pago). */
export const tipoPagoParaGuardar = (tipo: TipoPagoOC, fechaCredito: string) => ({
  tipoPago: tipo,
  fechaPagoCredito: tipo === "credito" ? fechaCredito : null,
})

/** "Crédito · pagar el 05/12/2026", "De contado"; null si la OC no tiene tipo (las de antes). */
export function textoTipoPagoOC(tipo: string | null | undefined, fechaCredito: string | null | undefined): string | null {
  if (!esTipoPagoOC(tipo)) return null
  if (tipo !== "credito" || !fechaCredito) return ETIQUETA_TIPO_PAGO_OC[tipo]
  const [a, m, d] = fechaCredito.slice(0, 10).split("-")
  return `Crédito · pagar el ${d}/${m}/${a}`
}
