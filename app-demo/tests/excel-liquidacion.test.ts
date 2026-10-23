import { describe, expect, it } from "vitest"
import { COLUMNAS_LIQUIDACION as C, construirLibroLiquidacion, leerFilasLiquidacion } from "@/lib/excel-liquidacion"
import { cuadreLiquidacion, type Pago } from "@/lib/pagos"

const ENCABEZADO = [
  C.item,
  C.valorDocumento,
  C.base,
  C.iva,
  C.retefuente,
  C.reteiva,
  C.reteica,
  C.asumidas,
  C.liquidaciones,
  C.anticipos,
  C.valorAPagar,
  C.sinRetenciones,
  C.comentario,
  C.id,
]
// item, documento, base, iva, rete, reteiva, reteica, asumidas, liquidaciones, anticipos, valor, sin, comentario, id
const fila = (...v: unknown[]) => v

describe("cuadre de la liquidación", () => {
  it("documento − retenciones + asumidas − liquidaciones − anticipos", () => {
    const f = { retefuente: 25000, reteiva: 0, reteica: 4140, asumidas: 0, liquidaciones: 0, anticiposDescuentos: 100000, valorAPagar: 1060860 }
    expect(cuadreLiquidacion(1190000, f)).toEqual({ esperado: 1060860, diferencia: 0 })
    expect(cuadreLiquidacion(1190000, { ...f, valorAPagar: 1000000 }).diferencia).toBe(-60860)
    expect(cuadreLiquidacion(1190000, { ...f, valorAPagar: null }).diferencia).toBeNull()
  })
})

describe("leer el Excel de liquidación", () => {
  const filas = [
    ["Liquidación · Consolidado Bogotá"],
    ENCABEZADO,
    fila(1, 1190000, 1000000, 190000, 25000, null, 4140, null, null, 100000, 1060860, null, null, "p1"), // liquidado
    fila(2, 500000, 500000, 0, null, null, null, null, null, 0, null, null, null, "p2"), // sin tocar
    fila(3, 300000, null, null, null, null, null, null, null, 0, null, "Sí", null, "p3"), // sin retenciones
    fila(4, 200000, null, null, null, null, null, null, null, 0, null, null, "Falta el RUT", "p4"), // observado
    fila(5, 100000, null, null, -5, null, null, null, null, 0, 90000, null, null, "p5"), // negativo
    fila(6, 100000, null, null, "abc", null, null, null, null, 0, 90000, null, null, "p6"), // no es número
    fila(7, 100000, null, null, null, null, null, null, null, 0, 90000, null, null, "p7"), // no cuadra: aviso
    fila(1, 1190000, null, null, null, null, null, null, null, 0, 1000, null, null, "p1"), // repetida
  ]

  it("clasifica cada fila", () => {
    const r = leerFilasLiquidacion(filas)
    expect(r.sinTocar).toBe(1)
    expect(r.filas.map((f) => f.pagoId)).toEqual(["p1", "p3", "p4", "p7"])
    expect(r.filas[0]).toMatchObject({ retefuente: 25000, reteica: 4140, reteiva: null, valorAPagar: 1060860, sinRetenciones: false })
    expect(r.filas[1]).toMatchObject({ sinRetenciones: true, valorAPagar: null })
    expect(r.filas[2]).toMatchObject({ comentario: "Falta el RUT" })
    expect(r.errores.map((e) => [e.fila, e.mensaje.slice(0, 12)])).toEqual([
      [7, `"Retefuente"`],
      [8, `"Retefuente"`],
      [10, "La fila está"],
    ])
    expect(r.avisos.map((a) => a.fila)).toEqual([9])
  })

  it("exige el ID y las columnas de Contabilidad", () => {
    expect(() => leerFilasLiquidacion([["ITEM"], [1]])).toThrow(/ID interno/)
    expect(() => leerFilasLiquidacion([[C.id], ["p1"]])).toThrow(/Faltan las columnas/)
  })
})

describe("el libro de liquidación", () => {
  const pago = {
    id: "11111111-1111-1111-1111-111111111111",
    item: 3,
    semana: 43,
    anio: 2026,
    estado: "aprobado",
    liquidacionEstado: "por_liquidar",
    valor: 1090000,
    valorDocumento: 1190000,
    baseGravable: 1000000,
    iva: 190000,
    descuentoAnticipos: 100000,
    retencionGarantia: 0,
    otrosDescuentos: 0,
    liqBase: null,
    liqIva: null,
    retefuente: null,
    reteiva: null,
    reteica: null,
    asumidas: null,
    liquidaciones: null,
    liqAnticiposDescuentos: null,
    valorAPagar: null,
    ultimoComentario: null,
    empresaNombre: "Conyca Soluciones SAS",
    terceroNombre: "ACERIAS PAZ DEL RIO",
    terceroDocumento: "NIT 860.029.995-1",
    solicitadoPorNombre: "Ana",
    origen: "OC 50",
  } as unknown as Pago

  it("protege la hoja y deja abiertas solo las columnas de Contabilidad", async () => {
    const libro = await construirLibroLiquidacion([pago], { titulo: "Liquidación", origenUrl: "https://app", bufferLogo: null })
    const hoja = libro.getWorksheet("Liquidación")!
    const encabezado = hoja.getRow(6)
    const columna = (titulo: string) => {
      let n = 0
      encabezado.eachCell((c, i) => {
        if (c.value === titulo) n = i
      })
      return n
    }
    const datos = hoja.getRow(7)
    expect(columna(C.id)).toBeGreaterThan(0)
    expect(hoja.getColumn(columna(C.id)).hidden).toBe(true)
    expect(datos.getCell(columna(C.id)).value).toBe(pago.id)
    expect(datos.getCell(columna(C.valorAPagar)).protection?.locked).toBe(false)
    expect(datos.getCell(columna(C.comentario)).protection?.locked).toBe(false)
    expect(datos.getCell(columna(C.factura)).protection?.locked).not.toBe(false)
    expect(datos.getCell(columna(C.anticipos)).value).toBe(100000)
    expect(datos.getCell(columna(C.soporte)).value).toMatchObject({ hyperlink: `https://app/ayf/soporte-pago/${pago.id}` })
    expect((hoja as unknown as { sheetProtection?: { sheet?: boolean } }).sheetProtection?.sheet).toBe(true)
  })
})
