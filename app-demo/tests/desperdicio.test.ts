import { describe, expect, it } from "vitest"
import {
  excepcionesParaGuardar,
  filasIniciales,
  impactoDesperdicio,
  mapearDatosDesperdicio,
  porcentajeDeFila,
  type InsumoDesperdicio,
} from "@/lib/desperdicio"

const ins = (id: string, valorAplicable: number, extra: Partial<InsumoDesperdicio> = {}): InsumoDesperdicio => ({
  insumoId: id, codigo: 1, descripcion: id, unidad: "UND", tipo: "MATERIAL-M", nItems: 1, cantidadBase: 10,
  valorBase: valorAplicable, valorAplicable, lineasTrae: 0, excepcion: null, ...extra,
})

describe("desperdicio general de la versión", () => {
  it("filas iniciales: sin excepción sigue el general; 0 = desmarcado; otro % = su %", () => {
    expect(filasIniciales([ins("a", 1), ins("b", 1, { excepcion: 0 }), ins("c", 1, { excepcion: 10 })])).toEqual([
      { insumoId: "a", marcado: true, porcentaje: null },
      { insumoId: "b", marcado: false, porcentaje: null },
      { insumoId: "c", marcado: true, porcentaje: 10 },
    ])
  })

  it("impacto sobre lo aplicable (sin las líneas que ya traen desperdicio)", () => {
    const insumos = [ins("a", 1000), ins("b", 2000), ins("concreto", 0, { valorBase: 50000, lineasTrae: 3 }), ins("c", 500)]
    const filas = [
      { insumoId: "a", marcado: true, porcentaje: null },
      { insumoId: "b", marcado: true, porcentaje: 10 },
      { insumoId: "concreto", marcado: true, porcentaje: null },
      { insumoId: "c", marcado: false, porcentaje: null },
    ]
    expect(porcentajeDeFila(filas[0], 5)).toBe(5)
    expect(porcentajeDeFila(filas[3], 5)).toBe(0)
    expect(impactoDesperdicio(insumos, filas, 5)).toEqual({ aumento: 250, marcados: 2 })
  })

  it("excepciones: desmarcados en 0 y los % distintos del general", () => {
    const filas = [
      { insumoId: "a", marcado: true, porcentaje: null },
      { insumoId: "b", marcado: true, porcentaje: 10 },
      { insumoId: "c", marcado: false, porcentaje: 20 },
      { insumoId: "d", marcado: true, porcentaje: 5 },
    ]
    expect(excepcionesParaGuardar(filas, 5)).toEqual([
      { insumo_id: "b", porcentaje: 10 },
      { insumo_id: "c", porcentaje: 0 },
    ])
  })

  it("lee lo que devuelve insumos_para_desperdicio", () => {
    const d = mapearDatosDesperdicio({
      general: "5.00",
      valor_presupuesto: "1500.5",
      insumos: [{ insumo_id: "x", codigo: 12, descripcion: "Concreto", unidad: "M3", tipo: null, n_items: 3,
                  cantidad_base: "4.5", valor_base: 90000, valor_aplicable: "0", lineas_trae: 3, excepcion: null }],
    })
    expect(d.general).toBe(5)
    expect(d.insumos[0]).toMatchObject({ insumoId: "x", nItems: 3, cantidadBase: 4.5, valorAplicable: 0, lineasTrae: 3, excepcion: null })
  })
})
