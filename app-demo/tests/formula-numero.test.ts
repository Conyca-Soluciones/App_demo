import { describe, expect, it } from "vitest"
import { esFormula, evaluarFormula, leerNumeroOFormula } from "@/lib/formula-numero"

describe("fórmulas en los campos de pesos", () => {
  it("reconoce fórmulas y deja los números como están", () => {
    expect(esFormula("=100")).toBe(true)
    expect(esFormula("1000*4%")).toBe(true)
    expect(esFormula("1.000.000")).toBe(false)
    expect(leerNumeroOFormula("1.000.000")).toBe(1000000)
    expect(leerNumeroOFormula("1500,5")).toBe(1500.5)
  })

  it("calcula como Excel", () => {
    expect(evaluarFormula("=1.000.000*4%")).toBe(40000)
    expect(evaluarFormula("1000000*0,04+500")).toBe(40500)
    expect(evaluarFormula("=+1000-200*2")).toBe(600)
    expect(evaluarFormula("=(1000-200)*2")).toBe(1600)
    expect(evaluarFormula("= 1.190.000 / 1,19")).toBe(1000000)
    expect(evaluarFormula("=-(5)+10")).toBe(5)
    expect(evaluarFormula("=10/3")).toBe(3.33)
  })

  it("no entiende lo que no es aritmética", () => {
    expect(evaluarFormula("=1+")).toBeNull()
    expect(evaluarFormula("=(1+2")).toBeNull()
    expect(evaluarFormula("=A1+2")).toBeNull()
    expect(evaluarFormula("=1/0")).toBeNull()
    expect(evaluarFormula("=alert(1)")).toBeNull()
    expect(evaluarFormula("=")).toBeNull()
  })
})
