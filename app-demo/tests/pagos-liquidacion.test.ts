import { describe, expect, it } from "vitest"
import { anticiposYDescuentos, totalAPagar, type LiquidacionPago } from "@/lib/pagos"

const liquidacion = (neto: number, descuentos = 0): LiquidacionPago => ({
  version: 1,
  retefuente: 27250,
  reteica: 8164,
  reteiva: 0,
  asumidas: 0,
  descuentos,
  neto,
  liquidadoPorNombre: "Contabilidad",
  liquidadoEn: "2026-10-21T15:00:00Z",
})

describe("totalAPagar", () => {
  it("sin liquidar gira el valor aprobado", () => {
    expect(totalAPagar({ valor: 1280000, liquidacion: null })).toBe(1280000)
  })
  it("liquidado gira el neto", () => {
    expect(totalAPagar({ valor: 1280000, liquidacion: liquidacion(1244586) })).toBe(1244586)
  })
})

describe("anticiposYDescuentos", () => {
  it("saldo de una OC: el anticipo ya girado", () => {
    expect(anticiposYDescuentos({ descuentoAnticipos: 384000, otrosDescuentos: 0, liquidacion: null })).toBe(384000)
  })
  it("acta liquidada: amortización + otros del acta + descuentos de Contabilidad", () => {
    expect(
      anticiposYDescuentos({ descuentoAnticipos: 2000000, otrosDescuentos: 100000, liquidacion: liquidacion(7000000, 50000) })
    ).toBe(2150000)
  })
})
