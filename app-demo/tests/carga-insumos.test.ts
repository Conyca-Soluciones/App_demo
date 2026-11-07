import { describe, expect, it } from "vitest"
import * as XLSX from "xlsx"
import {
  COLUMNAS_CARGA,
  HOJA_CARGA,
  agruparSinOpcion,
  claveTexto,
  descripcionMaestro,
  leerPlantillaInsumos,
  type LineaSinOpcion,
} from "@/lib/carga-insumos"

const linea = (insumo: string, unidad: string | null, codigoItem: string): LineaSinOpcion => ({
  codigoItem,
  item: "Ítem",
  unidadItem: "und",
  cantidadItem: 1,
  insumo,
  unidad,
  cantidad: 1,
})

describe("textos de la carga de insumos", () => {
  it("compara sin mayúsculas ni espacios de más", () => {
    expect(claveTexto("  Cable   THHN 12 ")).toBe("cable thhn 12")
    expect(claveTexto(null)).toBe("")
  })
  it("deja la descripción del maestro en mayúsculas y con un espacio", () => {
    expect(descripcionMaestro("  cable  thhn  12 ")).toBe("CABLE THHN 12")
  })
})

describe("agruparSinOpcion", () => {
  it("une el mismo texto y unidad, separa por unidad y no repite ítems", () => {
    const grupos = agruparSinOpcion([
      linea("Cable THHN 12", "m", "1.2"),
      linea("cable  thhn 12", "M", "1.1"),
      linea("Cable THHN 12", "m", "1.1"),
      linea("Cable THHN 12", "rollo", "2.1"),
    ])
    expect(grupos).toHaveLength(2)
    const metros = grupos.find((g) => g.unidad.toLowerCase() === "m")!
    expect(metros.veces).toBe(3)
    expect(metros.items).toEqual(["1.2", "1.1"])
  })
})

function libroConPlantilla(filas: (string | number | null)[][], filaEncabezado = 4): ArrayBuffer {
  const datos: (string | number | null)[][] = []
  for (let i = 1; i < filaEncabezado; i++) datos.push(["Título de marca"])
  datos.push(COLUMNAS_CARGA.map((c) => c.titulo))
  datos.push(...filas)
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet(datos), HOJA_CARGA)
  return XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer
}

describe("leerPlantillaInsumos", () => {
  it("encuentra los encabezados aunque haya filas de título y lee números colombianos", async () => {
    const archivo = libroConPlantilla(
      [
        ["Cable THHN 12", "m", 3, "1.1, 1.2", "CABLE THHN 12", "MATERIAL - M", "METRO - M", "014 - X", 19, "2.500,5", "", ""],
        [null, null, null, null, null, null, null, null, null, null, null, null],
        ["Bulto mortero", "kg", 1, "3.1", "MORTERO SECO", "MATERIAL - M", "BULTO - BE", "001 - Y", 19, 32000, 40, "KG"],
      ],
      6
    )
    const filas = await leerPlantillaInsumos(archivo)
    expect(filas).toHaveLength(2)
    expect(filas[0]).toMatchObject({ fila: 7, insumoExcel: "Cable THHN 12", unidadApu: "m", precio: 2500.5, iva: 19 })
    expect(filas[1]).toMatchObject({ fila: 9, contenido: "40", unidadUso: "KG", precio: 32000 })
  })

  it("avisa si al archivo le faltan columnas", async () => {
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([["Insumo (como viene en el Excel)", "Tipo"], ["a", "b"]]), HOJA_CARGA)
    const archivo = XLSX.write(libro, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    await expect(leerPlantillaInsumos(archivo)).rejects.toThrow(/faltan columnas/)
  })
})
