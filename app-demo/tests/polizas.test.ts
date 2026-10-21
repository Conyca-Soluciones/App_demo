import { describe, expect, it } from "vitest"
import { mapContratoPoliza, mapPoliza, motivoSinActasPorPoliza, rutaArchivoPoliza, validarArchivoPoliza } from "@/lib/polizas"

describe("archivo de la póliza", () => {
  it("PDF, JPG o PNG hasta 10 MB", () => {
    expect(validarArchivoPoliza({ name: "poliza.pdf", size: 1000, type: "application/pdf" })).toBeNull()
    expect(validarArchivoPoliza({ name: "poliza.png", size: 1000, type: "image/png" })).toBeNull()
    expect(validarArchivoPoliza({ name: "poliza.docx", size: 1000, type: "application/msword" })).toMatch(/PDF, JPG o PNG/)
    expect(validarArchivoPoliza({ name: "poliza.pdf", size: 10 * 1024 * 1024 + 1, type: "application/pdf" })).toMatch(/10 MB/)
    expect(validarArchivoPoliza({ name: "poliza.pdf", size: 0, type: "application/pdf" })).toMatch(/vacío/)
  })
  it("ruta: carpeta del contrato y extensión limpia", () => {
    expect(rutaArchivoPoliza("c1", "Póliza Final.PDF", 123)).toBe("c1/123.pdf")
    expect(rutaArchivoPoliza("c1", "sin-extension", 5)).toBe("c1/5.pdf")
  })
})

describe("actas según la póliza", () => {
  it("solo con póliza aprobada", () => {
    expect(motivoSinActasPorPoliza("aprobada")).toBeNull()
    expect(motivoSinActasPorPoliza("recibida")).toMatch(/revisión de Jurídica/)
    expect(motivoSinActasPorPoliza("pendiente")).toMatch(/Falta la póliza/)
    expect(motivoSinActasPorPoliza(null)).toMatch(/Falta la póliza/)
  })
})

describe("lectura", () => {
  it("contrato y póliza desde el jsonb de la base", () => {
    const c = mapContratoPoliza({
      id: "c1", numero: 14, numero_contrato: "CJ-14-2026", clase: "grupo", tipo: "mano_obra", objeto: "Ejecutar",
      valor: "2650000.00", poliza_estado: "recibida", fecha_fin: "2026-12-31",
      contratista: { id: "k1", nombre: "Andinas", tipo_persona: "juridica", documento: "NIT 900-8" },
    })
    expect(c.valor).toBe(2_650_000)
    expect(c.polizaEstado).toBe("recibida")
    expect(c.contratista.nombre).toBe("Andinas")
    expect(mapContratoPoliza({ poliza_estado: "otra" }).polizaEstado).toBeNull()
    const p = mapPoliza({ id: "p1", estado: "devuelta", motivo: "Falta amparo", tamano: "100" })
    expect(p.estado).toBe("devuelta")
    expect(p.tamano).toBe(100)
    expect(mapPoliza({ estado: "x" }).estado).toBe("por_revisar")
  })
})
