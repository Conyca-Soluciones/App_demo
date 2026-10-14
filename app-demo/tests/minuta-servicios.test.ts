import { describe, expect, it } from "vitest"
import type { SolicitudContratoDetalle } from "@/lib/contratos"
import { CONTRATANTE_POR_DEFECTO, type DatosExtraMinuta } from "@/lib/minuta-mano-obra"
import {
  OBLIGACIONES_GENERALES_SERVICIOS,
  limpiarMinutaServicios,
  mezclarMinutaServicios,
  minutaServiciosPorDefecto,
  minutaServiciosVacia,
  nombreArchivoMinutaServicios,
  origenCampoServicios,
  servicioDesdeObjeto,
} from "@/lib/minuta-servicios"

const detalle = (cambios: Partial<SolicitudContratoDetalle> = {}): SolicitudContratoDetalle => ({
  id: "c1",
  numero: 51,
  proyectoId: "p1",
  proyectoCodigo: "P-01",
  proyectoNombre: "COMFIAR",
  tipo: "prestacion_servicios",
  estado: "pre_aprobacion",
  contratistaNombre: "Luz Marina Rodríguez Ortiz",
  contratistaDocumento: "CC 79990103",
  objeto: "Prestar los servicios profesionales como ingeniera residente de obra.",
  valor: 18_000_000,
  plazoTipo: "fechas",
  fechaInicio: "2026-11-01",
  fechaFin: "2027-02-01",
  duracionCantidad: null,
  duracionUnidad: null,
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
  contratistaId: "k1",
  contratistaCorreo: "a@b.co",
  contratistaTipoPersona: "natural",
  contratistaDocumentos: [],
  anexoTipo: "valor_global",
  valorMensual: 6_000_000,
  tieneAnticipo: false,
  anticipoPorcentaje: null,
  formaPago: "Contra informe mensual aprobado.",
  correoNotificacion: "luz@correo.co",
  observaciones: null,
  domicilioDepartamento: null,
  datosTipo: {},
  obligaciones: ["Llevar la bitácora de obra", "N/A"],
  entregables: ["Informe mensual de avance", "No aplica"],
  items: [],
  documentos: [],
  ...cambios,
})

const extra: DatosExtraMinuta = {
  proyectoCiudad: "Arauca",
  empresaNombre: null,
  empresaNit: null,
  contratistaTipoDocumento: "CC",
  contratistaNumeroDocumento: "79990103",
  contratistaDv: null,
  contratistaRepresentante: null,
  contratistaRepresentanteDocumento: null,
  contratistaCiudad: "Bucaramanga",
}

describe("minutaServiciosPorDefecto", () => {
  const m = minutaServiciosPorDefecto(detalle(), extra, "2026-10-13")

  it("partes: persona natural con su cédula", () => {
    expect(m.contratanteNombre).toBe(CONTRATANTE_POR_DEFECTO.nombre)
    expect(m.contratistaTipoPersona).toBe("natural")
    expect(m.contratistaNombre).toBe("Luz Marina Rodríguez Ortiz")
    expect(m.contratistaTipoDocumento).toBe("CC")
    expect(m.contratistaCedula).toBe("79990103")
    expect(m.contratistaNit).toBe("")
    expect(m.contratistaCorreo).toBe("luz@correo.co")
  })

  it("servicio sin el verbo, proyecto, plazo e inicio", () => {
    expect(m.servicio).toBe("ingeniera residente de obra")
    expect(m.obra).toBe("COMFIAR")
    expect(m.plazo).toBe("tres (3) meses")
    expect(m.fechaInicio).toBe("2026-11-01")
  })

  it("valor y forma de pago con el valor mensual", () => {
    expect(m.valor).toBe("18.000.000")
    expect(m.valorLetras).toMatch(/^DIECIOCHO MILLONES DE PESOS/)
    expect(m.formaPago).toBe("mensual, en pagos de SEIS MILLONES DE PESOS ($6.000.000) M/CTE. Contra informe mensual aprobado.")
    const ant = minutaServiciosPorDefecto(detalle({ tieneAnticipo: true, anticipoPorcentaje: 10, valorMensual: null, formaPago: "" }), extra, "2026-10-13")
    expect(ant.formaPago).toMatch(/^Se entregará un anticipo del diez por ciento \(10 %\)/)
  })

  it("específicas: obligaciones y entregables de la solicitud, sin N/A", () => {
    expect(m.obligacionesEspecificas).toEqual(["Llevar la bitácora de obra", "Entregar: Informe mensual de avance."])
    expect(m.obligacionesGenerales).toEqual(OBLIGACIONES_GENERALES_SERVICIOS)
  })

  it("lugar, domicilio y cláusula penal", () => {
    expect(m.municipioEjecucion).toBe("Arauca")
    expect(m.domicilioCiudad).toBe("Arauca")
    expect(m.departamentoEjecucion).toBe("")
    expect(m.clausulaPenalPorcentaje).toBe("20")
  })

  it("persona jurídica: NIT y representante", () => {
    const j = minutaServiciosPorDefecto(
      detalle({ contratistaTipoPersona: "juridica", contratistaNombre: "Asesorías SAS" }),
      { ...extra, contratistaTipoDocumento: "NIT", contratistaNumeroDocumento: "900999104", contratistaDv: 1, contratistaRepresentante: "Sandra Torres", contratistaRepresentanteDocumento: "80990103", contratistaRepresentanteTipoDocumento: "CE" },
      "2026-10-13"
    )
    expect(j.contratistaNit).toBe("900999104-1")
    expect(j.contratistaRepresentante).toBe("Sandra Torres")
    expect(j.contratistaTipoDocumento).toBe("CE")
    expect(j.contratistaCedula).toBe("80990103")
  })
})

it("servicioDesdeObjeto", () => {
  expect(servicioDesdeObjeto("Prestar servicios como topógrafo.")).toBe("topógrafo")
  expect(servicioDesdeObjeto("Prestar sus servicios profesionales de asesoría ambiental")).toBe("asesoría ambiental")
  expect(servicioDesdeObjeto("Asesorar el diseño estructural")).toBe("asesorar el diseño estructural")
})

describe("mezclar, limpiar y origen", () => {
  const d = minutaServiciosPorDefecto(detalle(), extra, "2026-10-13")
  it("lo guardado gana y se valida", () => {
    const r = mezclarMinutaServicios(d, { servicio: "topógrafo", contratistaTipoPersona: "otra", obligacionesEspecificas: ["a", 3] })
    expect(r.servicio).toBe("topógrafo")
    expect(r.contratistaTipoPersona).toBe("natural")
    expect(r.obligacionesEspecificas).toEqual(["a", "3"])
  })
  it("limpiar quita renglones vacíos", () => {
    expect(limpiarMinutaServicios({ ...minutaServiciosVacia(), obligacionesEspecificas: [" ", " x "] }).obligacionesEspecificas).toEqual(["x"])
  })
  it("origen y archivo", () => {
    expect(origenCampoServicios("clausulaPenalPorcentaje", "20", d)).toBe("plantilla")
    expect(origenCampoServicios("servicio", d.servicio, d)).toBe("solicitud")
    expect(origenCampoServicios("departamentoEjecucion", "", d)).toBe("vacio")
    expect(nombreArchivoMinutaServicios(51, "Luz Marina Rodríguez Ortiz")).toBe("minuta-servicios-51-luz-marina-rodriguez-ortiz.pdf")
  })
})

describe("datos nuevos de la solicitud y del contratista", () => {
  it("departamento (lugar de ejecución) y cédula expedida en", () => {
    const m = minutaServiciosPorDefecto(detalle({ domicilioDepartamento: "Arauca" }), { ...extra, contratistaCedulaExpedida: "Bucaramanga" }, "2026-10-13")
    expect(m.departamentoEjecucion).toBe("Arauca")
    expect(m.contratistaCedulaExpedida).toBe("Bucaramanga")
  })
})
