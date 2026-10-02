import { describe, expect, it } from "vitest"
import { esCantidadEnteraPositiva, leerCantidadEntera } from "@/lib/numeros"

describe("leerCantidadEntera", () => {
  it.each([
    ["1500", 1500],
    ["1.500", 1500],
    ["1.500.000", 1_500_000],
    ["1,500", 1500],
    [" 12 ", 12],
    ["0", 0],
  ])("%j -> %d", (texto, valor) => {
    expect(leerCantidadEntera(texto)).toEqual({ ok: true, valor })
  })

  it.each(["1,5", "2.25", "1.5", "1.50"])("%j tiene decimales: error", (texto) => {
    const r = leerCantidadEntera(texto)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/entero/)
  })

  it("vacío y negativo", () => {
    expect(leerCantidadEntera("")).toMatchObject({ ok: false, error: "Escribe una cantidad." })
    expect(leerCantidadEntera("-3")).toMatchObject({ ok: false, error: expect.stringMatching(/negativa/) })
  })
})

describe("esCantidadEnteraPositiva", () => {
  it.each([[1, true], [0, false], [-1, false], [1.5, false], ["3", false], [Number.MAX_SAFE_INTEGER + 2, false]])(
    "%j -> %j",
    (n, esperado) => {
      expect(esCantidadEnteraPositiva(n)).toBe(esperado)
    }
  )
})
