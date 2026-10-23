// Descarga del Inventario de bodega a Excel: los insumos que se ven con el
// filtro de la pantalla, en el orden de la tabla y con sus mismas columnas, más
// el valor total en bodega al final. Mismo formato que el Excel de
// requisiciones. El inventario ya viene completo al navegador
// (inventario_proyecto_completo), así que no hay que volver a consultar.

import { ZONA_HORARIA } from "@/lib/fechas"
import { formatoCantidadExcel } from "@/lib/exportar-requisiciones"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"

// Mismos campos que InsumoInventario (inventario/actions.ts); se repiten aquí
// para no importar nada de un archivo "use server".
export type FilaExcelInventario = {
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  cantidadEntrada: number
  cantidadSalida: number
  cantidadDisponible: number
  costoPromedio: number
  valorInventario: number
}

const MONEDA = '"$" #,##0;[Red]-"$" #,##0'

export const COLUMNAS_EXCEL_INVENTARIO = [
  { titulo: "Código", ancho: 10 },
  { titulo: "Insumo", ancho: 56 },
  { titulo: "UM", ancho: 20 },
  { titulo: "Entradas", ancho: 13, cantidad: true },
  { titulo: "Salidas", ancho: 13, cantidad: true },
  { titulo: "Disponible", ancho: 13, cantidad: true },
  { titulo: "Costo promedio", ancho: 16, formato: MONEDA },
  { titulo: "Valor en bodega", ancho: 18, formato: MONEDA },
] as const

export function valoresFilaInventario(i: FilaExcelInventario): (string | number)[] {
  return [
    i.insumoCodigo,
    i.insumoDescripcion,
    i.insumoUm ?? "",
    i.cantidadEntrada,
    i.cantidadSalida,
    i.cantidadDisponible,
    i.costoPromedio,
    i.valorInventario,
  ]
}

export async function descargarExcelInventario(
  filas: FilaExcelInventario[],
  proyecto: { codigo: string | null; nombre: string }
) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Inventario")
  const n = COLUMNAS_EXCEL_INVENTARIO.length

  const primera = agregarEncabezadoMarca(libro, hoja, {
    titulo: `Inventario — ${proyecto.codigo ? `${proyecto.codigo} ${proyecto.nombre}` : proyecto.nombre}`,
    numColumnas: n,
    bufferLogo: await obtenerBufferLogoConyca(),
  })

  const encabezado = hoja.getRow(primera)
  COLUMNAS_EXCEL_INVENTARIO.forEach((c, i) => {
    hoja.getColumn(i + 1).width = c.ancho
    const celda = encabezado.getCell(i + 1)
    celda.value = c.titulo
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 30

  filas.forEach((insumo, i) => {
    const fila = hoja.getRow(primera + 1 + i)
    valoresFilaInventario(insumo).forEach((v, k) => {
      const celda = fila.getCell(k + 1)
      celda.value = v
      const c = COLUMNAS_EXCEL_INVENTARIO[k]
      if ("formato" in c) celda.numFmt = c.formato
      if ("cantidad" in c) celda.numFmt = formatoCantidadExcel(v as number)
    })
  })

  // Total en bodega, como debajo de la tabla en pantalla.
  const total = hoja.getRow(primera + 1 + filas.length)
  total.getCell(n - 1).value = "Valor total en bodega"
  total.getCell(n).value = filas.reduce((acc, i) => acc + i.valorInventario, 0)
  total.getCell(n).numFmt = MONEDA
  total.font = { bold: true }

  // Encabezados fijos al bajar y filtro de Excel sobre la tabla (sin el total).
  hoja.views = [{ state: "frozen", ySplit: primera }]
  hoja.autoFilter = { from: { row: primera, column: 1 }, to: { row: primera + Math.max(filas.length, 1), column: n } }

  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  const fecha = new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })
  a.download = `inventario-${proyecto.codigo ? `${proyecto.codigo}-` : ""}${fecha}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
