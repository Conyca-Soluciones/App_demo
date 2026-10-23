import { describe, expect, it } from "vitest"
import { esDocumentoContratista, tipoPersonaDeTercero, validarContratista, type DatosContratista } from "@/lib/contratistas"

const base: DatosContratista = {
  terceroId: "t1",
  tipoPersona: "natural",
  representanteNombre: "",
  representanteTipoDocumento: "",
  representanteNumeroDocumento: "",
  cedulaExpedidaEn: " Bogotá ",
  correo: " Obras@Contratista.co ",
  telefono: "300 123 4567",
  direccion: "Calle 1",
  ciudad: "Bogotá",
}

describe("Contratista enlazado al tercero", () => {
  it("exige el tercero (nombre y documento salen de él)", () => {
    const r = validarContratista({ ...base, terceroId: "" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.terceroId).toMatch(/documento/)
  })
  it("limpia contacto y no pide datos bancarios", () => {
    const r = validarContratista(base)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.datos.correo).toBe("obras@contratista.co")
      expect(r.datos.telefono).toBe("3001234567")
    }
  })
  it("jurídica pide representante legal", () => {
    const r = validarContratista({ ...base, tipoPersona: "juridica" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.representanteNombre).toBeTruthy()
  })
  it("tipo de persona y documentos válidos según el tercero", () => {
    expect(tipoPersonaDeTercero("NIT")).toBe("juridica")
    expect(tipoPersonaDeTercero("CC")).toBe("natural")
    expect(esDocumentoContratista("PPT")).toBe(true)
    expect(esDocumentoContratista("TI")).toBe(false)
  })
})
