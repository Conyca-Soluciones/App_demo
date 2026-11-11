import { describe, expect, it } from "vitest"
import { estadoSaldo, saldoSugerido, validarUsoSaldo } from "@/lib/saldo-favor"

describe("saldo a favor", () => {
  it("desglose: costo, aplicado, a pagar y restante", () => {
    expect(validarUsoSaldo("2.000.000", 6_000_000, 2_000_000)).toEqual({
      ok: true,
      desglose: { costo: 6_000_000, aplicado: 2_000_000, aPagar: 4_000_000, restante: 0 },
    })
    expect(validarUsoSaldo("1500000", 6_000_000.4, 2_000_000)).toEqual({
      ok: true,
      desglose: { costo: 6_000_000, aplicado: 1_500_000, aPagar: 4_500_000, restante: 500_000 },
    })
  })

  it("puede cubrir toda la orden (el pago queda en $ 0)", () => {
    const r = validarUsoSaldo("6.000.000", 6_000_000, 9_000_000)
    expect(r.ok && r.desglose).toEqual({ costo: 6_000_000, aplicado: 6_000_000, aPagar: 0, restante: 3_000_000 })
  })

  it("rechaza vacío, cero, más de lo disponible o más que la orden", () => {
    const err = (t: string, total = 6_000_000, disp = 2_000_000) => {
      const r = validarUsoSaldo(t, total, disp)
      return r.ok ? null : r.error
    }
    expect(err("")).toMatch(/Escribe/)
    expect(err("0")).toMatch(/Escribe/)
    expect(err("2.500.000")).toMatch(/disponible/)
    expect(err("7.000.000", 6_000_000, 9_000_000)).toMatch(/valor de la orden/)
  })

  it("sugiere lo disponible sin pasar del total", () => {
    expect(saldoSugerido(6_000_000, 2_000_000)).toBe(2_000_000)
    expect(saldoSugerido(1_000_000, 2_000_000)).toBe(1_000_000)
  })

  it("estado del saldo", () => {
    expect(estadoSaldo({ cerradoAt: "2026-11-11", disponible: 100, valor: 100 })).toBe("cerrado")
    expect(estadoSaldo({ cerradoAt: null, disponible: 0, valor: 100 })).toBe("usado")
    expect(estadoSaldo({ cerradoAt: null, disponible: 40, valor: 100 })).toBe("parcial")
    expect(estadoSaldo({ cerradoAt: null, disponible: 100, valor: 100 })).toBe("disponible")
  })
})
