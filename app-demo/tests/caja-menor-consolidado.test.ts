import { describe, expect, it } from "vitest"
import {
  conFilasDeGastos,
  esFilaGasto,
  filaDeGasto,
  idFilaGasto,
  leerIdFilaGasto,
  mismaLiquidacionDeGastos,
  paraExcelConGastos,
  rutaSoporteGasto,
  separarFilasDeGastos,
  filasSinRetenciones,
  type GastosDePago,
} from "@/lib/caja-menor-consolidado"
import type { FilaLiquidacion, Pago } from "@/lib/pagos"
import type { GastoDetalle } from "@/lib/caja-menor"

const pago = (id: string, extra: Partial<Pago> = {}) =>
  ({ id, referencia: "001-00007", valor: 150000, valorDocumento: 150000, liquidacionEstado: "por_liquidar", estado: "aprobado", terceroNombre: "INGE", ...extra }) as Pago

const gasto = (id: string, orden: number, valor: number, liq: Partial<NonNullable<GastoDetalle["liquidacion"]>> | null = null): GastoDetalle => ({
  id, orden, fecha: "2026-11-20", proyectoId: "p", proyectoCodigo: null, proyectoNombre: "", solicitadoPorNombre: null,
  numeroFactura: `F-${orden}`, documento: "900123456-7", nombre: `Vendedor ${orden}`, concepto: "Tornillos", destino: "Obra", valor,
  soporte: { ruta: `u/${id}.pdf`, nombre: `${id}.pdf`, mime: null, tamano: null },
  liquidacion: liq ? { base: null, iva: null, retefuente: 0, reteiva: 0, reteica: 0, valorAPagar: valor, liquidadoEn: null, liquidadoPorNombre: null, ...liq } : null,
})

const cm: GastosDePago = {
  pagoId: "P1", legalizacionId: "L1", codigo: "CM-001-0001", pagoLiquidacionEstado: "por_liquidar",
  gastos: [gasto("g1", 1, 100000, { retefuente: 2500, valorAPagar: 97500 }), gasto("g2", 2, 50000)],
}

const filaExcel = (pagoId: string, extra: Partial<FilaLiquidacion> = {}): FilaLiquidacion => ({
  pagoId, base: null, iva: null, retefuente: null, reteiva: null, reteica: null, asumidas: null, liquidaciones: null,
  anticiposDescuentos: null, valorAPagar: null, sinRetenciones: false, comentario: null, ...extra,
})

describe("filas de gasto en el Consolidado", () => {
  it("id de fila de gasto", () => {
    const id = idFilaGasto("P1", "g1")
    expect(leerIdFilaGasto(id)).toEqual({ pagoId: "P1", gastoId: "g1" })
    expect(leerIdFilaGasto("P1")).toBeNull()
    expect(esFilaGasto({ id })).toBe(true)
    expect(rutaSoporteGasto("g1")).toBe("/ayf/soporte-pago/gasto/g1")
  })

  it("un gasto se ve como un pago (quien vendió, valor, liquidación)", () => {
    const f = filaDeGasto(pago("P1"), cm, cm.gastos[0])
    expect(f).toMatchObject({
      terceroNombre: "Vendedor 1", valor: 100000, valorDocumento: 100000, retefuente: 2500, valorAPagar: 97500,
      liquidacionEstado: "liquidado", referencia: "001-00007 · 1", origen: "CM-001-0001 · gasto 1",
    })
    expect(f.cajaMenorGasto).toMatchObject({ pagoId: "P1", gastoId: "g1", orden: 1 })
    const sinLiquidar = filaDeGasto(pago("P1"), cm, cm.gastos[1])
    expect(sinLiquidar).toMatchObject({ liquidacionEstado: "por_liquidar", valorAPagar: null, retefuente: null })
  })

  it("debajo del reembolso desplegado van sus gastos; los demás pagos igual", () => {
    const pagos = [pago("P0"), pago("P1"), pago("P2")]
    const desplegadas = conFilasDeGastos(pagos, { P1: cm }, () => true)
    expect(desplegadas.map((p) => p.id)).toEqual(["P0", "P1", idFilaGasto("P1", "g1"), idFilaGasto("P1", "g2"), "P2"])
    expect(desplegadas[1].cajaMenor).toEqual({ legalizacionId: "L1", codigo: "CM-001-0001", nGastos: 2 })
    expect(conFilasDeGastos(pagos, { P1: cm }, () => false).map((p) => p.id)).toEqual(["P0", "P1", "P2"])
  })

  it("en el Excel el reembolso se reemplaza por sus gastos", () => {
    expect(paraExcelConGastos([pago("P0"), pago("P1")], { P1: cm }).map((p) => p.id)).toEqual([
      "P0", idFilaGasto("P1", "g1"), idFilaGasto("P1", "g2"),
    ])
  })

  it("al subir el Excel separa pagos, gastos y comentarios", () => {
    const r = separarFilasDeGastos([
      filaExcel("P0", { valorAPagar: 10 }),
      filaExcel(idFilaGasto("P1", "g1"), { retefuente: 2500, valorAPagar: 97500 }),
      filaExcel(idFilaGasto("P1", "g2"), { sinRetenciones: true, comentario: "Falta el RUT" }),
      filaExcel(idFilaGasto("P1", "g3"), { comentario: "Revisar factura" }),
    ])
    expect(r.pagos.map((f) => f.pagoId)).toEqual(["P0"])
    expect(r.gastosPorPago.get("P1")?.map((x) => x.fila)).toEqual([
      { gasto_id: "g1", base: null, iva: null, retefuente: 2500, reteiva: null, reteica: null, valor_a_pagar: 97500, sin_retenciones: false },
      { gasto_id: "g2", base: null, iva: null, retefuente: null, reteiva: null, reteica: null, valor_a_pagar: null, sin_retenciones: true },
    ])
    expect(r.comentariosPorPago.get("P1")).toEqual(["Falta el RUT", "Revisar factura"])
  })

  it("un Excel de ida y vuelta de un reembolso ya liquidado no cambia nada", () => {
    const liquidado = [gasto("g1", 1, 100000, { retefuente: 2500, valorAPagar: 97500 }), gasto("g2", 2, 50000, {})]
    const filas = [
      { gasto_id: "g1", base: null, iva: null, retefuente: 2500, reteiva: null, reteica: null, valor_a_pagar: 97500, sin_retenciones: false },
      { gasto_id: "g2", base: null, iva: null, retefuente: null, reteiva: null, reteica: null, valor_a_pagar: null, sin_retenciones: true },
    ]
    expect(mismaLiquidacionDeGastos(filas, liquidado)).toBe(true)
    expect(mismaLiquidacionDeGastos([{ ...filas[0], valor_a_pagar: 90000 }], liquidado)).toBe(false)
  })
})

describe("liquidar sin retenciones con el reembolso marcado", () => {
  it("solo los gastos sin liquidar, sin retenciones; los liquidados se dejan", () => {
    expect(filasSinRetenciones(cm)).toEqual([
      { gasto_id: "g2", base: null, iva: null, retefuente: null, reteiva: null, reteica: null, valor_a_pagar: null, sin_retenciones: true },
    ])
    expect(filasSinRetenciones({ gastos: [gasto("g9", 1, 10, {})] })).toEqual([])
  })
})

