import { describe, expect, it } from "vitest"
import {
  leerModalidad,
  lineaFijaModalidad,
  porcentajeHerramientaMenor,
  resumenApuParaModalidad,
  validarModalidadesImport,
  type DatosModalidadItem,
} from "@/lib/modalidades"

const base: DatosModalidadItem = {
  modalidad: null,
  precioOficial: 231596,
  topeTodoCostoPct: 42,
  manoObraOficial: 171999,
  herramientaMenorPct: 10,
  tieneManoObra: true,
  conInsumos: false,
}

describe("leerModalidad", () => {
  it("lee el texto de la lista y variantes", () => {
    expect(leerModalidad("Administración")).toBe("administracion")
    expect(leerModalidad("admin")).toBe("administracion")
    expect(leerModalidad("Subcontrato todo costo")).toBe("todo_costo")
    expect(leerModalidad("TODO COSTO")).toBe("todo_costo")
    expect(leerModalidad("Subcontrato mano de obra")).toBe("mano_obra")
    expect(leerModalidad("MO")).toBe("mano_obra")
  })
  it("vacía es administración", () => {
    expect(leerModalidad("")).toBe("administracion")
    expect(leerModalidad(null)).toBe("administracion")
    expect(leerModalidad("   ")).toBe("administracion")
  })
  it("lo que no reconoce da null", () => {
    expect(leerModalidad("obra")).toBeNull()
  })
})

describe("porcentajeHerramientaMenor", () => {
  it("lee el % del nombre de la línea", () => {
    expect(porcentajeHerramientaMenor("Herramienta menor 10% M.O. AA")).toBe(10)
    expect(porcentajeHerramientaMenor("Herramienta menor 5% M.O.")).toBe(5)
    expect(porcentajeHerramientaMenor("HERRAMIENTA MENOR 7,5 %")).toBe(7.5)
  })
  it("null si no es herramienta menor o no dice el %", () => {
    expect(porcentajeHerramientaMenor("Motosierra")).toBeNull()
    expect(porcentajeHerramientaMenor("Herramienta menor")).toBeNull()
  })
})

describe("lineaFijaModalidad", () => {
  it("todo costo: % del proyecto × precio oficial (tala de árbol, Malecón)", () => {
    expect(lineaFijaModalidad({ ...base, modalidad: "todo_costo" })).toEqual({ concepto: "todo_costo", valor: 97270.32 })
  })
  it("mano de obra sin insumos: 50 % × (MO + herramienta menor)", () => {
    expect(lineaFijaModalidad({ ...base, modalidad: "mano_obra" })).toEqual({ concepto: "mano_obra_subcontrato", valor: 94599.45 })
    expect(lineaFijaModalidad({ ...base, modalidad: "mano_obra", herramientaMenorPct: 5 })).toEqual({
      concepto: "mano_obra_subcontrato",
      valor: 90299.48,
    })
  })
  it("mano de obra con insumos: sin línea fija (catálogo)", () => {
    expect(lineaFijaModalidad({ ...base, modalidad: "mano_obra", conInsumos: true })).toBeNull()
  })
  it("administración: 100 % × (MO + herramienta menor)", () => {
    expect(lineaFijaModalidad({ ...base, modalidad: "administracion", conInsumos: true })).toEqual({
      concepto: "mano_obra_administracion",
      valor: 189198.9,
    })
  })
  it("administración sin mano de obra: sin línea fija", () => {
    expect(lineaFijaModalidad({ ...base, modalidad: "administracion", tieneManoObra: false })).toBeNull()
  })
  it("sin herramienta menor cuenta 0", () => {
    expect(lineaFijaModalidad({ ...base, modalidad: "administracion", herramientaMenorPct: null })?.valor).toBe(171999)
  })
  it("errores", () => {
    expect(() => lineaFijaModalidad({ ...base, modalidad: "todo_costo", topeTodoCostoPct: null })).toThrow("% de subcontrato")
    expect(() => lineaFijaModalidad({ ...base, modalidad: "todo_costo", precioOficial: 0 })).toThrow("precio oficial")
    expect(() => lineaFijaModalidad({ ...base, modalidad: "mano_obra", tieneManoObra: false })).toThrow("no tiene mano de obra")
    expect(() => lineaFijaModalidad({ ...base, modalidad: "mano_obra", manoObraOficial: null })).toThrow("mano de obra oficial")
    expect(() => lineaFijaModalidad({ ...base, modalidad: "administracion", manoObraOficial: 0 })).toThrow("mano de obra oficial")
  })
  it("sin modalidad: nada", () => {
    expect(lineaFijaModalidad(base)).toBeNull()
  })
})

describe("resumenApuParaModalidad", () => {
  it("el equipo no cuenta como material", () => {
    expect(
      resumenApuParaModalidad([
        { tipo: "EQUIPO", descripcion: "Herramienta menor 10% M.O. AA-3" },
        { tipo: "EQUIPO", descripcion: "Motosierra" },
        { tipo: "MO", descripcion: "Cuadrilla AA-3" },
      ])
    ).toEqual({ tieneManoObra: true, conInsumos: false, herramientaMenorPct: 10 })
  })
  it("con insumos y sin herramienta menor", () => {
    expect(
      resumenApuParaModalidad([
        { tipo: "INSUMO", descripcion: "Alambre" },
        { tipo: "MO", descripcion: "Cuadrilla" },
      ])
    ).toEqual({ tieneManoObra: true, conInsumos: true, herramientaMenorPct: null })
  })
})

describe("validarModalidadesImport", () => {
  const apu = new Map([
    ["1.1", { tieneManoObra: true, conInsumos: true, herramientaMenorPct: 10 }],
    ["1.3", { tieneManoObra: true, conInsumos: false, herramientaMenorPct: 10 }],
    ["1.5", { tieneManoObra: false, conInsumos: true, herramientaMenorPct: null }],
  ])
  it("arma las filas y salta los capítulos", () => {
    const r = validarModalidadesImport(
      [
        { codigo: "1", fila: 7, modalidad: "administracion", manoObraOficial: null, precioOficial: null },
        { codigo: "1.1", fila: 8, modalidad: "mano_obra", manoObraOficial: null, precioOficial: 22372 },
        { codigo: "1.3", fila: 9, modalidad: "mano_obra", manoObraOficial: 171999, precioOficial: 231596 },
        { codigo: "1.4", fila: 10, modalidad: "todo_costo", manoObraOficial: null, precioOficial: 2606652 },
        { codigo: "1.5", fila: 11, modalidad: "administracion", manoObraOficial: null, precioOficial: 5000 },
      ],
      new Set(["1"]),
      apu,
      42
    )
    expect(r.errores).toEqual([])
    expect(r.filas.map((f) => f.codigo)).toEqual(["1.1", "1.3", "1.4", "1.5"])
    expect(r.filas[1]).toEqual({ codigo: "1.3", modalidad: "mano_obra", mano_obra_oficial: 171999, herramienta_menor_pct: 10 })
  })
  it("errores con fila e ítem", () => {
    const r = validarModalidadesImport(
      [
        { codigo: "1.1", fila: 8, modalidad: "administracion", manoObraOficial: null, precioOficial: 22372 },
        { codigo: "1.4", fila: 10, modalidad: "todo_costo", manoObraOficial: null, precioOficial: 100 },
        { codigo: "1.5", fila: 11, modalidad: "mano_obra", manoObraOficial: 100, precioOficial: 5000 },
      ],
      new Set(),
      apu,
      null
    )
    expect(r.errores).toHaveLength(3)
    expect(r.errores[0]).toContain("Fila 8 (ítem 1.1, Administración): falta la mano de obra oficial")
    expect(r.errores[1]).toContain("% de subcontrato a todo costo")
    expect(r.errores[2]).toContain("no tiene mano de obra")
  })
})
