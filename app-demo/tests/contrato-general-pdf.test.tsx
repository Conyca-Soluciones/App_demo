import { describe, expect, it } from "vitest"
import path from "path"
import { renderToBuffer } from "@react-pdf/renderer"
import { ContratoGeneralPDF } from "@/components/contrato-general-pdf"
import { armarHojaContratoGeneral, type FilaHojaContratoGeneral } from "@/lib/contrato-general-hoja"

const LOGO = path.join(process.cwd(), "public", "logo-conyca.png")

describe("PDF del contrato general", () => {
  it("se genera una hoja con observaciones largas", async () => {
    const fila: FilaHojaContratoGeneral = {
      numero: 3,
      numero_contrato: "CJ-3-2026",
      tipo: "obra",
      estado: "aprobada",
      minuta_estado: "aprobada",
      valor: 1500000,
      fecha_inicio: "2026-01-01",
      fecha_fin: "2026-03-01",
      forma_pago: "Quincenal",
      retencion_garantia_pct: 5,
      retencion_anticipo_pct: 0,
      retencion_fic_pct: 0,
      referencia: null,
      objeto: "Obra de prueba",
      observaciones: "Detalle. ".repeat(300),
      enviado_at: "2026-01-01T12:00:00Z",
      resuelto_at: "2026-01-02T12:00:00Z",
      minuta_resuelta_at: "2026-01-03T12:00:00Z",
      solicitante: { nombre: "Director" },
      resolutor: { nombre: "Jurídica" },
      minuta_resolutor: { nombre: "Subgerencia" },
      proyecto: { codigo: "P1", nombre: "Proyecto", ciudad: "Bogotá", empresa: { nit: "900", razon_social: "Empresa" } },
      contratista: { nombre: "Contratista", tipo_documento: "CC", numero_documento: "1", digito_verificacion: null, direccion: null, telefono: null, correo: null, ciudad: null },
    }
    const pdf = await renderToBuffer(<ContratoGeneralPDF hoja={armarHojaContratoGeneral(fila, new Date())} logo={LOGO} />)
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
    expect(pdf.length).toBeGreaterThan(5000)
  })
})
