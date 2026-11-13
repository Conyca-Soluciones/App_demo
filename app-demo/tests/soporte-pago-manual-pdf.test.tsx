import { describe, expect, it } from "vitest"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import { SoporteDispersorPDF, nombreSoportePagoManual } from "@/components/soporte-dispersor-pdf"
import type { Tanda } from "@/lib/dispersores/generador"

// Soporte de un pago marcado como pagado por PSE (20270101003200): mismo PDF del
// dispersor con otro título, la línea de datos y notas.
describe("soporte de pago sin dispersor", () => {
  it("genera un PDF de una página con su nombre", async () => {
    const tanda: Tanda = {
      cuenta: {
        apodo: "BOGOTA CONYCA CTE",
        diminutivo: "BOG_CONYCA",
        banco: "BANCO DE BOGOTA",
        tipoCuenta: "CORRIENTE",
        cuenta: "123456789",
        nit: "900123456",
        dv: "1",
        razonSocial: "CONYCA SOLUCIONES SAS",
        correoItau: "",
      },
      renglones: [
        {
          item: "001-00012",
          documento: "",
          tipoDoc: "",
          dv: "",
          nombre: "JUAN PEREZ (CC 123)",
          nombres: "",
          apellidos: "",
          bancoDestino: "PSE",
          tipoCuenta: "",
          cuenta: "—",
          valor: 1250000,
          referencia: "001-00012",
          empresa: "CONYCA SOLUCIONES SAS",
          proyecto: "001-900-CS-YOP-MALECON",
        },
      ],
      semana: 46,
      clasePago: "PROVEEDORES",
      secuencia: "",
      fecha: "20261113",
      esNomina: false,
      truncado: "",
    }
    const nombre = nombreSoportePagoManual(tanda, "001-00012", "PSE")
    expect(nombre).toBe("BOG_CONYCA_SEM46_REF001-00012_soporte_PSE.pdf")
    const logo = readFileSync(path.join(process.cwd(), "public", "logo-conyca.png"))
    const pdf = await renderToBuffer(
      createElement(SoporteDispersorPDF, {
        tanda,
        archivos: [],
        logo,
        titulo: "Soporte de Pago por PSE",
        meta: "Medio de pago: PSE  ·  Pagado el 13/11/2026",
        notas: ["Información para el pago: pagar en el portal del proveedor"],
      }) as never
    )
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
    if (process.env.SOPORTE_PDF_SALIDA) writeFileSync(process.env.SOPORTE_PDF_SALIDA, pdf)
  }, 30000)
})
