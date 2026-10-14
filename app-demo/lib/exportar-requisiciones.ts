// Descarga del Registro de requisiciones a Excel: una fila por insumo de cada
// requisición que cumple los filtros de la consulta (exportarRequisiciones en
// almacen/actions.ts trae TODAS, no solo la página en pantalla).

import type { EstadoRequisicion } from "@/lib/requisiciones-lineas"
import { ZONA_HORARIA } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"

export type FilaExcelRequisicion = {
  numero: number
  proyecto: string
  solicitadoPor: string
  insumoCodigo: number | null
  insumo: string
  unidad: string
  cantidad: number
  fechaRequisicion: string // timestamptz
  fechaRequerida: string | null // AAAA-MM-DD
  estado: EstadoRequisicion
}

export const ETIQUETA_ESTADO_EXCEL: Record<EstadoRequisicion, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
}

export const COLUMNAS_EXCEL_REQUISICIONES = [
  { titulo: "N° requisición", ancho: 14 },
  { titulo: "Proyecto", ancho: 34 },
  { titulo: "Solicitado por", ancho: 24 },
  { titulo: "Insumo solicitado", ancho: 48 },
  { titulo: "Unidad", ancho: 14 },
  { titulo: "Cantidad solicitada", ancho: 14 },
  { titulo: "Fecha de requisición", ancho: 14 },
  { titulo: "Fecha requerida", ancho: 14 },
  { titulo: "Estado", ancho: 12 },
] as const

// "AAAA-MM-DD" -> fecha de Excel (a medianoche UTC: Excel no tiene zona
// horaria y así el día no se corre).
function fechaExcel(ymd: string): Date {
  const [a, m, d] = ymd.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}

// Día en Colombia de un timestamptz, como "AAAA-MM-DD".
export const diaColombia = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })

// Valores de cada fila en el orden de COLUMNAS_EXCEL_REQUISICIONES.
export function valoresFilaExcel(f: FilaExcelRequisicion): (string | number | Date | null)[] {
  return [
    f.numero,
    f.proyecto,
    f.solicitadoPor,
    f.insumoCodigo != null ? `${f.insumoCodigo} - ${f.insumo}` : f.insumo,
    f.unidad,
    f.cantidad,
    fechaExcel(diaColombia(f.fechaRequisicion)),
    f.fechaRequerida ? fechaExcel(f.fechaRequerida) : null,
    ETIQUETA_ESTADO_EXCEL[f.estado],
  ]
}

export async function descargarExcelRequisiciones(filas: FilaExcelRequisicion[], descripcionFiltros: string) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Requisiciones")
  const n = COLUMNAS_EXCEL_REQUISICIONES.length

  const primera = agregarEncabezadoMarca(libro, hoja, {
    titulo: "Registro de requisiciones",
    subtitulo: descripcionFiltros,
    numColumnas: n,
    bufferLogo: await obtenerBufferLogoConyca(),
  })

  COLUMNAS_EXCEL_REQUISICIONES.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  COLUMNAS_EXCEL_REQUISICIONES.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = c.titulo
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 30

  filas.forEach((f, i) => {
    const fila = hoja.getRow(primera + 1 + i)
    valoresFilaExcel(f).forEach((v, k) => (fila.getCell(k + 1).value = v))
  })
  hoja.getColumn(6).numFmt = "#,##0.##"
  hoja.getColumn(7).numFmt = "dd/mm/yyyy"
  hoja.getColumn(8).numFmt = "dd/mm/yyyy"

  // Encabezados fijos al bajar y filtro de Excel sobre la tabla.
  hoja.views = [{ state: "frozen", ySplit: primera }]
  hoja.autoFilter = { from: { row: primera, column: 1 }, to: { row: primera + Math.max(filas.length, 1), column: n } }

  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `requisiciones-${new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
