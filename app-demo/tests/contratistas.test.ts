import { describe, expect, it } from "vitest"
import {
  DOCUMENTOS_POR_PERSONA,
  documentoQuitable,
  esDocumentoContratista,
  extensionArchivo,
  rutaDocumentoNuevo,
  tipoPersonaDeTercero,
  validarContratista,
  type DatosContratista,
} from "@/lib/contratistas"

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

describe("documentos del contratista (20270101007100)", () => {
  const id = "11111111-2222-3333-4444-555555555555"

  it("la certificación bancaria ya no es documento del contratista", () => {
    for (const lista of Object.values(DOCUMENTOS_POR_PERSONA)) {
      expect(lista.some((d) => d.tipo === "certificacion_bancaria")).toBe(false)
    }
  })

  it("solo se quitan los opcionales", () => {
    expect(documentoQuitable("natural", "hoja_vida")).toBe(true)
    expect(documentoQuitable("natural", "cedula")).toBe(false)
    expect(documentoQuitable("juridica", "rut")).toBe(false)
    expect(documentoQuitable("juridica", "hoja_vida")).toBe(false)
    expect(documentoQuitable("natural", "certificacion_bancaria")).toBe(false)
  })

  it("extensión del nombre, o del tipo si el nombre no la trae", () => {
    expect(extensionArchivo("RUT 2026.PDF", "application/pdf")).toBe("pdf")
    expect(extensionArchivo("foto", "image/png")).toBe("png")
    expect(extensionArchivo("foto", "image/jpeg")).toBe("jpg")
    expect(extensionArchivo("archivo.final.jpeg", "image/jpeg")).toBe("jpeg")
  })

  it("con la misma extensión sobrescribe en la misma ruta", () => {
    expect(rutaDocumentoNuevo(id, "rut", "pdf", `${id}/rut-ab12cd34.pdf`, "nueva000")).toEqual({
      ruta: `${id}/rut-ab12cd34.pdf`,
      sobrescribe: true,
    })
    expect(rutaDocumentoNuevo(id, "rut", "PDF", `${id}/rut-ab12cd34.pdf`, "nueva000").sobrescribe).toBe(true)
  })

  it("con otra extensión, sin documento o con una ruta ajena va a una ruta nueva", () => {
    const nueva = { ruta: `${id}/rut-nueva000.jpg`, sobrescribe: false }
    expect(rutaDocumentoNuevo(id, "rut", "jpg", `${id}/rut-ab12cd34.pdf`, "nueva000")).toEqual(nueva)
    expect(rutaDocumentoNuevo(id, "rut", "jpg", null, "nueva000")).toEqual(nueva)
    expect(rutaDocumentoNuevo(id, "rut", "jpg", `otro/rut-ab12cd34.jpg`, "nueva000")).toEqual(nueva)
  })

  it("nunca sobrescribe una certificación bancaria", () => {
    expect(rutaDocumentoNuevo(id, "rut", "pdf", `${id}/certificacion_bancaria-ab12cd34.pdf`, "x1").sobrescribe).toBe(false)
  })
})
