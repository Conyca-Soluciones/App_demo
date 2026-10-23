import { describe, expect, it } from "vitest"
import { mapTitularCuenta, titularParaGuardar, titularVacio } from "@/lib/titular-cuenta"

describe("titular de la cuenta", () => {
  it("sin casilla = la cuenta de quien factura", () => {
    expect(titularParaGuardar(null)).toEqual({ ok: true, titular: null })
  })

  it("con casilla exige titular y cuenta", () => {
    expect(titularParaGuardar(titularVacio())).toMatchObject({ ok: false, error: expect.stringMatching(/titular/) })
    expect(titularParaGuardar({ ...titularVacio(), terceroId: "t2" })).toMatchObject({ ok: false, error: expect.stringMatching(/cuenta/) })
    expect(titularParaGuardar({ ...titularVacio(), terceroId: "t2", cuentaId: "c2" })).toEqual({
      ok: true,
      titular: { tercero_id: "t2", cuenta_id: "c2" },
    })
  })

  it("lee lo guardado en el acta", () => {
    expect(mapTitularCuenta(null)).toBeNull()
    expect(
      mapTitularCuenta({
        tercero_id: "t2",
        razon_social: "LUIS CARLOS PEREZ",
        tipo_documento: "CC",
        numero_documento: "1234",
        dv: null,
        cuenta_id: "c2",
        banco: "BANCOLOMBIA",
        tipo_cuenta: "AHORROS",
        numero_cuenta: "••8901",
        verificada: true,
      })
    ).toEqual({
      terceroId: "t2",
      nombre: "LUIS CARLOS PEREZ",
      documento: "CC 1234",
      cuentaId: "c2",
      cuentaTexto: "BANCOLOMBIA · Ahorros · ••8901",
      cuentaVerificada: true,
    })
  })
})
