import { describe, expect, it } from "vitest"
import { aplicarItemsGlobales, esUnidadGlobal, idsConHijos, itemSinApu } from "@/lib/items-globales"

const item = (p: Partial<Parameters<typeof aplicarItemsGlobales>[0][number]> & { id: string; codigo: string }) => ({
  padreId: "cap",
  descripcion: "Ítem",
  unidad: "GL",
  cantidad: 1,
  precioOriginal: null as number | null,
  ...p,
})

describe("ítems globales del presupuesto", () => {
  it("reconoce la unidad global", () => {
    for (const u of ["GL", "gl", "glb", "Glb.", "GLOBAL", " gl "]) expect(esUnidadGlobal(u)).toBe(true)
    for (const u of ["UND", "M2", "", null, "GALON"]) expect(esUnidadGlobal(u)).toBe(false)
  })

  it("un GL sin bloque APU toma el valor unitario del Excel", () => {
    const cap = item({ id: "cap", codigo: "20", padreId: null, unidad: null })
    const retie = item({ id: "a", codigo: "20.1", precioOriginal: 19040000 })
    const { items, errores } = aplicarItemsGlobales([cap, retie], new Set(), true)
    expect(errores).toEqual([])
    expect(items[1]).toMatchObject({ valorUnitario: 19040000, valorTotal: 19040000 })
    expect(items[0].valorUnitario).toBeUndefined()
  })

  it("un GL con bloque APU sigue con su APU, y lo que no es GL no cambia", () => {
    const conApu = item({ id: "a", codigo: "1.1", precioOriginal: 500 })
    const m2 = item({ id: "b", codigo: "1.2", unidad: "M2", precioOriginal: 500 })
    const { items } = aplicarItemsGlobales([conApu, m2], new Set(["1.1"]), true)
    expect(items[0].valorUnitario).toBeUndefined()
    expect(items[1].valorUnitario).toBeUndefined()
  })

  it("un capítulo GL (con hijos) no es global", () => {
    const cap = item({ id: "cap", codigo: "20", padreId: null, precioOriginal: 1000 })
    const hijo = item({ id: "a", codigo: "20.1", precioOriginal: 10 })
    const { items } = aplicarItemsGlobales([cap, hijo], new Set(), true)
    expect(items[0].valorUnitario).toBeUndefined()
    expect(items[1].valorUnitario).toBe(10)
  })

  it("sin valor unitario: error si el Excel trae hoja APU, nada si no", () => {
    const sinValor = item({ id: "a", codigo: "20.3", descripcion: "PMA" })
    expect(aplicarItemsGlobales([sinValor], new Set(), true).errores[0]).toMatch(/20\.3.*PMA/)
    expect(aplicarItemsGlobales([sinValor], new Set(), false).errores).toEqual([])
  })
})

describe("itemSinApu", () => {
  const items = [
    { id: "c", padreId: null, apuId: null, unidad: null, valorUnitario: null },
    { id: "a", padreId: "c", apuId: null, unidad: "M2", valorUnitario: 0 },
    { id: "b", padreId: "c", apuId: "apu1", unidad: "M2", valorUnitario: 5000 },
    { id: "g", padreId: "c", apuId: null, unidad: "GL", valorUnitario: 1_000_000 },
    { id: "g0", padreId: "c", apuId: null, unidad: "GLB", valorUnitario: 0 },
  ]
  const conHijos = idsConHijos(items)
  it("marca solo los ítems hoja sin APU que no son globales con valor", () => {
    expect(items.filter((i) => itemSinApu(i, conHijos)).map((i) => i.id)).toEqual(["a", "g0"])
  })
})
