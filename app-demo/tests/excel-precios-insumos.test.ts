import { describe, expect, it } from "vitest"
import { COLUMNAS_PRECIOS_INSUMOS as C, leerFilasPreciosInsumos } from "@/lib/excel-precios-insumos"

const listas = {
  tipos: ["MATERIAL - M", "CONSUMIBLES - C"],
  agrupaciones: ["006 - 006 - CONCRETOS Y MORTEROS", "020 - 020 - FERRETERIA MENOR"],
}

const encabezado = [C.insumo, C.unidadPedida, C.cantidad, C.proyectos, C.tipo, C.uM, C.agrupacion, C.precio, C.iva, C.unidadUso, C.contenido, C.id]

// El archivo real trae el logo y el título arriba: 5 filas antes del encabezado.
function hoja(...filas: unknown[][]): unknown[][] {
  return [["Precios de insumos nuevos"], [], [], [], [], encabezado, ...filas]
}

function fila(p: Partial<Record<keyof typeof C, unknown>>): unknown[] {
  const base: Record<keyof typeof C, unknown> = {
    insumo: "Cemento gris 50 kg",
    unidadPedida: "kg",
    cantidad: 500,
    proyectos: "MAL",
    tipo: "MATERIAL - M",
    uM: "UNIDAD - UND",
    agrupacion: "006 - 006 - CONCRETOS Y MORTEROS",
    precio: 25000,
    iva: 19,
    unidadUso: "KG",
    contenido: 50,
    id: "s1",
    ...p,
  }
  return (Object.keys(C) as (keyof typeof C)[]).map((k) => base[k])
}

describe("leerFilasPreciosInsumos", () => {
  it("lee una fila completa con la fila del Excel y la presentación", () => {
    const r = leerFilasPreciosInsumos(hoja(fila({})), listas)
    expect(r.errores).toEqual([])
    expect(r.filas).toEqual([
      {
        fila: 7,
        solicitudId: "s1",
        descripcion: "Cemento gris 50 kg",
        vrUnitario: 25000,
        ivaPorcentaje: 19,
        tipo: "MATERIAL - M",
        uM: "UNIDAD - UND",
        agrupacion: "006 - 006 - CONCRETOS Y MORTEROS",
        unidadUso: "KG",
        contenido: 50,
      },
    ])
  })

  it("salta las filas sin precio y las vacías", () => {
    const r = leerFilasPreciosInsumos(hoja(fila({ precio: null }), fila({ id: "", precio: 5 }), fila({ id: "s2" })), listas)
    expect(r.sinPrecio).toBe(1)
    expect(r.filas.map((f) => f.solicitudId)).toEqual(["s2"])
  })

  it("acepta texto en formato colombiano, IVA con % y nombres sin tildes ni mayúsculas", () => {
    const r = leerFilasPreciosInsumos(
      hoja(fila({ precio: "1.250.000,50", iva: "5%", tipo: "material - m", uM: "und", agrupacion: "020 - 020 - ferreteria menor", unidadUso: "", contenido: null })),
      listas
    )
    expect(r.errores).toEqual([])
    expect(r.filas[0]).toMatchObject({
      vrUnitario: 1250000.5,
      ivaPorcentaje: 5,
      tipo: "MATERIAL - M",
      uM: "UNIDAD - UND",
      agrupacion: "020 - 020 - FERRETERIA MENOR",
      unidadUso: null,
      contenido: null,
    })
  })

  it("reporta cada error con su fila y sigue con las demás", () => {
    const r = leerFilasPreciosInsumos(
      hoja(
        fila({ id: "a", precio: 1 }),
        fila({ id: "b", iva: 16 }),
        fila({ id: "c", tipo: "INSUMO" }),
        fila({ id: "d", uM: "bulto raro" }),
        fila({ id: "e", agrupacion: "999 - INVENTADA" }),
        fila({ id: "f", unidadUso: "KG", contenido: null }),
        fila({ id: "g" }),
        fila({ id: "g" })
      ),
      listas
    )
    expect(r.errores.map((e) => [e.fila, e.mensaje.split(" ")[0]])).toEqual([
      [7, "El"],
      [8, "El"],
      [9, "Elige"],
      [10, "Elige"],
      [11, "Elige"],
      [12, "La"],
      [14, "La"],
    ])
    expect(r.filas.map((f) => f.solicitudId)).toEqual(["g"])
  })

  it("encuentra las columnas aunque se muevan y exige el ID interno", () => {
    const movida = [...encabezado].reverse()
    const filaMovida = [...fila({})].reverse()
    expect(leerFilasPreciosInsumos([movida, filaMovida], listas).filas).toHaveLength(1)
    expect(() => leerFilasPreciosInsumos([[C.insumo, C.precio], ["x", 5]], listas)).toThrow(/ID interno/)
  })
})

describe("Excel de solicitudes: ida y vuelta", () => {
  it("el archivo descargado, llenado y leído como lo lee la app, da las filas", async () => {
    const XLSX = await import("xlsx")
    const { construirLibroPreciosInsumos } = await import("@/lib/excel-precios-insumos")
    const libro = await construirLibroPreciosInsumos(
      [
        { id: "s1", descripcion: "Arena lavada de rio", unidadPedida: "m³", cantidad: 36.5, proyectos: ["MAL"], tipo: null, uM: null, agrupacion: null },
        { id: "s2", descripcion: "Repisa ordinaria 3 m", unidadPedida: "m", cantidad: 37, proyectos: ["MAL"], tipo: "MATERIAL - M", uM: null, agrupacion: null },
      ],
      listas,
      null
    )
    // Quien aprueba llena la primera fila; la segunda queda sin precio.
    const hojaExcel = libro.getWorksheet("Insumos nuevos")!
    let filaEncabezado = 0
    hojaExcel.eachRow((r, n) => {
      if (String(r.getCell(1).value) === C.insumo) filaEncabezado = n
    })
    const primera = hojaExcel.getRow(filaEncabezado + 1)
    expect(primera.getCell(6).value).toBe("METRO CUBICO - M3") // unidad de compra prellenada desde "m³"
    expect(primera.getCell(9).value).toBe(19)
    primera.getCell(5).value = "MATERIAL - M"
    primera.getCell(7).value = "006 - 006 - CONCRETOS Y MORTEROS"
    primera.getCell(8).value = 95000

    const buffer = await libro.xlsx.writeBuffer()
    const leido = XLSX.read(new Uint8Array(buffer as ArrayBuffer), { type: "array" })
    const filas = XLSX.utils.sheet_to_json<unknown[]>(leido.Sheets[leido.SheetNames[0]], { header: 1, defval: null })
    const r = leerFilasPreciosInsumos(filas, listas)
    expect(r.errores).toEqual([])
    expect(r.sinPrecio).toBe(1)
    expect(r.filas).toEqual([
      expect.objectContaining({ solicitudId: "s1", vrUnitario: 95000, ivaPorcentaje: 19, uM: "METRO CUBICO - M3", unidadUso: null }),
    ])
  })
})
