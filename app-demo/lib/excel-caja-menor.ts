// Plantilla de Excel de la legalización de caja menor (formato de control
// GF-F-016): se descarga, se llena y se sube; cada fila es un gasto. Los
// soportes se adjuntan después en la pantalla. La lectura (leerFilasCajaMenor)
// es lógica pura en lib/caja-menor.ts.

import { hoyColombia } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"
import {
  COLUMNAS_CAJA_MENOR,
  MAX_GASTOS_CAJA_MENOR,
  ORDEN_COLUMNAS_CAJA_MENOR,
  codigoListaProyectoCaja,
  type ProyectoCajaMenor,
} from "@/lib/caja-menor"

export async function construirPlantillaCajaMenor(proyectos: ProyectoCajaMenor[], bufferLogo: ArrayBuffer | null) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Caja menor")
  const n = ORDEN_COLUMNAS_CAJA_MENOR.length

  const primera = agregarEncabezadoMarca(libro, hoja, { titulo: "Legalización de caja menor (GF-F-016)", numColumnas: n, bufferLogo })

  const hojaListas = libro.addWorksheet("Listas", { state: "veryHidden" })
  proyectos.forEach((p, r) => (hojaListas.getRow(r + 1).getCell(1).value = codigoListaProyectoCaja(p)))
  const listaProyectos = `Listas!$A$1:$A$${Math.max(proyectos.length, 1)}`

  ORDEN_COLUMNAS_CAJA_MENOR.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  ORDEN_COLUMNAS_CAJA_MENOR.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = COLUMNAS_CAJA_MENOR[c.clave]
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 30

  for (let k = 0; k < MAX_GASTOS_CAJA_MENOR; k++) {
    const fila = hoja.getRow(primera + 1 + k)
    ORDEN_COLUMNAS_CAJA_MENOR.forEach((c, i) => {
      const celda = fila.getCell(i + 1)
      if (c.clave === "proyecto") celda.dataValidation = { type: "list", allowBlank: true, formulae: [listaProyectos] }
      if (c.clave === "fecha") celda.numFmt = "dd/mm/yyyy"
      if (c.clave === "valor") celda.numFmt = "#,##0.00"
      if (c.clave === "documento" || c.clave === "factura") celda.numFmt = "@"
    })
  }
  hoja.views = [{ state: "frozen", ySplit: primera }]
  return libro
}

export async function descargarPlantillaCajaMenor(proyectos: ProyectoCajaMenor[]) {
  const libro = await construirPlantillaCajaMenor(proyectos, await obtenerBufferLogoConyca())
  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `caja-menor-${hoyColombia()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
