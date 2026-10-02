import { describe, expect, it } from "vitest"
import { calcularLinea, calcularTotalesOrden } from "@/lib/ordenes-compra-calculos"

describe("calcularLinea", () => {
  it("descuento antes del IVA", () => {
    expect(calcularLinea({ cantidad: 10, precioUnitario: 1000, porcentajeDescuento: 10, porcentajeIva: 19 })).toEqual({
      bruto: 10_000,
      descuento: 1_000,
      subtotal: 9_000,
      iva: 1_710,
      total: 10_710,
    })
  })

  it("sin descuento ni IVA", () => {
    expect(calcularLinea({ cantidad: 3, precioUnitario: 500, porcentajeDescuento: 0, porcentajeIva: 0 }).total).toBe(1500)
  })
})

describe("calcularTotalesOrden", () => {
  it("suma las líneas", () => {
    const t = calcularTotalesOrden([
      { cantidad: 10, precioUnitario: 1000, porcentajeDescuento: 10, porcentajeIva: 19 },
      { cantidad: 2, precioUnitario: 500, porcentajeDescuento: 0, porcentajeIva: 0 },
    ])
    expect(t).toEqual({ descuento: 1000, iva: 1710, total: 11_710 })
  })

  it("orden vacía en cero", () => {
    expect(calcularTotalesOrden([])).toEqual({ descuento: 0, iva: 0, total: 0 })
  })
})
