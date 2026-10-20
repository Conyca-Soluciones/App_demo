import { describe, expect, it } from "vitest"
import path from "path"
import { renderToBuffer } from "@react-pdf/renderer"
import {
  EXPEDIDA_PLANTILLA_OTROSI,
  contratoVencido,
  limpiarMinutaOtrosi,
  mapOtrosiDetalle,
  mezclarMinutaOtrosi,
  minutaOtrosiPorDefecto,
  minutaOtrosiVacia,
  nombreArchivoOtrosi,
  origenCampoOtrosi,
  validarSolicitudOtrosi,
} from "@/lib/otrosi"
import { OtrosiPDF } from "@/components/otrosi-pdf"

// Así llega de detalle_otrosi (20261119000000_otrosis.sql).
const fila = (cambios: Record<string, unknown> = {}) => ({
  id: "o1",
  numero: null,
  estado: "por_revisar",
  contrato_id: "c1",
  numero_contrato: "CJ-14-2026",
  contrato_numero: 14,
  tipo: "mano_obra",
  clase: "grupo",
  tipo_detalle: null,
  objeto: "Ejecutar la mampostería.",
  valor: 50_000_000,
  proyecto_id: "p1",
  proyecto_codigo: "P-01",
  proyecto_nombre: "COMFIAR",
  contratista_nombre: "Construcciones Andinas SAS",
  n_modificaciones: 1,
  clausulas: "TERCERA. PLAZO",
  solicitado_por_nombre: "Director",
  created_at: "2026-10-20T15:00:00Z",
  enviado_at: "2026-10-20T15:00:00Z",
  modificaciones: [{ clausula: "TERCERA. PLAZO", redaccion: "El plazo será de ciento veinte (120) días.\nContados desde el acta de inicio." }],
  justificacion: "Lluvias.",
  numero_provisional: 2,
  fecha_fin: "2026-12-15",
  contrato_minuta: null,
  proyecto_ciudad: "Arauca",
  empresa_nombre: "CONYCA SOLUCIONES S.A.S",
  empresa_nit: "900.701.968-7",
  contratista: {
    tipo_persona: "juridica",
    tipo_documento: "NIT",
    numero_documento: "900999101",
    digito_verificacion: 8,
    representante_nombre: "Pedro Pablo Suárez",
    representante_tipo_documento: "CC",
    representante_numero_documento: "80990100",
    cedula_expedida_en: null,
    ciudad: "Bogotá",
  },
  ...cambios,
})

describe("solicitud de otrosí", () => {
  const base = { contratoId: "c1", modificaciones: [{ clausula: "TERCERA. PLAZO", redaccion: "Nuevo plazo." }], justificacion: "Lluvias." }
  it("valida lo mismo que la base", () => {
    expect(validarSolicitudOtrosi(base)).toBeNull()
    expect(validarSolicitudOtrosi({ ...base, contratoId: null })).toBe("Escoge el contrato.")
    expect(validarSolicitudOtrosi({ ...base, modificaciones: [] })).toBe("Agrega al menos una cláusula a modificar.")
    expect(validarSolicitudOtrosi({ ...base, modificaciones: [{ clausula: " ", redaccion: "x" }] })).toMatch(/qué cláusula/)
    expect(validarSolicitudOtrosi({ ...base, modificaciones: [{ clausula: "x", redaccion: "" }] })).toMatch(/cómo queda/)
    expect(validarSolicitudOtrosi({ ...base, justificacion: "  " })).toBe("Escribe por qué se necesita el otrosí.")
    expect(validarSolicitudOtrosi({ ...base, modificaciones: Array.from({ length: 21 }, () => base.modificaciones[0]) })).toMatch(/Máximo 20/)
  })
  it("prórroga: después del fin vigente y de hoy", () => {
    const pr = (nuevaFechaFin: string | null, finVigente: string | null) => ({ ...base, prorroga: { nuevaFechaFin, finVigente, hoy: "2026-10-20" } })
    expect(validarSolicitudOtrosi(pr(null, "2026-12-31"))).toBeNull()
    expect(validarSolicitudOtrosi(pr("2027-01-31", "2026-12-31"))).toBeNull()
    expect(validarSolicitudOtrosi(pr("2026-12-31", "2026-12-31"))).toMatch(/posterior a la vigente/)
    expect(validarSolicitudOtrosi(pr("2026-10-20", null))).toMatch(/posterior a hoy/)
    expect(validarSolicitudOtrosi(pr("2026-11-01", null))).toBeNull()
    expect(validarSolicitudOtrosi(pr("31/12/2026", null))).toMatch(/no es válida/)
  })
  it("vencido: fin antes de hoy; sin fecha no vence", () => {
    expect(contratoVencido("2026-10-19", "2026-10-20")).toBe(true)
    expect(contratoVencido("2026-10-20", "2026-10-20")).toBe(false)
    expect(contratoVencido(null, "2026-10-20")).toBe(false)
  })
})

describe("documento del otrosí", () => {
  const d = mapOtrosiDetalle(fila())
  const m = minutaOtrosiPorDefecto(d, "2026-10-20")

  it("partes desde la empresa del proyecto y el directorio", () => {
    expect(m.contratanteNombre).toBe("CONYCA SOLUCIONES S.A.S")
    expect(m.contratanteRepresentanteExpedida).toBe(EXPEDIDA_PLANTILLA_OTROSI)
    expect(m.contratistaTipoPersona).toBe("juridica")
    expect(m.contratistaNit).toBe("900999101-8")
    expect(m.contratistaRepresentante).toBe("Pedro Pablo Suárez")
    expect(m.contratistaCedula).toBe("80990100")
    expect(m.contratistaCiudad).toBe("Bogotá")
    expect(m.numeroContrato).toBe("CJ-14-2026")
    expect(m.nombreContrato).toBe("contrato de mano de obra")
    expect(m.ciudadFirma).toBe("Arauca")
    expect(m.fechaFirma).toBe("2026-10-20")
    expect(m.modificaciones).toEqual(d.modificaciones)
  })

  it("lo escrito en la minuta aprobada del contrato gana sobre el directorio", () => {
    const conMinuta = minutaOtrosiPorDefecto(
      mapOtrosiDetalle(fila({ contrato_minuta: { contratanteRepresentante: "Ana Gómez", contratanteRepresentanteCedula: "123", contratistaRepresentante: "Pedro P. Suárez", contratistaNit: " " } })),
      "2026-10-20"
    )
    expect(conMinuta.contratanteRepresentante).toBe("Ana Gómez")
    expect(conMinuta.contratanteRepresentanteCedula).toBe("123")
    expect(conMinuta.contratistaRepresentante).toBe("Pedro P. Suárez")
    expect(conMinuta.contratistaNit).toBe("900999101-8")
  })

  it("persona natural: su documento, sin representante", () => {
    const n = minutaOtrosiPorDefecto(
      mapOtrosiDetalle(fila({ contratista: { tipo_persona: "natural", tipo_documento: "CE", numero_documento: "555", representante_nombre: "x" } })),
      "2026-10-20"
    )
    expect(n.contratistaTipoPersona).toBe("natural")
    expect(n.contratistaTipoDocumento).toBe("CE")
    expect(n.contratistaCedula).toBe("555")
    expect(n.contratistaRepresentante).toBe("")
  })

  it("mezclar valida, limpiar quita cláusulas vacías, origen y archivo", () => {
    const r = mezclarMinutaOtrosi(m, { contratistaTipoPersona: "otra", contratistaTipoDocumento: "XX", ciudadFirma: "Bogotá", modificaciones: [{ clausula: "A", redaccion: 3 }, null] })
    expect(r.contratistaTipoPersona).toBe("juridica")
    expect(r.contratistaTipoDocumento).toBe("CC")
    expect(r.ciudadFirma).toBe("Bogotá")
    expect(r.modificaciones).toEqual([{ clausula: "A", redaccion: "3" }])
    expect(mezclarMinutaOtrosi(m, null)).toBe(m)
    expect(limpiarMinutaOtrosi({ ...minutaOtrosiVacia(), modificaciones: [{ clausula: "", redaccion: " " }, { clausula: "B", redaccion: "" }] }).modificaciones).toEqual([
      { clausula: "B", redaccion: "" },
    ])
    expect(origenCampoOtrosi("contratanteRepresentanteExpedida", "Arauca", m)).toBe("plantilla")
    expect(origenCampoOtrosi("ciudadFirma", "Arauca", m)).toBe("solicitud")
    expect(origenCampoOtrosi("ciudadFirma", "Cali", m)).toBe("editado")
    expect(origenCampoOtrosi("contratanteRepresentante", "", m)).toBe("vacio")
    expect(nombreArchivoOtrosi("CJ-14-2026", 2)).toBe("otrosi-2-cj-14-2026.pdf")
  })

  it("el PDF se genera", async () => {
    const logo = path.join(process.cwd(), "public", "logo-conyca.png")
    const pdf = await renderToBuffer(<OtrosiPDF minuta={m} numero={2} logo={logo} foco="modificaciones:0" />)
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
  }, 60000)
})
