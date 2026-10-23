import { describe, expect, it } from "vitest"
import {
  actaEditable,
  calcularActa,
  consumidoActas,
  formActaVacio,
  formDesdeActa,
  saldoContrato,
  tiposPermitidos,
  validarActa,
  type ActaDetalle,
  type FormActa,
  type InfoContratoActa,
} from "@/lib/actas"

const info = (cambios: Partial<InfoContratoActa> = {}): InfoContratoActa => ({
  valor: 10_000_000,
  valorInicial: 10_000_000,
  anexoTipo: "valores_unitarios",
  anticipoPorcentaje: null,
  retencionPorcentaje: null,
  fechaFin: "2027-01-31",
  vencido: false,
  liquidado: false,
  listoParaActas: true,
  polizaEstado: "aprobada",
  metodoPago: "transferencia",
  tieneFinal: false,
  tieneLiquidacion: false,
  actasPorAprobar: 0,
  brutoOtras: 0,
  avanceOtras: 0,
  amortizadoOtras: 0,
  amortizadoAprobado: 0,
  retenidoAprobado: 0,
  actividades: [
    { id: "a1", orden: 1, actividad: "Excavación", unidad: "m3", cantidad: 100, valorUnitario: 50_000, acumulado: 40 },
    { id: "a2", orden: 2, actividad: "Concreto", unidad: "m3", cantidad: 20, valorUnitario: 250_000, acumulado: 0 },
  ],
  ...cambios,
})
const form = (cambios: Partial<FormActa> = {}): FormActa => ({ ...formActaVacio(), ...cambios })

describe("calcularActa: valores unitarios", () => {
  it("valor = cantidad × valor unitario pactado; solo las actividades con cantidad", () => {
    const r = calcularActa(info(), form({ cantidades: { a1: "10", a2: "2,5" } }))
    expect(r.lineas).toEqual([
      { id: "a1", cantidad: 10, valor: 500_000, excede: false },
      { id: "a2", cantidad: 2.5, valor: 625_000, excede: false },
    ])
    expect(r.bruto).toBe(1_125_000)
    expect(r.neto).toBe(1_125_000)
  })
  it("tope por actividad: acumulado + esta acta <= contratada", () => {
    expect(calcularActa(info(), form({ cantidades: { a1: "60" } })).lineas[0].excede).toBe(false)
    expect(calcularActa(info(), form({ cantidades: { a1: "60,5" } })).lineas[0].excede).toBe(true)
    const v = validarActa(info(), form({ cantidades: { a1: "61" } }))
    expect(v).toEqual({ ok: false, error: '"Excavación" pasa de la cantidad contratada (100 m3).' })
  })
  it("sin ninguna cantidad no se guarda", () => {
    expect(validarActa(info(), form())).toEqual({ ok: false, error: "Escribe la cantidad ejecutada de al menos una actividad." })
  })
})

describe("calcularActa: valor global", () => {
  const global = info({ anexoTipo: "valor_global", actividades: [], avanceOtras: 30 })
  it("bruto = % de avance × valor del contrato", () => {
    const r = calcularActa(global, form({ porcentajeAvance: "25" }))
    expect(r.avance).toBe(25)
    expect(r.bruto).toBe(2_500_000)
  })
  it("el avance acumulado no pasa del 100 %", () => {
    expect(validarActa(global, form({ porcentajeAvance: "71" }))).toEqual({
      ok: false,
      error: "El avance acumulado pasaría del 100 % (ya va en 30 %).",
    })
    expect(validarActa(global, form({ porcentajeAvance: "70" })).ok).toBe(true)
  })
})

describe("descuentos", () => {
  it("amortización del anticipo y retención en garantía sobre el bruto", () => {
    const r = calcularActa(
      info({ anticipoPorcentaje: 30, retencionPorcentaje: 5 }),
      form({ cantidades: { a2: "4" }, descuentos: [{ concepto: "Retefuente", valor: "10.000" }] })
    )
    expect(r.bruto).toBe(1_000_000)
    expect(r.amortizacion).toBe(300_000)
    expect(r.retencion).toBe(50_000)
    expect(r.otros).toBe(10_000)
    expect(r.neto).toBe(640_000)
  })
  it("no amortiza más que el anticipo que falta", () => {
    // Anticipo = 3.000.000; ya amortizado 2.900.000: falta 100.000.
    const r = calcularActa(info({ anticipoPorcentaje: 30, amortizadoOtras: 2_900_000 }), form({ cantidades: { a2: "4" } }))
    expect(r.amortizacion).toBe(100_000)
  })
  it("el acta final amortiza todo lo que falte (sin pasar del bruto)", () => {
    const r = calcularActa(info({ anticipoPorcentaje: 30, amortizadoOtras: 1_000_000 }), form({ tipo: "final", cantidades: { a2: "20" } }))
    expect(r.bruto).toBe(5_000_000)
    expect(r.amortizacion).toBe(2_000_000)
  })
  it("los descuentos no pueden pasar del valor del acta", () => {
    const v = validarActa(info(), form({ cantidades: { a1: "1" }, descuentos: [{ concepto: "ICA", valor: "60.000" }] }))
    expect(v).toEqual({ ok: false, error: "Los descuentos pasan del valor del acta." })
  })
  it("un descuento necesita concepto y valor > 0", () => {
    expect(validarActa(info(), form({ cantidades: { a1: "1" }, descuentos: [{ concepto: "", valor: "5" }] }))).toEqual({
      ok: false,
      error: "Escribe el concepto de cada descuento.",
    })
  })
})

describe("acta de liquidación", () => {
  it("devuelve la retención y descuenta el anticipo que falte", () => {
    const r = calcularActa(
      info({ anticipoPorcentaje: 30, amortizadoAprobado: 2_500_000, retenidoAprobado: 400_000 }),
      form({ tipo: "liquidacion" })
    )
    expect(r.bruto).toBe(0)
    expect(r.devolucionRetencion).toBe(400_000)
    expect(r.amortizacion).toBe(500_000)
    expect(r.neto).toBe(-100_000)
  })
})

describe("tiposPermitidos", () => {
  it("sin póliza aprobada no hay actas", () => {
    expect(tiposPermitidos(info({ polizaEstado: "pendiente" }))).toEqual({ tipos: [], motivo: expect.stringMatching(/Falta la póliza/) })
    expect(tiposPermitidos(info({ polizaEstado: "recibida" })).tipos).toEqual([])
  })
  it("normal: parcial, final y liquidación", () => {
    expect(tiposPermitidos(info()).tipos).toEqual(["parcial", "final", "liquidacion"])
  })
  it("vencido: solo liquidación", () => {
    const t = tiposPermitidos(info({ vencido: true }))
    expect(t.tipos).toEqual(["liquidacion"])
    expect(t.motivo).toMatch(/vencido/)
  })
  it("con acta final: solo liquidación (si no hay actas por aprobar)", () => {
    expect(tiposPermitidos(info({ tieneFinal: true })).tipos).toEqual(["liquidacion"])
    expect(tiposPermitidos(info({ tieneFinal: true, actasPorAprobar: 1 })).tipos).toEqual([])
  })
  it("liquidado o sin minuta aprobada: nada", () => {
    expect(tiposPermitidos(info({ liquidado: true })).tipos).toEqual([])
    expect(tiposPermitidos(info({ listoParaActas: false })).tipos).toEqual([])
  })
})

describe("cupo del contrato", () => {
  it("las rechazadas no consumen; saldo = valor - consumido", () => {
    const consumido = consumidoActas([
      { estado: "aprobada", valorBruto: 1_000_000 },
      { estado: "pendiente", valorBruto: 250_000.5 },
      { estado: "rechazada", valorBruto: 9_000_000 },
    ])
    expect(consumido).toBe(1_250_000.5)
    expect(saldoContrato(2_000_000, consumido)).toBe(749_999.5)
  })
  it("no deja pasar del saldo del contrato", () => {
    expect(validarActa(info({ brutoOtras: 9_900_000 }), form({ cantidades: { a2: "1" } }))).toEqual({
      ok: false,
      error: "El acta pasa del saldo del contrato.",
    })
  })
})

it("formDesdeActa: las cantidades y descuentos guardados vuelven al formulario", () => {
  const acta = {
    tipo: "parcial",
    periodoDesde: "2026-10-01",
    periodoHasta: "2026-10-15",
    observaciones: null,
    porcentajeAvance: null,
    actividades: [
      { id: "a1", cantidad: 1250.5 },
      { id: "a2", cantidad: null },
    ],
    descuentos: [{ concepto: "ICA", valor: 1500 }],
  } as unknown as ActaDetalle
  const f = formDesdeActa(acta)
  expect(f.cantidades).toEqual({ a1: "1.250,5" })
  expect(f.descuentos).toEqual([{ concepto: "ICA", valor: "1.500" }])
  expect(f.periodoHasta).toBe("2026-10-15")
})

it("actaEditable: solo quien la creó y si no está aprobada", () => {
  expect(actaEditable({ estado: "pendiente", esMio: true })).toBe(true)
  expect(actaEditable({ estado: "rechazada", esMio: true })).toBe(true)
  expect(actaEditable({ estado: "aprobada", esMio: true })).toBe(false)
  expect(actaEditable({ estado: "pendiente", esMio: false })).toBe(false)
})

describe("calcularActa: valor cambiado por otrosí", () => {
  it("el tope y el % son sobre el valor vigente; el anticipo, sobre el inicial", () => {
    const i = info({ anexoTipo: "valor_global", valor: 20_000_000, valorInicial: 10_000_000, anticipoPorcentaje: 30, actividades: [] })
    const r = calcularActa(i, form({ tipo: "final", porcentajeAvance: "100" }))
    expect(r.bruto).toBe(20_000_000)
    expect(r.amortizacion).toBe(3_000_000)
  })
})
