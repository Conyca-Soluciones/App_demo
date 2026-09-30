import type ExcelJS from "exceljs"

/**
 * Helper de marca compartido entre exportar-plantilla.ts (plantilla que
 * se sube a la app) y el export real de page.tsx (handleExportar --
 * MATRIZ + APU final, que NUNCA se vuelve a leer por la app). Un solo
 * lugar para el logo/colores/layout de encabezado, así los dos no se
 * desincronizan con el tiempo.
 */

export const RUTA_LOGO_CONYCA = "/logo-conyca.png"
export const AZUL_MARCA_CONYCA = "FF4070A1"
export const GRIS_TEXTO_CONYCA = "FF363435"

// El logo no cambia durante la sesión del usuario -- se cachea en
// memoria para no repetir el fetch si se generan varias hojas/archivos
// en la misma llamada (ej. MATRIZ + APU del mismo export).
let bufferLogoCache: ArrayBuffer | null | undefined // undefined = todavía no se pidió

export async function obtenerBufferLogoConyca(): Promise<ArrayBuffer | null> {
  if (bufferLogoCache !== undefined) return bufferLogoCache
  try {
    const res = await fetch(RUTA_LOGO_CONYCA)
    bufferLogoCache = res.ok ? await res.arrayBuffer() : null
  } catch {
    // Si el logo no está disponible (ej. /public no lo tiene todavía),
    // el archivo se genera igual, solo que sin logo -- mejor eso que un
    // botón roto.
    bufferLogoCache = null
  }
  return bufferLogoCache
}

const FILAS_BLOQUE_MARCA = 4

/**
 * Bloque de marca COMPLETO: logo + título + subtítulo, en 4 filas + 1
 * de espacio. Úsalo en hojas que la app NUNCA vuelve a leer (o donde
 * tú mismo controlas el parser y ya lo hiciste tolerante a esto, como
 * la hoja "Presupuesto" de la plantilla -- ver encontrarFilaEncabezado
 * en page.tsx).
 *
 * Debe llamarse ANTES de escribir cualquier otra fila en la hoja
 * (antes del `addRow` de datos, y antes de fijar `.columns` con
 * `header` -- ese sí escribe directo en la fila 1 y pisaría esto).
 *
 * Devuelve el número de la primera fila libre después del bloque, para
 * que el llamador sepa dónde seguir escribiendo.
 */
export function agregarEncabezadoMarca(
  workbook: ExcelJS.Workbook,
  hoja: ExcelJS.Worksheet,
  opciones: {
    titulo: string
    subtitulo?: string
    numColumnas: number
    bufferLogo: ArrayBuffer | null
  }
): number {
  const { titulo, subtitulo, numColumnas, bufferLogo } = opciones
  const numColumnasFinal = Math.max(numColumnas, 4)
  const ultimaColLetra = hoja.getColumn(numColumnasFinal).letter

  hoja.mergeCells(`A1:B${FILAS_BLOQUE_MARCA}`)
  hoja.mergeCells(`C1:${ultimaColLetra}2`)
  if (subtitulo) hoja.mergeCells(`C3:${ultimaColLetra}${FILAS_BLOQUE_MARCA}`)

  for (let f = 1; f <= FILAS_BLOQUE_MARCA; f++) hoja.getRow(f).height = 20

  const celdaTitulo = hoja.getCell("C1")
  celdaTitulo.value = titulo
  celdaTitulo.font = { bold: true, size: 14, color: { argb: GRIS_TEXTO_CONYCA } }
  celdaTitulo.alignment = { vertical: "bottom", horizontal: "left", wrapText: true }

  if (subtitulo) {
    const celdaSubtitulo = hoja.getCell("C3")
    celdaSubtitulo.value = subtitulo
    celdaSubtitulo.font = { italic: true, size: 9, color: { argb: "FF6B6B6B" } }
    celdaSubtitulo.alignment = { vertical: "top", horizontal: "left", wrapText: true }
  }

  if (bufferLogo) {
    const idImagen = workbook.addImage({ buffer: bufferLogo, extension: "png" })
    // Proporción real del logo (676x189).
    const alto = 62
    const ancho = Math.round(alto * (676 / 189))
    hoja.addImage(idImagen, {
      tl: { col: 0.15, row: 0.3 },
      ext: { width: ancho, height: alto },
    })
  }

  hoja.getRow(FILAS_BLOQUE_MARCA + 1).height = 6 // fila espaciadora
  return FILAS_BLOQUE_MARCA + 2 // primera fila libre real
}

/**
 * Título COMPACTO de una sola fila (sin logo, sin merges grandes):
 * fila 1 = título con estilo, fila 2 = espaciadora en blanco. Total 2
 * filas antes de los encabezados reales -- EXACTAMENTE el patrón que ya
 * usa hoy la hoja "APU" en los excels reales de la empresa (título en
 * fila 1, encabezados en fila 3, ver Test-presupuesto.xlsx). Úsalo en
 * cualquier hoja que SÍ se vuelva a subir a la app y cuyo parser no
 * controles/no hayas verificado que tolera un bloque de marca más
 * grande -- como la hoja "APU" de la plantilla de import.
 */
export function agregarTituloCompacto(
  hoja: ExcelJS.Worksheet,
  opciones: { titulo: string; numColumnas: number }
): number {
  const { titulo, numColumnas } = opciones
  const numColumnasFinal = Math.max(numColumnas, 2)
  const ultimaColLetra = hoja.getColumn(numColumnasFinal).letter

  hoja.mergeCells(`A1:${ultimaColLetra}1`)
  const celdaTitulo = hoja.getCell("A1")
  celdaTitulo.value = titulo
  celdaTitulo.font = { bold: true, size: 12, color: { argb: AZUL_MARCA_CONYCA } }
  hoja.getRow(1).height = 20
  hoja.getRow(2).height = 8 // fila espaciadora -- fila 2 en blanco, igual que el excel real

  return 3 // primera fila libre real (los encabezados van en fila 3)
}