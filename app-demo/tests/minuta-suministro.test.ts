import { describe, expect, it } from "vitest"
import type { SolicitudContratoDetalle } from "@/lib/contratos"
import { CONTRATANTE_POR_DEFECTO, type DatosExtraMinuta } from "@/lib/minuta-mano-obra"
import {
  AMPAROS_PLANTILLA,
  AMPARO_ANTICIPO,
  OBLIGACIONES_CONTRATISTA_SUMINISTRO,
  PAGO_PERIODICO,
  limpiarMinutaSuministro,
  mezclarMinutaSuministro,
  minutaSuministroPorDefecto,
  minutaSuministroVacia,
  nombreArchivoMinutaSuministro,
  origenCampoSuministro,
  textoAnticipo,
} from "@/lib/minuta-suministro"

const detalle = (cambios: Partial<SolicitudContratoDetalle> = {}): SolicitudContratoDetalle => ({
  id: "c1",
  numero: 31,
  proyectoId: "p1",
  proyectoCodigo: "P-01",
  proyectoNombre: "Edificio Altos",
  tipo: "suministro_instalacion",
  estado: "pre_aprobacion",
  contratistaNombre: "Vidrios del Norte S.A.S",
  contratistaDocumento: "NIT 900999103-2",
  objeto: "Suministrar e instalar la ventanería del bloque 2.",
  valor: 10_000_000,
  plazoTipo: "duracion",
  fechaInicio: null,
  fechaFin: null,
  duracionCantidad: 30,
  duracionUnidad: "dias",
  solicitadoPorNombre: "Director",
  createdAt: "",
  enviadoAt: "",
  motivoResolucion: null,
  resueltoPorNombre: null,
  resueltoAt: null,
  contratistaId: "k1",
  contratistaCorreo: "a@b.co",
  contratistaTipoPersona: "juridica",
  contratistaDocumentos: [],
  anexoTipo: "valores_unitarios",
  valorMensual: null,
  tieneAnticipo: true,
  anticipoPorcentaje: 30,
  formaPago: "Contra entrega de cada piso.",
  correoNotificacion: "ventas@vidrios.co",
  observaciones: null,
  obligaciones: ["Retirar los sobrantes", "N/A"],
  entregables: [],
  items: [{ presupuestoItemId: "i1", codigo: "8.2", actividad: "Ventana corrediza", unidad: "m2", cantidad: 40, valorUnitario: 250_000 }],
  documentos: [],
  ...cambios,
})

const extra: DatosExtraMinuta = {
  proyectoCiudad: "Arauca",
  empresaNombre: null,
  empresaNit: null,
  contratistaTipoDocumento: "NIT",
  contratistaNumeroDocumento: "900999103",
  contratistaDv: 2,
  contratistaRepresentante: "Ricardo Gómez",
  contratistaRepresentanteDocumento: "80990102",
  contratistaRepresentanteTipoDocumento: "CC",
  contratistaCiudad: "Cúcuta",
}

describe("minutaSuministroPorDefecto", () => {
  const m = minutaSuministroPorDefecto(detalle(), extra, "2026-10-08")

  it("partes: empresa del proyecto contratante y contratista del directorio", () => {
    expect(m.contratanteNombre).toBe(CONTRATANTE_POR_DEFECTO.nombre)
    expect(m.contratistaNit).toBe("900999103-2")
    expect(m.contratistaRepresentante).toBe("Ricardo Gómez")
    expect(m.contratistaCedula).toBe("80990102")
    expect(m.contratistaTipoDocumento).toBe("CC")
    expect(m.contratistaCiudad).toBe("Cúcuta")
    expect(m.contratistaCorreo).toBe("ventas@vidrios.co")
  })

  it("objeto, proyecto y tabla desde la solicitud", () => {
    expect(m.objeto).toBe("Suministrar e instalar la ventanería del bloque 2")
    expect(m.obra).toBe("Edificio Altos")
    expect(m.items).toEqual([{ actividad: "8.2 Ventana corrediza", unidad: "m2", cantidad: "40", valorUnitario: "250.000" }])
    const global = minutaSuministroPorDefecto(detalle({ items: [], anexoTipo: "valor_global" }), extra, "2026-10-08")
    expect(global.items).toEqual([{ actividad: "Suministrar e instalar la ventanería del bloque 2", unidad: "GL", cantidad: "1", valorUnitario: "10.000.000" }])
  })

  it("forma de pago: texto de la plantilla, anticipo y la de la solicitud", () => {
    expect(m.formaPago.startsWith(PAGO_PERIODICO)).toBe(true)
    expect(m.formaPago).toContain("anticipo del treinta por ciento (30 %) correspondiente a TRES MILLONES DE PESOS ($3.000.000) M/CTE")
    expect(m.formaPago.endsWith("Contra entrega de cada piso.")).toBe(true)
    const sin = minutaSuministroPorDefecto(detalle({ tieneAnticipo: false, anticipoPorcentaje: null, formaPago: "" }), extra, "2026-10-08")
    expect(sin.formaPago).toBe(PAGO_PERIODICO)
  })

  it("plazo en días calendario", () => {
    expect(m.plazo).toBe("treinta (30) días calendario")
    const fechas = minutaSuministroPorDefecto(
      detalle({ plazoTipo: "fechas", fechaInicio: "2026-11-01", fechaFin: "2026-11-21", duracionCantidad: null, duracionUnidad: null }),
      extra,
      "2026-10-08"
    )
    expect(fechas.plazo).toBe("veinte (20) días calendario")
    const meses = minutaSuministroPorDefecto(detalle({ duracionCantidad: 2, duracionUnidad: "meses" }), extra, "2026-10-08")
    expect(meses.plazo).toBe("dos (2) meses")
  })

  it("amparos: el de anticipo solo si hay anticipo", () => {
    expect(m.amparos).toEqual([AMPARO_ANTICIPO, ...AMPAROS_PLANTILLA])
    const sin = minutaSuministroPorDefecto(detalle({ tieneAnticipo: false, anticipoPorcentaje: null }), extra, "2026-10-08")
    expect(sin.amparos).toEqual(AMPAROS_PLANTILLA)
  })

  it("obligaciones del contratista: plantilla más las de la solicitud, sin N/A", () => {
    expect(m.obligacionesContratista).toEqual([...OBLIGACIONES_CONTRATISTA_SUMINISTRO, "Retirar los sobrantes"])
  })

  it("persona natural: su documento, sin NIT ni representante", () => {
    const n = minutaSuministroPorDefecto(
      detalle({ contratistaTipoPersona: "natural" }),
      { ...extra, contratistaTipoDocumento: "CE", contratistaNumeroDocumento: "E777", contratistaRepresentante: null },
      "2026-10-08"
    )
    expect(n.contratistaTipoPersona).toBe("natural")
    expect(n.contratistaTipoDocumento).toBe("CE")
    expect(n.contratistaCedula).toBe("E777")
    expect(n.contratistaNit).toBe("")
    expect(n.contratistaRepresentante).toBe("")
  })
})

it("textoAnticipo con decimales en el monto", () => {
  expect(textoAnticipo(15, 1_000_001)).toContain("($150.000,15) M/CTE")
})

describe("mezclarMinutaSuministro", () => {
  const defecto = minutaSuministroPorDefecto(detalle(), extra, "2026-10-08")
  it("lo guardado gana; valida tipos y listas de objetos", () => {
    const r = mezclarMinutaSuministro(defecto, {
      plazo: "quince (15) días calendario",
      contratistaTipoDocumento: "NIT",
      amparos: [{ amparo: "Cumplimiento", porcentaje: 30, vigencia: "x" }, "basura"],
      items: "no",
      otro: 1,
    })
    expect(r.plazo).toBe("quince (15) días calendario")
    expect(r.contratistaTipoDocumento).toBe("CC")
    expect(r.amparos).toEqual([{ amparo: "Cumplimiento", porcentaje: "30", vigencia: "x" }])
    expect(r.items).toEqual(defecto.items)
    expect("otro" in r).toBe(false)
  })
})

it("limpiarMinutaSuministro quita filas vacías", () => {
  const m = limpiarMinutaSuministro({
    ...minutaSuministroVacia(),
    amparos: [{ amparo: " ", porcentaje: "", vigencia: "" }, { amparo: "Calidad", porcentaje: "10", vigencia: " 1 año " }],
    items: [{ actividad: "", unidad: "m2", cantidad: "", valorUnitario: "" }],
    obligacionesContratante: ["", " a "],
  })
  expect(m.amparos).toEqual([{ amparo: "Calidad", porcentaje: "10", vigencia: "1 año" }])
  expect(m.items).toEqual([])
  expect(m.obligacionesContratante).toEqual(["a"])
})

it("origen y nombre del archivo", () => {
  const d = minutaSuministroPorDefecto(detalle(), extra, "2026-10-08")
  expect(origenCampoSuministro("clausulaPenalPorcentaje", "10", d)).toBe("plantilla")
  expect(origenCampoSuministro("contratistaNombre", d.contratistaNombre, d)).toBe("solicitud")
  expect(origenCampoSuministro("contratanteRepresentante", "", d)).toBe("vacio")
  expect(nombreArchivoMinutaSuministro(31, "Vidrios del Norte S.A.S")).toBe("minuta-suministro-31-vidrios-del-norte-s-a-s.pdf")
})
