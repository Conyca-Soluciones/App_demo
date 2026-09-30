import ExcelJS from "exceljs"
import {
  agregarEncabezadoMarca,
  agregarTituloCompacto,
  obtenerBufferLogoConyca,
  AZUL_MARCA_CONYCA,
} from "@/lib/marca-conyca"

/**
 * Genera y descarga un archivo Excel de plantilla con encabezado de marca
 * (logo CONYCA + título) y la tabla de columnas abajo, lista para que el
 * ingeniero la llene y la vuelva a subir. Soporta una hoja principal
 * (ej. "Presupuesto") y hojas adicionales opcionales (ej. "APU") en el
 * MISMO archivo -- reutilizable para cualquier combinación, solo cambian
 * los argumentos, no la lógica.
 *
 * OJO -- esto reemplaza la versión anterior que usaba la librería "xlsx"
 * (sheet_to_json solo con encabezados, sin estilos). Esa librería no
 * soporta imágenes ni relleno de color en su versión gratuita, así que
 * acá se usa "exceljs" (ya es dependencia del proyecto -- ver el mismo
 * patrón en revision-apu-dialog.tsx, handleDescargarExcelTransporte).
 *
 * IMPORTANTE sobre encabezados corridos de fila -- la hoja PRINCIPAL
 * lleva el bloque de marca completo (logo + 4 filas) porque
 * procesarPresupuesto (page.tsx) ahora busca dinámicamente en qué fila
 * están los encabezados en vez de asumir la fila 1 -- ver
 * encontrarFilaEncabezado ahí. Las hojas ADICIONALES (ej. "APU") usan un
 * título compacto de 2 filas en vez del bloque completo, porque ESA
 * hoja la lee un parser aparte (parse-apu-excel.ts) que no tenemos acá
 * para verificar que tolere un offset de filas distinto -- 2 filas
 * (título + blanco, encabezados en fila 3) es EXACTAMENTE el patrón que
 * ya usan los excels reales de la empresa hoy (ver Test-presupuesto.xlsx,
 * hoja APU), así que es el más seguro. Si en algún momento se confirma
 * que ese parser también detecta la fila de encabezado dinámicamente, se
 * puede pasar a agregarEncabezadoMarca ahí también para que se vea igual
 * de completa.
 */

function escribirTablaEnHoja(
  hoja: ExcelJS.Worksheet,
  filaInicio: number,
  columnas: string[],
  filasEjemplo: (string | number)[][]
) {
  const filaEncabezado = hoja.getRow(filaInicio)
  columnas.forEach((nombreCol, i) => {
    const celda = filaEncabezado.getCell(i + 1)
    celda.value = nombreCol
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "left" }
    celda.border = {
      top: { style: "thin", color: { argb: "FFD0D0D0" } },
      bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
      left: { style: "thin", color: { argb: "FFD0D0D0" } },
      right: { style: "thin", color: { argb: "FFD0D0D0" } },
    }
  })
  filaEncabezado.height = 20

  filasEjemplo.forEach((filaValores) => {
    const fila = hoja.addRow(filaValores)
    fila.eachCell((celda) => {
      celda.font = { italic: true, color: { argb: "FF9B9B9B" } }
    })
  })

  columnas.forEach((_, i) => {
    const col = hoja.getColumn(i + 1)
    col.width = i === 0 ? 12 : i === 1 ? 50 : 16
  })

  hoja.views = [{ state: "frozen", ySplit: filaInicio }]
}

export async function exportarPlantillaExcel({
  columnas,
  nombreArchivo,
  nombreHoja = "Plantilla",
  filasEjemplo = [],
  titulo,
  subtitulo,
  hojasAdicionales = [],
}: {
  columnas: string[]
  nombreArchivo: string
  nombreHoja?: string
  filasEjemplo?: (string | number)[][]
  // Título mostrado junto al logo en la hoja principal -- si no se pasa,
  // usa el nombre de hoja.
  titulo?: string
  subtitulo?: string
  // Hojas extra en el MISMO archivo (ej. "APU") -- cada una con título
  // compacto (sin logo, ver comentario arriba) y su propia tabla.
  hojasAdicionales?: {
    nombreHoja: string
    titulo: string
    columnas: string[]
    filasEjemplo?: (string | number)[][]
  }[]
}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "CONYCA Soluciones SAS"

  // ---------- Hoja principal (bloque de marca completo, con logo) ----------
  const hoja = workbook.addWorksheet(nombreHoja)
  const bufferLogo = await obtenerBufferLogoConyca()
  const filaInicioTabla = agregarEncabezadoMarca(workbook, hoja, {
    titulo: titulo ?? nombreHoja,
    subtitulo,
    numColumnas: columnas.length,
    bufferLogo,
  })
  escribirTablaEnHoja(hoja, filaInicioTabla, columnas, filasEjemplo)

  // ---------- Hojas adicionales (título compacto, sin logo) ----------
  for (const extra of hojasAdicionales) {
    const hojaExtra = workbook.addWorksheet(extra.nombreHoja)
    const filaInicioExtra = agregarTituloCompacto(hojaExtra, {
      titulo: extra.titulo,
      numColumnas: extra.columnas.length,
    })
    escribirTablaEnHoja(hojaExtra, filaInicioExtra, extra.columnas, extra.filasEjemplo ?? [])
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
}