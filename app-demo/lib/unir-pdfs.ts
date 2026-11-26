import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

// Une PDF en uno solo: el soporte de la caja menor es la relación de gastos
// (con las firmas y los soportes en imagen) seguida de los soportes en PDF de
// cada gasto, en el orden de la tabla (20270101007700). Cada página pegada lleva
// arriba una marca con el gasto al que pertenece. Sin anexos devuelve el mismo PDF.

// La fuente estándar de los PDF solo escribe caracteres latinos (WinAnsi).
const textoLatino = (t: string) =>
  t
    .normalize("NFC")
    .replace(/[^\x20-\x7E -ÿ]/g, "?")
    .slice(0, 140)

export async function unirPdfs(principal: Uint8Array, anexos: { titulo: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
  if (anexos.length === 0) return principal
  const salida = await PDFDocument.load(principal)
  const fuente = await salida.embedFont(StandardFonts.Helvetica)
  for (const anexo of anexos) {
    let origen: PDFDocument
    try {
      origen = await PDFDocument.load(anexo.bytes, { ignoreEncryption: true })
    } catch {
      throw new Error(`No se pudo leer el PDF del soporte (${anexo.titulo}): vuelve a subirlo como PDF o imagen.`)
    }
    const paginas = await salida.copyPages(origen, origen.getPageIndices())
    const marca = textoLatino(`Soporte · ${anexo.titulo}`)
    for (const pagina of paginas) {
      salida.addPage(pagina)
      const { height } = pagina.getSize()
      const ancho = fuente.widthOfTextAtSize(marca, 8)
      pagina.drawRectangle({ x: 14, y: height - 22, width: ancho + 10, height: 14, color: rgb(1, 1, 1), opacity: 0.85 })
      pagina.drawText(marca, { x: 19, y: height - 18, size: 8, font: fuente, color: rgb(0.24, 0.44, 0.63) })
    }
  }
  return salida.save()
}
