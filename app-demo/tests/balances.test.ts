import { describe, expect, it } from "vitest"
import { etiquetaCuenta, mapExtracto, mapSaldoCuenta, validarMovimiento, type FormMovimiento } from "@/lib/balances"

const base: FormMovimiento = {
  tipo: "egreso",
  cuentaId: "c1",
  cuentaDestinoId: "",
  fecha: "2026-11-12",
  valor: 150000,
  concepto: "Comisión bancaria",
  titular: "BANCOLOMBIA",
}
const HOY = "2026-11-12"

describe("validarMovimiento", () => {
  it("un egreso completo no tiene errores", () => {
    expect(validarMovimiento(base, HOY)).toEqual({})
  })
  it("pide cuenta, titular, concepto y valor > 0", () => {
    const e = validarMovimiento({ ...base, cuentaId: "", titular: " ", concepto: "", valor: 0 }, HOY)
    expect(Object.keys(e).sort()).toEqual(["concepto", "cuentaId", "titular", "valor"])
  })
  it("no deja fecha futura", () => {
    expect(validarMovimiento({ ...base, fecha: "2026-11-13" }, HOY).fecha).toBe("La fecha no puede ser futura.")
  })
  it("traslado: sin titular, con destino distinto del origen", () => {
    const t: FormMovimiento = { ...base, tipo: "traslado", titular: "", cuentaDestinoId: "c2" }
    expect(validarMovimiento(t, HOY)).toEqual({})
    expect(validarMovimiento({ ...t, cuentaDestinoId: "" }, HOY).cuentaDestinoId).toBe("Escoge la cuenta de destino.")
    expect(validarMovimiento({ ...t, cuentaDestinoId: "c1" }, HOY).cuentaDestinoId).toBe("Debe ser otra cuenta.")
  })
})

describe("mapeos", () => {
  it("cuenta sin saldo de inicio: saldo actual null", () => {
    const c = mapSaldoCuenta({ id: "x", apodo: "CONYCA AH", banco: "BANCOLOMBIA", tipo_cuenta: "AHORROS", numero_cuenta: "12345678", saldo_inicial: null, saldo_actual: null, ingresos: "0" })
    expect(c.saldoInicial).toBeNull()
    expect(c.saldoActual).toBeNull()
    expect(c.ingresos).toBe(0)
    expect(etiquetaCuenta(c)).toBe("CONYCA AH · BANCOLOMBIA ahorros ****5678")
  })
  it("extracto con números en texto", () => {
    const x = mapExtracto({ saldo_inicial: "1000", saldo_anterior: "1000", saldo_final: "700", filas: [{ fecha: "2026-11-12", clase: "pago_dispersor", codigo: "001-00001", valor: "-300", saldo: "700", registro_id: "p1" }] })
    expect(x.saldoFinal).toBe(700)
    expect(x.filas[0]).toMatchObject({ clase: "pago_dispersor", valor: -300, saldo: 700 })
  })
})
