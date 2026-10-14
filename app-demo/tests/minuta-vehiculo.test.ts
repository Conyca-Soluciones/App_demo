import { describe, expect, it } from "vitest"
import type { SolicitudContratoDetalle } from "@/lib/contratos"
import { CONTRATANTE_POR_DEFECTO, type DatosExtraMinuta } from "@/lib/minuta-mano-obra"
import {
  AMPAROS_VEHICULO,
  AMPARO_ANTICIPO_VEHICULO,
  DOMICILIO_PLANTILLA,
  OBLIGACIONES_ESPECIFICAS_VEHICULO,
  bienDesdeObjeto,
  limpiarMinutaVehiculo,
  mezclarMinutaVehiculo,
  minutaVehiculoPorDefecto,
  minutaVehiculoVacia,
  nombreArchivoMinutaVehiculo,
  obligacionOferta,
  origenCampoVehiculo,
} from "@/lib/minuta-vehiculo"

const detalle = (cambios: Partial<SolicitudContratoDetalle> = {}): SolicitudContratoDetalle => ({
  id: "c1",
  numero: 41,
  proyectoId: "p1",
  proyectoCodigo: "P-01",
  proyectoNombre: "COMFIAR",
  tipo: "alquiler_vehiculo",
  estado: "pre_aprobacion",
  contratistaNombre: "Maquinaria Pesada del Norte SAS",
  contratistaDocumento: "NIT 900999105-7",
  objeto: "Alquilar una retroexcavadora 320 con operador.",
  valor: 36_000_000,
  plazoTipo: "duracion",
  fechaInicio: null,
  fechaFin: null,
  duracionCantidad: 3,
  duracionUnidad: "meses",
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
  contratistaId: "k1",
  contratistaCorreo: "a@b.co",
  contratistaTipoPersona: "juridica",
  contratistaDocumentos: [],
  anexoTipo: "valor_global",
  valorMensual: 12_000_000,
  tieneAnticipo: true,
  anticipoPorcentaje: 20,
  formaPago: "Actas mensuales.",
  correoNotificacion: "alquiler@maquinaria.co",
  observaciones: null,
  domicilioDepartamento: null,
  datosTipo: {},
  obligaciones: ["Llevar la máquina a la obra", "No aplica"],
  entregables: [],
  items: [],
  documentos: [],
  ...cambios,
})

const extra: DatosExtraMinuta = {
  proyectoCiudad: "Arauca",
  empresaNombre: null,
  empresaNit: null,
  contratistaTipoDocumento: "NIT",
  contratistaNumeroDocumento: "900999105",
  contratistaDv: 7,
  contratistaRepresentante: "Hernán Ospina",
  contratistaRepresentanteDocumento: "80990104",
  contratistaRepresentanteTipoDocumento: "CC",
  contratistaCiudad: "Barranquilla",
}

describe("minutaVehiculoPorDefecto", () => {
  const m = minutaVehiculoPorDefecto(detalle(), extra, "2026-10-13")

  it("partes desde la empresa y el directorio", () => {
    expect(m.contratanteNombre).toBe(CONTRATANTE_POR_DEFECTO.nombre)
    expect(m.contratistaNit).toBe("900999105-7")
    expect(m.contratistaRepresentante).toBe("Hernán Ospina")
    expect(m.contratistaCedula).toBe("80990104")
    expect(m.contratistaCorreo).toBe("alquiler@maquinaria.co")
  })

  it("objeto, periodo, valor y detalle", () => {
    expect(m.bien).toBe("una retroexcavadora 320 con operador")
    expect(m.obra).toBe("COMFIAR")
    expect(m.periodo).toBe("tres (3) meses")
    expect(m.valor).toBe("36.000.000")
    expect(m.detalleValor).toBe("un valor mensual de DOCE MILLONES DE PESOS M/CTE ($12.000.000).")
    expect(m.condicionesPago).toBe("Actas mensuales.")
  })

  it("anticipo = porcentaje del valor, en número y letras; vacío si no hay", () => {
    expect(m.anticipo).toBe("7.200.000")
    expect(m.anticipoLetras).toMatch(/^SIETE MILLONES DOSCIENTOS MIL PESOS/)
    const sin = minutaVehiculoPorDefecto(detalle({ tieneAnticipo: false, anticipoPorcentaje: null }), extra, "2026-10-13")
    expect(sin.anticipo).toBe("")
    expect(sin.anticipoLetras).toBe("")
    expect(sin.amparos).toEqual(AMPAROS_VEHICULO)
  })

  it("amparos con anticipo, garantía por elegir y domicilio de la plantilla", () => {
    expect(m.amparos).toEqual([AMPARO_ANTICIPO_VEHICULO, ...AMPAROS_VEHICULO])
    expect(m.garantia).toBe("")
    expect(m.domicilio).toBe(DOMICILIO_PLANTILLA)
    expect(m.ciudadEjecucion).toBe("Arauca")
  })

  it("obligaciones específicas: plantilla más las de la solicitud; la de la oferta aparte", () => {
    expect(m.obligacionesEspecificas).toEqual([...OBLIGACIONES_ESPECIFICAS_VEHICULO, "Llevar la máquina a la obra"])
    expect(obligacionOferta("OM-77")).toContain("Oferta Mercantil No. OM-77 que")
    expect(obligacionOferta(" ")).toContain("No. __________")
  })

  it("detalle del valor con valores unitarios", () => {
    const u = minutaVehiculoPorDefecto(
      detalle({ valorMensual: null, items: [{ presupuestoItemId: "i", codigo: "2.1", actividad: "Hora máquina", unidad: "h", cantidad: 200, valorUnitario: 180_000 }] }),
      extra,
      "2026-10-13"
    )
    expect(u.detalleValor).toBe("2.1 Hora máquina: 200 h a $180.000 cada uno.")
  })

  it("periodo por fechas", () => {
    const f = minutaVehiculoPorDefecto(
      detalle({ plazoTipo: "fechas", fechaInicio: "2026-11-01", fechaFin: "2027-01-01", duracionCantidad: null, duracionUnidad: null }),
      extra,
      "2026-10-13"
    )
    expect(f.periodo).toBe("dos (2) meses")
  })
})

describe("mezclar y limpiar", () => {
  const defecto = minutaVehiculoPorDefecto(detalle(), extra, "2026-10-13")
  it("lo guardado gana; valida la garantía y el tipo de documento", () => {
    const r = mezclarMinutaVehiculo(defecto, { garantia: "exige", ofertaMercantil: "OM-1", contratistaTipoDocumento: "X", amparos: "no" })
    expect(r.garantia).toBe("exige")
    expect(r.ofertaMercantil).toBe("OM-1")
    expect(r.contratistaTipoDocumento).toBe("CC")
    expect(r.amparos).toEqual(defecto.amparos)
    expect(mezclarMinutaVehiculo(defecto, { garantia: "tal vez" }).garantia).toBe("")
  })
  it("limpiar quita renglones vacíos", () => {
    const l = limpiarMinutaVehiculo({ ...minutaVehiculoVacia(), obligacionesGenerales: ["", " a "], amparos: [{ amparo: "", porcentaje: "", vigencia: "" }] })
    expect(l.obligacionesGenerales).toEqual(["a"])
    expect(l.amparos).toEqual([])
  })
})

it("origen y nombre del archivo", () => {
  const d = minutaVehiculoPorDefecto(detalle(), extra, "2026-10-13")
  expect(origenCampoVehiculo("domicilio", DOMICILIO_PLANTILLA, d)).toBe("plantilla")
  expect(origenCampoVehiculo("bien", d.bien, d)).toBe("solicitud")
  expect(origenCampoVehiculo("ofertaMercantil", "", d)).toBe("vacio")
  expect(nombreArchivoMinutaVehiculo(41, "Maquinaria Pesada del Norte SAS")).toBe("minuta-alquiler-41-maquinaria-pesada-del-norte-sas.pdf")
})

it("bienDesdeObjeto quita el verbo inicial", () => {
  expect(bienDesdeObjeto("Alquilar una volqueta doble troque.")).toBe("una volqueta doble troque")
  expect(bienDesdeObjeto("Contratar el alquiler de un minicargador")).toBe("un minicargador")
  expect(bienDesdeObjeto("Retroexcavadora 320")).toBe("Retroexcavadora 320")
})

describe("datos de la solicitud para la minuta de alquiler", () => {
  it("nombre corto, actas, garantías y departamento", () => {
    const m = minutaVehiculoPorDefecto(
      detalle({ domicilioDepartamento: "Arauca", datosTipo: { bienNombre: "retroexcavadora", actas: "quincenales", exigeGarantia: false } }),
      extra,
      "2026-10-13"
    )
    expect(m.bienNombre).toBe("retroexcavadora")
    expect(m.periodicidadPago).toBe("quincenales")
    expect(m.garantia).toBe("no_exige")
    expect(m.domicilio).toBe("Arauca – Arauca")
    expect(m.departamentoEjecucion).toBe("Arauca")
    expect(minutaVehiculoPorDefecto(detalle({ datosTipo: { exigeGarantia: true } }), extra, "2026-10-13").garantia).toBe("exige")
  })
})
