import { describe, expect, it } from "vitest"
import {
  filasIniciales,
  impactoDesperdicio,
  itemsParaGuardar,
  mapearDatosDesperdicio,
  porcentajeDeFila,
  type InsumoDesperdicio,
} from "@/lib/desperdicio"

const ins = (id: string, valorBase: number, extra: Partial<InsumoDesperdicio> = {}): InsumoDesperdicio => ({
  insumoId: id, codigo: 1, descripcion: id, unidad: "UND", tipo: "MATERIAL-M", nItems: 1,
  cantidadBase: 10, valorBase, porcentaje: null, diceDesperdicio: false, ...extra,
})

describe("desperdicio del presupuesto", () => {
  it("la primera vez marca todos menos los que el APU dice que ya traen desperdicio", () => {
    const filas = filasIniciales([ins("a", 100), ins("concreto", 1000, { diceDesperdicio: true })])
    expect(filas.map((f) => [f.insumoId, f.marcado])).toEqual([["a", true], ["concreto", false]])
  })

  it("si ya hay desperdicio guardado, respeta lo guardado", () => {
    const filas = filasIniciales([ins("a", 100, { porcentaje: 3 }), ins("b", 100), ins("c", 1, { diceDesperdicio: true, porcentaje: 2 })])
    expect(filas).toEqual([
      { insumoId: "a", marcado: true, porcentaje: 3 },
      { insumoId: "b", marcado: false, porcentaje: null },
      { insumoId: "c", marcado: true, porcentaje: 2 },
    ])
  })

  it("% propio o el general; desmarcado = 0; impacto y lo que se guarda", () => {
    const insumos = [ins("a", 1000), ins("b", 2000), ins("c", 500)]
    const filas = [
      { insumoId: "a", marcado: true, porcentaje: null },
      { insumoId: "b", marcado: true, porcentaje: 10 },
      { insumoId: "c", marcado: false, porcentaje: 20 },
    ]
    expect(porcentajeDeFila(filas[0], 5)).toBe(5)
    expect(porcentajeDeFila(filas[2], 5)).toBe(0)
    expect(impactoDesperdicio(insumos, filas, 5)).toEqual({ aumento: 250, marcados: 2 })
    expect(itemsParaGuardar(filas, 5)).toEqual([
      { insumo_id: "a", porcentaje: 5 },
      { insumo_id: "b", porcentaje: 10 },
    ])
    // general en 0: solo quedan los que tienen % propio
    expect(itemsParaGuardar(filas, 0)).toEqual([{ insumo_id: "b", porcentaje: 10 }])
  })

  it("lee lo que devuelve insumos_para_desperdicio", () => {
    const d = mapearDatosDesperdicio({
      valor_presupuesto: "1500.5",
      insumos: [{ insumo_id: "x", codigo: 12, descripcion: "Cemento", unidad: "UND", tipo: null, n_items: 3,
                  cantidad_base: "4.5", valor_base: 90000, porcentaje: null, dice_desperdicio: true }],
    })
    expect(d.valorPresupuesto).toBe(1500.5)
    expect(d.insumos[0]).toMatchObject({ insumoId: "x", codigo: 12, nItems: 3, cantidadBase: 4.5, porcentaje: null, diceDesperdicio: true })
  })
})
