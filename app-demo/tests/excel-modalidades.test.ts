import { describe, expect, it } from "vitest"
import {
  filasParaAplicar,
  leerFilasModalidades,
  mensajeErrorModalidad,
  type ItemInfoModalidad,
} from "@/lib/excel-modalidades"

const encabezado = [
  "Código",
  "Descripción",
  "Unidad",
  "Precio oficial",
  "¿Tiene insumos?",
  "¿Tiene mano de obra?",
  "Herramienta menor %",
  "Modalidad",
  "Mano de obra",
]

describe("leerFilasModalidades", () => {
  it("lee modalidad y mano de obra; vacía = Administración; sin mano de obra no la manda", () => {
    const r = leerFilasModalidades([
      ["Modalidades — Malecón"],
      [],
      encabezado,
      ["1.1", "Cerramiento", "m", 22372, "Sí", "Sí", 10, "Subcontrato mano de obra", null],
      ["1.3", "Tala", "und", 231596, "No", "Sí", 10, "Administración", 171999],
      ["1.4", "Campamento", "und", 2606652, "Sí", "Sí", null, "Subcontrato todo costo", "14.163"],
      ["1.10", "Replanteo", "m²", 2088, "Sí", "Sí", 10, "", ""],
      [null, "fila vacía"],
    ])
    expect(r.errores).toEqual([])
    expect(r.filas).toEqual([
      { filaExcel: 4, vacia: false, codigo: "1.1", modalidad: "mano_obra" },
      { filaExcel: 5, vacia: false, codigo: "1.3", modalidad: "administracion", mano_obra_oficial: 171999 },
      { filaExcel: 6, vacia: false, codigo: "1.4", modalidad: "todo_costo", mano_obra_oficial: 14163 },
      { filaExcel: 7, vacia: true, codigo: "1.10", modalidad: "administracion" },
    ])
  })
  it("errores con fila e ítem", () => {
    const r = leerFilasModalidades([
      encabezado,
      ["1.1", "", "", "", "", "", "", "Obra", ""],
      ["1.2", "", "", "", "", "", "", "Administración", "mucho"],
      ["1.3", "", "", "", "", "", "", "Administración", -5],
      ["1.4", "", "", "", "", "", "", "Administración", ""],
      ["1.4", "", "", "", "", "", "", "Administración", ""],
    ])
    expect(r.filas.map((f) => f.codigo)).toEqual(["1.4"])
    expect(r.errores).toEqual([
      '  Fila 2 (ítem 1.1): la modalidad "Obra" no se reconoce',
      '  Fila 3 (ítem 1.2): la mano de obra "mucho" no es un número',
      "  Fila 4 (ítem 1.3): la mano de obra no puede ser negativa",
      "  Fila 6 (ítem 1.4): el código está repetido en el Excel",
    ])
  })
  it("sin encabezado avisa", () => {
    expect(() => leerFilasModalidades([["otra cosa"]])).toThrow(/Código/)
  })
})

describe("Excel de modalidades de ida y vuelta", () => {
  it("lo que se baja se vuelve a leer igual", async () => {
    const XLSX = await import("xlsx")
    const { construirLibroModalidades } = await import("@/lib/excel-modalidades")
    const items: ItemInfoModalidad[] = [
      {
        codigo: "1.10",
        descripcion: "Replanteo",
        unidad: "m²",
        precioOficial: 10120,
        modalidad: null,
        manoObraOficial: null,
        herramientaMenorPct: null,
        herramientaMenorApu: 10,
        tieneManoObra: true,
        conInsumos: true,
        conMovimientos: false,
      },
      {
        codigo: "1.3",
        descripcion: "Tala",
        unidad: "und",
        precioOficial: 231596,
        modalidad: "mano_obra",
        manoObraOficial: 171999,
        herramientaMenorPct: null,
        herramientaMenorApu: 10,
        tieneManoObra: true,
        conInsumos: false,
        conMovimientos: false,
      },
    ]
    const libro = await construirLibroModalidades("Modalidades — Prueba", items, null)
    const buffer = await libro.xlsx.writeBuffer()
    const leido = XLSX.read(new Uint8Array(buffer as ArrayBuffer), { type: "array" })
    const filas = XLSX.utils.sheet_to_json<unknown[]>(leido.Sheets[leido.SheetNames[0]], { header: 1, defval: null })
    const r = leerFilasModalidades(filas)
    expect(r.errores).toEqual([])
    expect(r.filas.map(({ filaExcel: _f, vacia: _v, ...resto }) => resto)).toEqual([
      { codigo: "1.10", modalidad: "administracion" },
      { codigo: "1.3", modalidad: "mano_obra", mano_obra_oficial: 171999 },
    ])
  })
})

describe("filasParaAplicar", () => {
  const fila = (codigo: string, modalidad: "administracion" | "todo_costo" | "mano_obra", vacia = false) => ({
    filaExcel: 1,
    vacia,
    codigo,
    modalidad,
  })
  it("salta los ítems con requisiciones o contratos que se dejaron como estaban", () => {
    const info = new Map([
      ["1,1", { conMovimientos: true, modalidad: null }],
      ["1,4", { conMovimientos: true, modalidad: "todo_costo" as const }],
      ["1,9", { conMovimientos: true, modalidad: null }],
      ["1,5", { conMovimientos: false, modalidad: null }],
    ])
    const r = filasParaAplicar(
      [fila("1,1", "administracion", true), fila("1,4", "todo_costo"), fila("1,9", "mano_obra"), fila("1,5", "administracion", true)],
      info
    )
    expect(r.saltadas).toBe(2)
    expect(r.filas.map((f) => f.codigo)).toEqual(["1,9", "1,5"])
  })
})

describe("mensajeErrorModalidad", () => {
  it("aclara que la modalidad vacía cuenta como Administración", () => {
    expect(mensajeErrorModalidad({ filaExcel: 1, vacia: true, codigo: "1,5", modalidad: "administracion" }, "falta la mano de obra oficial")).toMatch(
      /vacía y cuenta como Administración/
    )
    expect(mensajeErrorModalidad({ filaExcel: 1, vacia: false, codigo: "1,5", modalidad: "administracion" }, "falta la mano de obra oficial")).toBe(
      "falta la mano de obra oficial"
    )
  })
})
