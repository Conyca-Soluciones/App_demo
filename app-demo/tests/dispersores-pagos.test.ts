// Realizar Pagos: los seis estados de la consola (cruce.py) y el armado de las
// tandas (servidor.py, _tanda) sobre los pagos de la app.

import { describe, expect, it } from "vitest"
import {
  agruparAsignados,
  cambiosManuales,
  conEstado,
  renglonDe,
  tandaDe,
  truncadoDe,
  type CuentaEmpresa,
  type PagoDispersor,
} from "@/lib/dispersores/pagos-dispersor"

const pago = (p: Partial<PagoDispersor> = {}): PagoDispersor => ({
  id: "p1",
  item: "001-00001",
  semana: 43,
  anio: 2026,
  consolidado: "Consolidado",
  grupo: "Conyca S.A.S.",
  proyecto: "100-PP-UNO",
  valorOriginal: 1000.5,
  valor: 1000,
  estadoPago: "aprobado",
  esPse: false,
  fueraManual: false,
  esNomina: false,
  beneficiario: {
    razonSocial: "José Pérez",
    tipoDocumento: "CC",
    numeroDocumento: "1.234",
    dv: "",
    nombreBanco: "",
    nombres: "José",
    apellidos: "Pérez",
  },
  factura: "José Pérez",
  cuenta: { banco: "BANCOLOMBIA", tipoCuenta: "AHORROS", numero: "001-2", estado: "ACTIVO", etiqueta: "" },
  cuentaModificada: false,
  confirmada: false,
  cuentaDebitarId: null,
  dispersion: null,
  rebote: null,
  ...p,
})

const cuenta: CuentaEmpresa = {
  id: "c1",
  empresa: "Conyca",
  apodo: "CONYCA BOG",
  diminutivo: "CBOG",
  banco: "BANCO DE BOGOTA",
  tipoCuenta: "CORRIENTE",
  cuenta: "123",
  nit: "900",
  dv: "1",
  razonSocial: "CONYCA",
  correoItau: "",
}

describe("estado de cada pago", () => {
  it("listo, asignado y dispersado", () => {
    expect(conEstado(pago()).estado).toBe("listo")
    expect(conEstado(pago({ cuentaDebitarId: "c1" })).estado).toBe("asignado")
    expect(conEstado(pago({ estadoPago: "dispersado" })).estado).toBe("dispersado")
  })
  it("PSE y fuera a mano no van por dispersor", () => {
    expect(conEstado(pago({ esPse: true, beneficiario: null, cuenta: null })).estado).toBe("fuera")
    expect(conEstado(pago({ fueraManual: true })).estado).toBe("fuera")
  })
  it("PSE pagado sin dispersor queda dispersado y lo dice", () => {
    const r = conEstado(
      pago({ esPse: true, cuenta: null, estadoPago: "dispersado", pagadoManual: { fecha: "2026-11-12T15:00:00Z", comprobante: null } })
    )
    expect(r.estado).toBe("dispersado")
    expect(r.alertas[0]).toMatchObject({ mensaje: "pagado sin dispersor", detalle: "por PSE" })
    expect(conEstado(pago({ fueraManual: true, estadoPago: "dispersado", pagadoManual: { fecha: null, comprobante: null } })).alertas[0].detalle).toBe(
      "por otro medio"
    )
  })
  it("bloqueados: sin tercero, sin cuenta, cuenta inactiva", () => {
    expect(conEstado(pago({ beneficiario: null })).estado).toBe("bloqueado")
    expect(conEstado(pago({ cuenta: null })).estado).toBe("bloqueado")
    expect(conEstado(pago({ cuenta: { ...pago().cuenta!, estado: "INACTIVO" } })).estado).toBe("bloqueado")
  })
  it("confirmar: cuenta pendiente o que cambió", () => {
    const pendiente = { ...pago().cuenta!, estado: "PENDIENTE" }
    expect(conEstado(pago({ cuenta: pendiente })).estado).toBe("confirmar")
    expect(conEstado(pago({ cuenta: pendiente, confirmada: true })).estado).toBe("listo")
    expect(conEstado(pago({ cuentaModificada: true })).estado).toBe("confirmar")
    // confirmada antes y la cuenta volvió a cambiar
    expect(conEstado(pago({ cuentaModificada: true, confirmada: true })).estado).toBe("confirmar")
  })
})

describe("tandas", () => {
  it("el renglón sale del beneficiario y la cuenta del pago", () => {
    const r = renglonDe(pago())
    expect(r).toMatchObject({ documento: "1234", nombre: "JOSE PEREZ", cuenta: "0012", valor: 1000, referencia: "REF 001 00001", empresa: "CONYCA S.A.S." })
  })
  it("agrupa por cuenta, semana y nómina; ordena por REF", () => {
    const cuentas = new Map([["c1", cuenta]])
    const ps = [
      pago({ id: "a", item: "001-00010", cuentaDebitarId: "c1" }),
      pago({ id: "b", item: "001-00002", cuentaDebitarId: "c1" }),
      pago({ id: "c", item: "001-00003", cuentaDebitarId: "c1", esNomina: true }),
      pago({ id: "d", item: "001-00004" }),
    ].map(conEstado)
    const g = agruparAsignados(ps, cuentas)
    expect(g).toHaveLength(2)
    const normal = g.find((x) => !x.esNomina)!
    expect(normal.pagos.map((p) => p.item)).toEqual(["001-00002", "001-00010"])
    const t = tandaDe(normal, "20261023", "A1")
    expect(t.clasePago).toBe("PROVEEDORES")
    expect(t.truncado).toBe("1.00")
  })
  it("centavos perdidos y cuentas confirmadas a mano", () => {
    expect(truncadoDe([{ valorOriginal: 100, valor: 100 }])).toBe("")
    const g = agruparAsignados([conEstado(pago({ cuentaDebitarId: "c1", confirmada: true }))], new Map([["c1", cuenta]]))[0]
    expect(cambiosManuales(g)).toEqual(["REF 001-00001 · JOSÉ PÉREZ · BANCOLOMBIA · ahorros · 001-2"])
  })
})
