// Tipo de pago de la orden de compra: obligatorio; con crédito, fecha futura.

import { describe, expect, it } from "vitest"
import { tipoPagoParaGuardar, validarTipoPagoOC } from "@/lib/tipo-pago-oc"

describe("tipo de pago de la OC", () => {
  it("es obligatorio", () => {
    expect(validarTipoPagoOC(null, "", "2026-11-05")).toMatch(/tipo de pago/)
    expect(validarTipoPagoOC("contado", "", "2026-11-05")).toBeNull()
    expect(validarTipoPagoOC("fiducia", "", "2026-11-05")).toBeNull()
  })
  it("crédito pide una fecha posterior a hoy", () => {
    expect(validarTipoPagoOC("credito", "", "2026-11-05")).toMatch(/fecha/)
    expect(validarTipoPagoOC("credito", "2026-11-05", "2026-11-05")).toMatch(/posterior/)
    expect(validarTipoPagoOC("credito", "2026-12-05", "2026-11-05")).toBeNull()
  })
  it("solo el crédito guarda fecha", () => {
    expect(tipoPagoParaGuardar("credito", "2026-12-05")).toEqual({ tipoPago: "credito", fechaPagoCredito: "2026-12-05" })
    expect(tipoPagoParaGuardar("contado", "2026-12-05")).toEqual({ tipoPago: "contado", fechaPagoCredito: null })
  })
})
