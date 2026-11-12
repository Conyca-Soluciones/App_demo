import { describe, expect, it } from "vitest"
import { pideAutorizacionTercero } from "@/lib/actas"

describe("pideAutorizacionTercero (depositar a otro tercero en el acta)", () => {
  it("sin otro tercero, no", () => {
    expect(pideAutorizacionTercero(null, null)).toBe(false)
    expect(pideAutorizacionTercero(null, "t1")).toBe(false)
  })
  it("el tercero que estipula el contrato, no", () => {
    expect(pideAutorizacionTercero("t1", "t1")).toBe(false)
  })
  it("cualquier otro tercero, sí", () => {
    expect(pideAutorizacionTercero("t2", "t1")).toBe(true)
    expect(pideAutorizacionTercero("t2", null)).toBe(true)
  })
})
