// Tipo de pago de la orden de compra: obligatorio; con crédito, fecha futura.

import { describe, expect, it } from "vitest"
import { fechaCortaOC, lunesDeLaSemana, textoTipoPagoOC, tipoPagoParaGuardar, validarTipoPagoOC } from "@/lib/tipo-pago-oc"

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
  it("el crédito pasa a pago el lunes de la semana de su fecha", () => {
    expect(lunesDeLaSemana("2026-12-10")).toBe("2026-12-07") // jueves
    expect(lunesDeLaSemana("2026-12-07")).toBe("2026-12-07") // lunes
    expect(lunesDeLaSemana("2026-12-13")).toBe("2026-12-07") // domingo
    expect(lunesDeLaSemana("2027-01-01")).toBe("2026-12-28") // cambio de año
  })
  it("textos", () => {
    expect(fechaCortaOC("2026-12-05")).toBe("05/12/2026")
    expect(textoTipoPagoOC("credito", "2026-12-05")).toBe("Crédito · pagar el 05/12/2026")
    expect(textoTipoPagoOC("fiducia", null)).toBe("Fiducia")
    expect(textoTipoPagoOC(null, null)).toBeNull()
  })
})
