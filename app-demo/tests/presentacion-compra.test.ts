import { describe, expect, it } from "vitest"
import {
  cantidadPorPresentacion,
  conversionValida,
  maximoPresentaciones,
  presentacionesPara,
  redondear,
} from "@/lib/presentacion-compra"

describe("maximoPresentaciones (cuántas cajas hay que comprar)", () => {
  it("13,08 m² con cajas de 2,08 m² -> 7 cajas (se redondea hacia arriba)", () => {
    expect(maximoPresentaciones(13.08, 2.08, 1)).toBe(7)
  })

  it("una cantidad exacta no pide una caja de más (12,48 / 2,08 = 6)", () => {
    expect(maximoPresentaciones(12.48, 2.08, 1)).toBe(6)
  })

  it("menos que una caja -> 1 caja", () => {
    expect(maximoPresentaciones(0.5, 2.08, 1)).toBe(1)
  })

  it("con relación insumo/requisición distinta de 1 (bulto de 50 kg, caja de 25 kg)", () => {
    // pedido: 120 kg; el insumo se compra en bultos de 50 kg (factor 50);
    // una caja trae 25 kg -> 120 / 25 = 4,8 -> 5 cajas
    expect(maximoPresentaciones(120, 25, 50)).toBe(5)
  })

  it("conversión inválida o nada pendiente -> 0", () => {
    expect(maximoPresentaciones(13.08, 0, 1)).toBe(0)
    expect(maximoPresentaciones(13.08, 2.08, 0)).toBe(0)
  })
})

describe("cantidadPorPresentacion (unidades del insumo por caja, 6 decimales)", () => {
  it("con factor 1 es la conversión tal cual", () => {
    expect(cantidadPorPresentacion(2.08, 1)).toBe(2.08)
  })

  it("con factor 50, 25 kg por caja son 0,5 bultos por caja", () => {
    expect(cantidadPorPresentacion(25, 50)).toBe(0.5)
  })

  it("cajas enteras suman exactamente lo ordenado (sin ruido de coma flotante)", () => {
    const porCaja = cantidadPorPresentacion(2.08, 1)
    const ordenado = redondear(7 * porCaja, 6)
    const recibido = redondear(3 * porCaja, 6) + redondear(4 * porCaja, 6)
    expect(redondear(recibido, 6)).toBe(ordenado)
  })
})

describe("conversionValida", () => {
  it("acepta hasta 4 decimales y rechaza cero, negativos y más decimales", () => {
    expect(conversionValida(2.08)).toBe(true)
    expect(conversionValida(0.0625)).toBe(true)
    expect(conversionValida(0)).toBe(false)
    expect(conversionValida(-1)).toBe(false)
    expect(conversionValida(1.23456)).toBe(false)
    expect(conversionValida(Number.NaN)).toBe(false)
  })
})

describe("presentacionesPara", () => {
  it("ofrece las presentaciones habituales", () => {
    const opciones = presentacionesPara("METRO CUADRADO - M2")
    expect(opciones).toContain("CAJA")
    expect(opciones).toContain("ROLLO")
  })

  it("no ofrece la unidad de compra que ya tiene el insumo", () => {
    expect(presentacionesPara("ROLLO - ROLL")).not.toContain("ROLLO")
    expect(presentacionesPara("UNIDAD - UND")).not.toContain("UNIDAD")
  })
})
