import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import { RelacionCajaMenorPDF } from "@/components/relacion-caja-menor-pdf"
import { mapLegalizacionDetalle } from "@/lib/caja-menor"

// PNG de 1x1 (para la firma y para un soporte en imagen).
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

describe("RelacionCajaMenorPDF", () => {
  it("genera el PDF de la relación de gastos", async () => {
    const detalle = mapLegalizacionDetalle({
      id: "l1", codigo: "CM-007-0001", estado: "por_aprobar", n_gastos: 2, valor_total: 230000.5, caja_monto: 3000000,
      responsable_nombre: "Inge", empresa_nombre: "CONYCA SAS", proyecto_codigo: "MALECON", enviada_en: "2026-11-26T15:00:00Z",
      revisada_por_nombre: "Fina", revisada_en: "2026-11-26T16:00:00Z",
      gastos: Array.from({ length: 2 }, (_, i) => ({
        id: `g${i}`, orden: i + 1, fecha: "2026-11-20", proyecto_codigo: "MALECON", numero_factura: `F-${i}`, documento: "900123456-7",
        nombre: "Ferretería", concepto: "Tornillos", destino: "Obra", valor: 115000.25, soporte: { ruta: "u/a.pdf", nombre: "a.pdf" },
      })),
      caja: { id: "c1", numero: 3, monto: 3000000, responsable_nombre: "Inge", tercero_nombre: "INGE", tercero_documento: "CC 1",
              cuenta_texto: "BANCOLOMBIA · Ahorros · 1234", empresa_nombre: "CONYCA SAS", proyecto_nombre: "Malecón" },
    })
    const pdf = await renderToBuffer(
      createElement(RelacionCajaMenorPDF, { detalle, logo: null, generado: "26/11/2026", aprobadoPor: "Lider" }) as never
    )
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
    expect(pdf.length).toBeGreaterThan(1000)

    // Con firmas y un soporte en imagen: una página más por el soporte.
    const conTodo = await renderToBuffer(
      createElement(RelacionCajaMenorPDF, {
        detalle,
        logo: null,
        generado: "26/11/2026",
        aprobadoPor: "Lider",
        firmas: [
          { papel: "responsable", nombre: "Inge", fecha: "2026-11-26T15:00:00Z", imagen: `data:image/png;base64,${PNG}` },
          { papel: "aprobador", nombre: "Lider", fecha: null, imagen: null },
        ],
        anexos: [{ titulo: "Gasto 1 · Ferretería", imagen: Buffer.from(PNG, "base64") }],
      }) as never
    )
    const paginas = (b: Buffer) => (b.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(paginas(conTodo)).toBe(paginas(pdf) + 1)
  })
})
