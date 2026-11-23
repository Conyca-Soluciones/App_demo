import { describe, expect, it } from "vitest"
import { cantidadEnCompra, cantidadEnUso, conversionPendiente, disponibleEnCompra } from "@/lib/requisicion-unidades"

describe("requisiciones en la unidad de compra", () => {
  it("lo disponible va en unidades de compra completas, sin pasar del presupuesto", () => {
    expect(disponibleEnCompra(250, 100)).toBe(2)
    expect(disponibleEnCompra(300, 100)).toBe(3)
    expect(disponibleEnCompra(42.3, 14.1)).toBe(3)
    expect(disponibleEnCompra(42.29, 14.1)).toBe(2)
    expect(disponibleEnCompra(17, 1)).toBe(17)
    expect(disponibleEnCompra(0, 3)).toBe(0)
    expect(disponibleEnCompra(-5, 3)).toBe(0)
  })

  it("lo pedido en unidades de compra nunca pasa de lo disponible en la unidad del APU", () => {
    for (const [disp, factor] of [[250, 100], [42.3, 14.1], [10, 1.5], [7, 3], [1000, 0.25]] as const) {
      const max = disponibleEnCompra(disp, factor)
      expect(cantidadEnUso(max, factor)).toBeLessThanOrEqual(disp + 1e-9)
      expect(cantidadEnUso(max + 1, factor)).toBeGreaterThan(disp)
    }
  })

  it("convierte de ida y vuelta", () => {
    expect(cantidadEnUso(3, 14.1)).toBe(42.3)
    expect(cantidadEnCompra(42.3, 14.1)).toBe(3)
    expect(cantidadEnCompra(250, 100)).toBe(2.5)
    expect(cantidadEnUso(5, 1)).toBe(5)
  })

  it("detecta la conversión pendiente", () => {
    expect(conversionPendiente("M", "UNIDAD - UND", 1)).toBe(true)
    expect(conversionPendiente("M", "UNIDAD - UND", 3)).toBe(false)
    expect(conversionPendiente("UND", "UNIDAD - UND", 1)).toBe(false)
    expect(conversionPendiente("BULTO", "BULTO - BE", 1)).toBe(false)
    expect(conversionPendiente(null, "UNIDAD - UND", 1)).toBe(false)
    expect(conversionPendiente("Ins", "UNIDAD - UND", 1)).toBe(false)
    expect(conversionPendiente("M", "ROLLO - ROLL", 1)).toBe(true)
  })
})
