import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import { parseApuSheet } from "@/lib/parse-apu-excel"

// Libro con una hoja "APU" a partir de filas (la primera fila no vacía con
// Código / Nombre / Tipo es el encabezado).
function libro(filas: unknown[][], nombre = "APU") {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre)
  return wb
}

const ENCABEZADO = ["Código", "Nombre", "Tipo", "Unidad", "Cantidad", "Rendimiento"]

describe("parseApuSheet", () => {
  it("arma un bloque por ítem con sus líneas", () => {
    const r = parseApuSheet(
      libro([
        ["PLANTILLA APU"],
        ENCABEZADO,
        ["1", "PRELIMINARES", null, null, null, null],
        ["1.1", "Localización y replanteo", null, "m2", null, null],
        [null, "Oficial", "MO", "hc", 0.05, 2],
        [null, "Estacas", "INSUMO", "und", 0.2, null],
        ["1.2", "Descapote", null, "m2", null, null],
        [null, "Ayudante", "mano de obra", "hc", 0.1, null],
      ])
    )
    expect(r.erroresEstructura).toEqual([])
    expect(r.bloques.map((b) => b.codigoItem)).toEqual(["1.1", "1.2"])
    expect(r.bloques[0].lineas).toEqual([
      { descripcion: "Oficial", tipo: "MO", unidad: "hc", cantidad: 0.05, rendimiento: 2 },
      { descripcion: "Estacas", tipo: "INSUMO", unidad: "und", cantidad: 0.2, rendimiento: null },
    ])
    expect(r.bloques[1].lineas[0].tipo).toBe("MO")
  })

  it("un Tipo desconocido no corta el import: queda como INSUMO", () => {
    const r = parseApuSheet(libro([ENCABEZADO, ["2.1", "Ítem", null, "m2", null, null], [null, "Algo", "HR", "hr", 1, null]]))
    expect(r.bloques[0].lineas[0].tipo).toBe("INSUMO")
  })

  it("reporta líneas sin ítem abierto y líneas sin nombre", () => {
    const r = parseApuSheet(
      libro([ENCABEZADO, [null, "Huérfano", "INSUMO", "und", 1, null], ["3.1", "Ítem", null, "m2", null, null], ["x", null, "INSUMO", "und", 1, null]])
    )
    expect(r.erroresEstructura).toHaveLength(2)
    expect(r.erroresEstructura[0]).toMatch(/Huérfano/)
    expect(r.erroresEstructura[1]).toMatch(/no tiene Nombre/)
  })

  it("errores claros si falta la hoja o el encabezado", () => {
    expect(() => parseApuSheet(libro([ENCABEZADO], "Otra"))).toThrow(/APU/)
    expect(() => parseApuSheet(libro([["a", "b"]]))).toThrow(/encabezado/)
  })
})
