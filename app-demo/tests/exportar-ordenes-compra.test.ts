import { describe, expect, it } from "vitest"
import {
  COLUMNAS_EXCEL_DETALLADA,
  COLUMNAS_EXCEL_RESUMIDA,
  filasExcelOrdenes,
  type OrdenExcel,
} from "@/lib/exportar-ordenes-compra"

const linea = (codigo: number, total: number) => ({
  insumoCodigo: codigo,
  insumoDescripcion: `INSUMO ${codigo}`,
  um: "UND",
  cantidad: 2,
  precioUnitario: total / 2,
  porcentajeDescuento: 0,
  porcentajeIva: 19,
  total,
})

const orden = (cambios: Partial<OrdenExcel> = {}): OrdenExcel => ({
  numero: 45,
  estadoVisible: "aprobada",
  proyectoCodigo: "P-01",
  proyectoNombre: "Obra",
  proveedorNombre: "Ferretería",
  creadaPorNombre: "Ana",
  createdAt: "2026-10-02T15:00:00Z",
  valorTotal: 300,
  lineas: [linea(1, 100), linea(2, 200)],
  ...cambios,
})

describe("Excel de órdenes de compra", () => {
  it("resumida: una fila por orden con su valor total al final", () => {
    const filas = filasExcelOrdenes([orden(), orden({ numero: 44, valorTotal: 50, lineas: [] })], "resumida")
    expect(filas).toHaveLength(2)
    expect(filas[0]).toHaveLength(COLUMNAS_EXCEL_RESUMIDA.length)
    expect(filas[0].slice(0, 4)).toEqual([45, "P-01 — Obra", "Ferretería", "Aprobada"])
    expect(filas[0].at(-1)).toBe(300)
    expect(filas[1].at(-1)).toBe(50)
  })

  it("detallada: una fila por insumo, con los datos de su orden en cada una", () => {
    const filas = filasExcelOrdenes([orden(), orden({ numero: 46, estadoVisible: "cancelada", lineas: [linea(3, 10)] })], "detallada")
    expect(filas).toHaveLength(3)
    for (const f of filas) expect(f).toHaveLength(COLUMNAS_EXCEL_DETALLADA.length)
    expect(filas.map((f) => [f[0], f[6], f.at(-1)])).toEqual([
      [45, "1 - INSUMO 1", 100],
      [45, "2 - INSUMO 2", 200],
      [46, "3 - INSUMO 3", 10],
    ])
    expect(filas[2][3]).toBe("Cancelada")
  })

  it("detallada: una orden sin insumos sale una vez, sin datos de insumo", () => {
    const [f] = filasExcelOrdenes([orden({ lineas: [] })], "detallada")
    expect(f.slice(0, 1)).toEqual([45])
    expect(f.slice(6)).toEqual([null, null, null, null, null, null, null])
  })

  it("la fecha es el día en Colombia (no se corre por la zona horaria)", () => {
    // 2 a. m. UTC del 3 = 9 p. m. del 2 en Colombia.
    const [f] = filasExcelOrdenes([orden({ createdAt: "2026-10-03T02:00:00Z" })], "resumida")
    expect((f[5] as Date).toISOString().slice(0, 10)).toBe("2026-10-02")
  })
})
