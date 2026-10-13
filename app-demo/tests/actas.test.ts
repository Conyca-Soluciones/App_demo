import { describe, expect, it } from "vitest"
import { leerNumero } from "@/lib/contratos"
import { calcularLinea, consumidoActas, lineaActaVacia, lineasFormDesdeActa, saldoContrato, type ActaDetalle, totalActa, validarActa, type InsumoParaActa, type ItemParaActa, type LineaActaForm } from "@/lib/actas"

const item: ItemParaActa = { id: "i1", codigo: "1.01", descripcion: "Excavación", unidad: "M3" }
const insumo = (cambios: Partial<InsumoParaActa> = {}): InsumoParaActa => ({
  itemApuId: "a1",
  insumoCodigo: 256,
  descripcion: "ARCILLA",
  unidad: "M3",
  precio: 29_999,
  ivaPorcentaje: 19,
  ...cambios,
})
const linea = (cantidad: string, cambios: Partial<LineaActaForm> = {}): LineaActaForm => ({ item, insumo: insumo(), cantidad, ...cambios })

describe("calcularLinea", () => {
  it("base = cantidad × precio, IVA sobre la base, total = base + IVA", () => {
    expect(calcularLinea(2.5, 29_999, 19)).toEqual({ base: 74_997.5, iva: 14_249.53, total: 89_247.03 })
    expect(calcularLinea(3, 100_000, 0)).toEqual({ base: 300_000, iva: 0, total: 300_000 })
  })
})

describe("totalActa", () => {
  it("suma solo las líneas completas; cantidad en formato colombiano", () => {
    expect(totalActa([linea("2,5"), linea("1", { insumo: insumo({ itemApuId: "a2", precio: 1_000, ivaPorcentaje: 0 }) }), lineaActaVacia(), linea("")])).toBe(90_247.03)
  })
})

describe("validarActa", () => {
  it("ignora las líneas vacías y devuelve las completas", () => {
    expect(validarActa([lineaActaVacia(), linea("1.000")])).toEqual({ ok: true, lineas: [{ presupuestoItemId: "i1", itemApuId: "a1", cantidad: 1000 }] })
  })
  it("errores con el número de la línea", () => {
    expect(validarActa([])).toEqual({ ok: false, error: "Agrega al menos una línea al acta." })
    expect(validarActa([{ item, insumo: null, cantidad: "" }])).toEqual({ ok: false, error: "Línea 1: escoge el insumo." })
    expect(validarActa([linea("1"), linea("0")])).toEqual({ ok: false, error: "Línea 2: escribe una cantidad mayor que cero." })
    expect(validarActa([linea("1"), linea("2")])).toEqual({ ok: false, error: "Línea 2: ese insumo de ese ítem ya está en el acta." })
    expect(validarActa([linea("1", { insumo: insumo({ precio: null }) })])).toEqual({ ok: false, error: "Línea 1: el insumo no tiene precio en el APU." })
  })
  it("máximo 20 líneas", () => {
    const muchas = Array.from({ length: 21 }, (_, i) => linea("1", { insumo: insumo({ itemApuId: `a${i}` }) }))
    expect(validarActa(muchas)).toEqual({ ok: false, error: "Un acta tiene como máximo 20 líneas." })
  })
})

describe("cupo del contrato", () => {
  it("las rechazadas no consumen; saldo = valor - consumido", () => {
    const consumido = consumidoActas([
      { estado: "aprobada", total: 1_000_000 },
      { estado: "pendiente", total: 250_000.5 },
      { estado: "rechazada", total: 9_000_000 },
    ])
    expect(consumido).toBe(1_250_000.5)
    expect(saldoContrato(2_000_000, consumido)).toBe(749_999.5)
  })
})

describe("lineasFormDesdeActa", () => {
  it("arma las líneas del formulario; sin ítem o insumo borrado quedan por escoger", () => {
    const base = { orden: 1, itemCodigo: "1.01", itemDescripcion: "Excavación", insumoCodigo: 256, insumoDescripcion: "ARCILLA", unidad: "M3", precio: 100, ivaPorcentaje: 19, baseIva: 0, iva: 0, total: 0 }
    const acta = {
      lineas: [
        { ...base, presupuestoItemId: "i1", itemApuId: "a1", cantidad: 1250.5 },
        { ...base, presupuestoItemId: "i1", itemApuId: null, cantidad: 2 },
      ],
    } as unknown as ActaDetalle
    const [a, b] = lineasFormDesdeActa(acta)
    expect(a.item?.id).toBe("i1")
    expect(a.insumo).toMatchObject({ itemApuId: "a1", precio: 100, ivaPorcentaje: 19 })
    expect(leerNumero(a.cantidad)).toBe(1250.5)
    expect(b.insumo).toBeNull()
  })
})
