import { describe, expect, it } from "vitest"
import { armarHojaContratoGeneral, nombreArchivoContratoGeneral, type FilaHojaContratoGeneral } from "@/lib/contrato-general-hoja"
import { CONTRATO_GENERAL_VACIO, validarContratoGeneral } from "@/lib/contratos"

const fila: FilaHojaContratoGeneral = {
  numero: 21,
  numero_contrato: null,
  tipo: "prestacion_servicios",
  estado: "pre_aprobacion",
  minuta_estado: null,
  valor: "17340500",
  fecha_inicio: "2025-07-10",
  fecha_fin: "2025-09-10",
  forma_pago: "Semanal",
  retencion_garantia_pct: "0",
  retencion_anticipo_pct: 0,
  retencion_fic_pct: "2.5",
  referencia: "4",
  objeto: "Realización de visitas de categorización",
  observaciones: null,
  enviado_at: "2025-07-15T13:55:00Z",
  resuelto_at: "2026-02-25T14:51:00Z",
  minuta_resuelta_at: null,
  solicitante: { nombre: "Marcela" },
  resolutor: { nombre: "Diana" },
  minuta_resolutor: null,
  proyecto: { codigo: "100-I-MED", nombre: "Casas", ciudad: "Medellín", empresa: { nit: "900701968", razon_social: "CONYCA SOLUCIONES SAS" } },
  contratista: {
    nombre: "Valeria Castillo",
    tipo_documento: "CC",
    numero_documento: "1066188216",
    digito_verificacion: null,
    direccion: "CL 40",
    telefono: "301",
    correo: "v@x.co",
    ciudad: "Medellín",
  },
}

describe("hoja del contrato general", () => {
  it("sin aprobar: número de solicitud y sin pre-aprobación ni aprobación", () => {
    const h = armarHojaContratoGeneral(fila, new Date("2026-10-15T15:00:00Z"))
    expect(h.numero).toBe("Solicitud N° 21")
    expect(h.fechaInicio).toBe("10/07/2025")
    expect(h.retencionFic).toBe("2,5 %")
    expect(h.elaboro?.nombre).toBe("Marcela")
    expect(h.preaprobo).toBeNull() // resuelto_por de una devuelta no cuenta
    expect(h.aprobo).toBeNull()
    expect(h.estado).toBe("Por revisar")
  })

  it("aprobada por Subgerencia: número CJ y las tres firmas", () => {
    const h = armarHojaContratoGeneral(
      { ...fila, estado: "aprobada", minuta_estado: "aprobada", numero_contrato: "CJ-21-2026", minuta_resolutor: { nombre: "Luis" }, minuta_resuelta_at: "2026-02-25T17:00:00Z" },
      new Date()
    )
    expect(h.numero).toBe("CJ-21-2026")
    expect(h.preaprobo?.nombre).toBe("Diana")
    expect(h.aprobo?.nombre).toBe("Luis")
    expect(h.estado).toBe("Aprobado por Subgerencia")
  })

  it("NIT con dígito de verificación", () => {
    const h = armarHojaContratoGeneral({ ...fila, contratista: { ...fila.contratista!, tipo_documento: "NIT", numero_documento: "900", digito_verificacion: "1" } }, new Date())
    expect(h.contratista.documento).toBe("900-1")
  })

  it("nombre de archivo sin caracteres raros", () => {
    expect(nombreArchivoContratoGeneral("CJ-1-2026", "A/B: C")).toBe("Contrato general CJ-1-2026 - A B C.pdf")
  })
})

describe("validarContratoGeneral", () => {
  const lleno = {
    ...CONTRATO_GENERAL_VACIO,
    tipo: "obra" as const,
    contratistaId: "k",
    objeto: "Realización de visitas",
    valor: "17.340.500",
    fechaInicio: "2025-07-10",
    fechaFin: "2025-09-10",
    formaPago: "Semanal",
    correoNotificacion: "A@B.CO",
  }

  it("acepta un contrato completo y la descripción no necesita verbo", () => {
    const r = validarContratoGeneral(lleno)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.datos.valor).toBe(17340500)
      expect(r.datos.correoNotificacion).toBe("a@b.co")
      expect(r.datos.retencionGarantiaPct).toBe(0)
    }
  })

  it("rechaza fechas al revés y retenciones fuera de rango", () => {
    const r = validarContratoGeneral({ ...lleno, fechaFin: "2025-07-01", retencionFicPct: "150" })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errores.plazo).toBeTruthy()
      expect(r.errores.retencionFicPct).toBeTruthy()
    }
  })
})
