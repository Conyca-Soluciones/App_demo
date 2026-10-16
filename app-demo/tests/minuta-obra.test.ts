import { describe, expect, it } from "vitest"
import type { SolicitudContratoDetalle } from "@/lib/contratos"
import { CONTRATANTE_POR_DEFECTO, type DatosExtraMinuta } from "@/lib/minuta-mano-obra"
import {
  AMPAROS_OBRA,
  AMPARO_ANTICIPO_OBRA,
  DOMICILIO_PLANTILLA_OBRA,
  OBLIGACIONES_ESPECIFICAS_OBRA,
  limpiarMinutaObra,
  mezclarMinutaObra,
  minutaObraPorDefecto,
  minutaObraVacia,
  nombreArchivoMinutaObra,
  origenCampoObra,
} from "@/lib/minuta-obra"

const detalle = (cambios: Partial<SolicitudContratoDetalle> = {}): SolicitudContratoDetalle => ({
  id: "c1",
  numero: 61,
  proyectoId: "p1",
  proyectoCodigo: "P-01",
  proyectoNombre: "COMFIAR",
  tipo: "obra",
  estado: "pre_aprobacion",
  contratistaNombre: "Construcciones Andinas SAS",
  contratistaDocumento: "NIT 900999101-8",
  objeto: "Ejecutar a todo costo la cubierta de la bodega.",
  valor: 50_000_000,
  plazoTipo: "duracion",
  fechaInicio: null,
  fechaFin: null,
  duracionCantidad: 90,
  duracionUnidad: "dias",
  solicitadoPorNombre: "Director",
  createdAt: "",
  enviadoAt: "",
  motivoResolucion: null,
  resueltoPorNombre: null,
  resueltoAt: null,
  minutaEstado: null,
  minutaEnviadaAt: null,
  minutaEnviadaPorNombre: null,
  minutaResueltaAt: null,
  minutaResueltaPorNombre: null,
  minutaMotivo: null,
  numeroContrato: null,
  clase: "grupo",
  tipoDetalle: null,
  referencia: null,
  retencionGarantiaPct: 0,
  retencionAnticipoPct: 0,
  retencionFicPct: 0,
  liquidadoAt: null,
  contratistaId: "k1",
  contratistaCorreo: "a@b.co",
  contratistaTipoPersona: "juridica",
  contratistaDocumentos: [],
  anexoTipo: "valores_unitarios",
  valorMensual: null,
  tieneAnticipo: true,
  anticipoPorcentaje: 30,
  formaPago: "Actas quincenales.",
  correoNotificacion: "obras@andinas.co",
  observaciones: null,
  domicilioDepartamento: null,
  datosTipo: {},
  obligaciones: ["Instalar la línea de vida", "N/A"],
  entregables: ["Plano récord de la cubierta"],
  items: [{ presupuestoItemId: "i1", codigo: "9.1", actividad: "Cubierta termoacústica", unidad: "m2", cantidad: 500, valorUnitario: 100_000 }],
  documentos: [],
  ...cambios,
})

const extra: DatosExtraMinuta = {
  proyectoCiudad: "Arauca",
  empresaNombre: null,
  empresaNit: null,
  contratistaTipoDocumento: "NIT",
  contratistaNumeroDocumento: "900999101",
  contratistaDv: 8,
  contratistaRepresentante: "Pedro Pablo Suárez",
  contratistaRepresentanteDocumento: "80990100",
  contratistaRepresentanteTipoDocumento: "CC",
  contratistaCiudad: "Bogotá",
}

describe("minutaObraPorDefecto", () => {
  const m = minutaObraPorDefecto(detalle(), extra, "2026-10-13")

  it("partes desde la empresa y el directorio", () => {
    expect(m.contratanteNombre).toBe(CONTRATANTE_POR_DEFECTO.nombre)
    expect(m.contratistaNit).toBe("900999101-8")
    expect(m.contratistaRepresentante).toBe("Pedro Pablo Suárez")
    expect(m.contratistaCedula).toBe("80990100")
    expect(m.contratistaCorreo).toBe("obras@andinas.co")
  })

  it("proyecto, plazo, valor y anexo", () => {
    expect(m.obra).toBe("COMFIAR")
    expect(m.plazo).toBe("noventa (90) días")
    expect(m.valor).toBe("50.000.000")
    expect(m.valorLetras).toMatch(/^CINCUENTA MILLONES DE PESOS/)
    expect(m.items).toEqual([{ actividad: "9.1 Cubierta termoacústica", unidad: "m2", cantidad: "500", valorUnitario: "100.000" }])
    const global = minutaObraPorDefecto(detalle({ items: [], anexoTipo: "valor_global" }), extra, "2026-10-13")
    expect(global.items).toEqual([{ actividad: "Ejecutar a todo costo la cubierta de la bodega", unidad: "GL", cantidad: "1", valorUnitario: "50.000.000" }])
  })

  it("anticipo: porcentaje, monto, letras y amortización; vacío sin anticipo", () => {
    expect(m.anticipoPorcentaje).toBe("30")
    expect(m.anticipo).toBe("15.000.000")
    expect(m.anticipoLetras).toMatch(/^QUINCE MILLONES DE PESOS/)
    expect(m.amortizacion).toBe("30%")
    expect(m.amparos).toEqual([AMPARO_ANTICIPO_OBRA, ...AMPAROS_OBRA])
    const sin = minutaObraPorDefecto(detalle({ tieneAnticipo: false, anticipoPorcentaje: null }), extra, "2026-10-13")
    expect(sin.anticipoPorcentaje).toBe("")
    expect(sin.anticipo).toBe("")
    expect(sin.amortizacion).toBe("")
    expect(sin.amparos).toEqual(AMPAROS_OBRA)
  })

  it("específicas: plantilla + obligaciones + entregables de la solicitud", () => {
    expect(m.obligacionesEspecificas).toEqual([...OBLIGACIONES_ESPECIFICAS_OBRA, "Instalar la línea de vida", "Entregar: Plano récord de la cubierta."])
    expect(OBLIGACIONES_ESPECIFICAS_OBRA).toHaveLength(17)
  })

  it("domicilio de la plantilla, municipio del proyecto, departamento de firma vacío", () => {
    expect(m.domicilioDepartamento).toBe(DOMICILIO_PLANTILLA_OBRA)
    expect(m.municipioEjecucion).toBe("Arauca")
    expect(m.departamentoFirma).toBe("")
    expect(m.condicionesPago).toBe("Actas quincenales.")
  })

  it("plazo por fechas en días", () => {
    const f = minutaObraPorDefecto(
      detalle({ plazoTipo: "fechas", fechaInicio: "2026-11-01", fechaFin: "2026-12-31", duracionCantidad: null, duracionUnidad: null }),
      extra,
      "2026-10-13"
    )
    expect(f.plazo).toBe("sesenta (60) días")
  })
})

describe("mezclar, limpiar y origen", () => {
  const d = minutaObraPorDefecto(detalle(), extra, "2026-10-13")
  it("lo guardado gana y se valida", () => {
    const r = mezclarMinutaObra(d, { retencionGarantia: "5%", items: [{ actividad: "x", cantidad: 2 }], contratistaTipoDocumento: "NIT" })
    expect(r.retencionGarantia).toBe("5%")
    expect(r.items).toEqual([{ actividad: "x", unidad: "", cantidad: "2", valorUnitario: "" }])
    expect(r.contratistaTipoDocumento).toBe("CC")
  })
  it("limpiar quita filas vacías", () => {
    const l = limpiarMinutaObra({ ...minutaObraVacia(), items: [{ actividad: "", unidad: "m", cantidad: "", valorUnitario: "" }], obligacionesEspecificas: ["", "a"] })
    expect(l.items).toEqual([])
    expect(l.obligacionesEspecificas).toEqual(["a"])
  })
  it("origen y archivo", () => {
    expect(origenCampoObra("domicilioDepartamento", "Arauca", d)).toBe("plantilla")
    expect(origenCampoObra("obra", "COMFIAR", d)).toBe("solicitud")
    expect(origenCampoObra("periodicidadPago", "", d)).toBe("vacio")
    expect(nombreArchivoMinutaObra(61, "Construcciones Andinas SAS")).toBe("minuta-obra-61-construcciones-andinas-sas.pdf")
  })
})

describe("datos de la solicitud para la minuta de obra", () => {
  it("pago cada X días, retención en garantía y departamento", () => {
    const m = minutaObraPorDefecto(
      detalle({ domicilioDepartamento: "Arauca", datosTipo: { pagoCadaDias: 15, retencionGarantia: true, retencionPorcentaje: 5 } }),
      extra,
      "2026-10-13"
    )
    expect(m.periodicidadPago).toBe("quince (15) días")
    expect(m.retencion).toBe("si")
    expect(m.retencionGarantia).toBe("5%")
    expect(m.domicilioDepartamento).toBe("Arauca")
    expect(m.departamentoFirma).toBe("Arauca")
    const sin = minutaObraPorDefecto(detalle({ datosTipo: { pagoCadaDias: 30, retencionGarantia: false } }), extra, "2026-10-13")
    expect(sin.retencion).toBe("no")
    expect(sin.retencionGarantia).toBe("")
    expect(mezclarMinutaObra(sin, { retencion: "tal vez" }).retencion).toBe("no")
  })
})
