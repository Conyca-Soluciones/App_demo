import { describe, expect, it } from "vitest"
import {
  pagoOCParaGuardar,
  pagoOCVacio,
  textoTitularPse,
  validarPagoOC,
  type CuentasProveedorOC,
  type PagoOCForm,
} from "@/lib/metodo-pago-oc"

const cuenta = (id: string, verificada = true) => ({ id, banco: "BANCOLOMBIA", tipoCuenta: "AHORROS", numero: "•••1234", verificada })
const info = (cuentas = [cuenta("c1")], terceroId: string | null = "t1"): CuentasProveedorOC => ({
  terceroId,
  razonSocial: "PROVEEDOR SAS",
  cuentas,
})
const pago = (cambios: Partial<PagoOCForm> = {}): PagoOCForm => ({ ...pagoOCVacio(), ...cambios })

describe("Transferencia en la OC", () => {
  it("con una cuenta en Terceros se elige sola", () => {
    expect(validarPagoOC(pago(), info(), false)).toBeNull()
    expect(pagoOCParaGuardar(pago(), info(), false)).toEqual({ metodo: "transferencia", observaciones: "", cuenta_id: "c1" })
  })
  it("con varias hay que escoger", () => {
    const dos = info([cuenta("c1"), cuenta("c2", false)])
    expect(validarPagoOC(pago(), dos, false)).toMatch(/Elige/)
    expect(validarPagoOC(pago({ cuentaId: "c2" }), dos, false)).toBeNull()
    expect(pagoOCParaGuardar(pago({ cuentaId: "c2" }), dos, false).cuenta_id).toBe("c2")
  })
  it("sin cuenta o sin tercero se genera igual, sin cuenta (A&F la registra)", () => {
    expect(validarPagoOC(pago(), info([]), false)).toBeNull()
    expect(validarPagoOC(pago(), info([], null), false)).toBeNull()
    expect(pagoOCParaGuardar(pago(), info([]), false).cuenta_id).toBeNull()
  })
  it("con titular aparte no mira las cuentas del proveedor", () => {
    expect(validarPagoOC(pago(), info([]), true)).toBeNull()
    expect(pagoOCParaGuardar(pago(), info(), true).cuenta_id).toBeNull()
  })
})

describe("PSE en la OC", () => {
  it("sin titular distinto solo lleva observaciones", () => {
    const p = pago({ metodo: "pse", observaciones: "  pagar antes del viernes " })
    expect(validarPagoOC(p, info([]), false)).toBeNull()
    expect(pagoOCParaGuardar(p, null, false)).toEqual({ metodo: "pse", observaciones: "pagar antes del viernes", titular_distinto: false })
  })
  it("con titular distinto pide nombre, tipo y documento", () => {
    expect(validarPagoOC(pago({ metodo: "pse", titularDistinto: true }), null, false)).toMatch(/titular/)
    const p = pago({ metodo: "pse", titularDistinto: true, titularNombre: "Ana", titularTipoDocumento: "CC", titularDocumento: "1.234.567" })
    expect(validarPagoOC(p, null, false)).toBeNull()
    expect(pagoOCParaGuardar(p, null, false)).toMatchObject({ titular_nombre: "Ana", titular_tipo_documento: "CC", titular_documento: "1234567" })
  })
  it("no se combina con la cuenta de otro tercero", () => {
    expect(validarPagoOC(pago({ metodo: "pse" }), null, true)).toMatch(/quita la casilla/)
  })
  it("el titular que se muestra es el escrito o el proveedor", () => {
    expect(textoTitularPse({ nombre: "Ana", tipoDocumento: "CC", documento: "123" }, "PROV")).toBe("Ana (CC 123)")
    expect(textoTitularPse(null, "PROV")).toBe("PROV (el proveedor)")
  })
})
