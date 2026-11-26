import { describe, expect, it } from "vitest"
import { PDFDocument } from "pdf-lib"
import { unirPdfs } from "@/lib/unir-pdfs"

async function pdfDe(paginas: number): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  for (let i = 0; i < paginas; i++) d.addPage([300, 400])
  return d.save()
}

describe("unirPdfs (soporte de la caja menor)", () => {
  it("sin anexos devuelve el mismo PDF", async () => {
    const p = await pdfDe(1)
    expect(await unirPdfs(p, [])).toBe(p)
  })

  it("pega las páginas de cada soporte después de la relación, en orden", async () => {
    const relacion = await pdfDe(2)
    const unido = await unirPdfs(relacion, [
      { titulo: "Gasto 1 · Ferretería Ñandú · Fact. F-1 · $ 100.000", bytes: await pdfDe(1) },
      { titulo: "Gasto 2 · Gasolinera 🚗 · Fact. 9", bytes: await pdfDe(3) },
    ])
    const d = await PDFDocument.load(unido)
    expect(d.getPageCount()).toBe(2 + 1 + 3)
  })

  it("un soporte que no es un PDF válido da un error claro", async () => {
    await expect(unirPdfs(await pdfDe(1), [{ titulo: "Gasto 3", bytes: new Uint8Array([1, 2, 3]) }])).rejects.toThrow(/Gasto 3/)
  })
})
