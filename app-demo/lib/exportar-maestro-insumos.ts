// Descarga de la Maestra de insumos a Excel: los insumos que se ven con la
// búsqueda y los filtros de la pantalla (todas las páginas), en el orden de la
// tabla y con sus mismas columnas. Mismo formato que el Excel de requisiciones.

import { ZONA_HORARIA } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"

export type InsumoExcel = {
  codigo: number
  descripcion: string
  tipo: string | null
  u_m: string | null
  presentacion: string // la confirmada ("" si no tiene); las sugeridas no van
  agrupacion: string | null
  precioEfectivo: number | null
}

const MONEDA = '"$" #,##0;[Red]-"$" #,##0'

export const COLUMNAS_EXCEL_INSUMOS = [
  { titulo: "Código", ancho: 10 },
  { titulo: "Descripción", ancho: 60 },
  { titulo: "Tipo", ancho: 22 },
  { titulo: "U.M.", ancho: 20 },
  { titulo: "Presentación", ancho: 26 },
  { titulo: "Agrupación", ancho: 34 },
  { titulo: "Valor unitario", ancho: 16, formato: MONEDA },
] as const

export function valoresFilaInsumo(i: InsumoExcel): (string | number | null)[] {
  return [i.codigo, i.descripcion, i.tipo ?? "", i.u_m ?? "", i.presentacion, i.agrupacion ?? "", i.precioEfectivo]
}

export async function descargarExcelMaestroInsumos(insumos: InsumoExcel[]) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Maestra de insumos")
  const n = COLUMNAS_EXCEL_INSUMOS.length

  const primera = agregarEncabezadoMarca(libro, hoja, {
    titulo: "Maestra de insumos",
    numColumnas: n,
    bufferLogo: await obtenerBufferLogoConyca(),
  })

  const encabezado = hoja.getRow(primera)
  COLUMNAS_EXCEL_INSUMOS.forEach((c, i) => {
    hoja.getColumn(i + 1).width = c.ancho
    const celda = encabezado.getCell(i + 1)
    celda.value = c.titulo
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 30

  insumos.forEach((insumo, i) => {
    const fila = hoja.getRow(primera + 1 + i)
    valoresFilaInsumo(insumo).forEach((v, k) => {
      const celda = fila.getCell(k + 1)
      celda.value = v
      const c = COLUMNAS_EXCEL_INSUMOS[k]
      if ("formato" in c) celda.numFmt = c.formato
    })
  })

  // Encabezados fijos al bajar y filtro de Excel sobre la tabla.
  hoja.views = [{ state: "frozen", ySplit: primera }]
  hoja.autoFilter = { from: { row: primera, column: 1 }, to: { row: primera + Math.max(insumos.length, 1), column: n } }

  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `maestra-insumos-${new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
