import { describe, expect, it } from "vitest"
import {
  excepcionesParaGuardar,
  filasIniciales,
  impactoDesperdicio,
  mapearDatosDesperdicio,
  porcentajeDeFila,
  type LineaDesperdicio,
} from "@/lib/desperdicio"

const linea = (clave: string, valorBase: number, extra: Partial<LineaDesperdicio> = {}): LineaDesperdicio => ({
  clave, descripcion: clave, unidad: "UND", nItems: 1, lineas: 1, lineasPendientes: 0, cantidadBase: 10,
  valorBase, diceDesperdicio: false, excepcion: null, ...extra,
})

describe("desperdicio por línea del Excel", () => {
  it("la primera vez propone desmarcadas las que dicen desperdicio; después, lo guardado", () => {
    const lineas = [linea("cemento", 0, { lineasPendientes: 1 }), linea("concreto 5% desperdicio", 100, { diceDesperdicio: true })]
    expect(filasIniciales({ general: 0, configurado: false, lineas })).toEqual([
      { clave: "cemento", marcado: true, porcentaje: null },
      { clave: "concreto 5% desperdicio", marcado: false, porcentaje: null },
    ])
    const guardadas = [linea("a", 1, { excepcion: 0 }), linea("b", 1, { excepcion: 10 }), linea("c", 1, { diceDesperdicio: true })]
    expect(filasIniciales({ general: 5, configurado: true, lineas: guardadas })).toEqual([
      { clave: "a", marcado: false, porcentaje: null },
      { clave: "b", marcado: true, porcentaje: 10 },
      { clave: "c", marcado: true, porcentaje: null },
    ])
  })

  it("impacto solo sobre lo aprobado; excepciones = desmarcadas y % distintos", () => {
    const lineas = [linea("a", 1000), linea("b", 2000), linea("pend", 0, { lineasPendientes: 3 }), linea("c", 500)]
    const filas = [
      { clave: "a", marcado: true, porcentaje: null },
      { clave: "b", marcado: true, porcentaje: 10 },
      { clave: "pend", marcado: true, porcentaje: null },
      { clave: "c", marcado: false, porcentaje: null },
    ]
    expect(porcentajeDeFila(filas[3], 5)).toBe(0)
    expect(impactoDesperdicio(lineas, filas, 5)).toEqual({ aumento: 250, marcadas: 3 })
    expect(excepcionesParaGuardar(filas, 5)).toEqual([
      { clave: "b", porcentaje: 10 },
      { clave: "c", porcentaje: 0 },
    ])
  })

  it("lee lo que devuelve insumos_para_desperdicio", () => {
    const d = mapearDatosDesperdicio({
      general: "5.00",
      configurado: true,
      insumos: [{ clave: "mortero 1:4", descripcion: "Mortero 1:4", unidad: "m³", n_items: 12, lineas: 12,
                  lineas_pendientes: 12, cantidad_base: "3.5", valor_base: 0, dice_desperdicio: false, excepcion: "0" }],
    })
    expect(d).toMatchObject({ general: 5, configurado: true })
    expect(d.lineas[0]).toMatchObject({ clave: "mortero 1:4", nItems: 12, lineasPendientes: 12, cantidadBase: 3.5, excepcion: 0 })
  })
})
