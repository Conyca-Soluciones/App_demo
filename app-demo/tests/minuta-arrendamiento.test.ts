import { describe, expect, it } from "vitest"
import type { SolicitudContratoDetalle } from "@/lib/contratos"
import { CONTRATANTE_POR_DEFECTO, type DatosExtraMinuta } from "@/lib/minuta-mano-obra"
import {
  CAUSALES_TERMINACION,
  OBLIGACIONES_ARRENDADOR,
  PARAGRAFO_ADMINISTRACION,
  limpiarMinutaArrendamiento,
  mezclarMinutaArrendamiento,
  minutaArrendamientoPorDefecto,
  minutaArrendamientoVacia,
  nombreArchivoMinutaArrendamiento,
  origenCampoArrendamiento,
} from "@/lib/minuta-arrendamiento"

const detalle = (cambios: Partial<SolicitudContratoDetalle> = {}): SolicitudContratoDetalle => ({
  id: "c1",
  numero: 21,
  proyectoId: "p1",
  proyectoCodigo: "P-01",
  proyectoNombre: "Edificio Altos",
  tipo: "arrendamiento",
  estado: "pre_aprobacion",
  contratistaNombre: "Inversiones Ruiz S.A.S",
  contratistaDocumento: "NIT 900999101-8",
  objeto: "Arrendar una bodega para el almacén de la obra.",
  valor: 30_000_000,
  plazoTipo: "duracion",
  fechaInicio: "2026-11-01",
  fechaFin: null,
  duracionCantidad: 12,
  duracionUnidad: "meses",
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
  anexoTipo: "valor_global",
  valorMensual: 2_500_000,
  tieneAnticipo: false,
  anticipoPorcentaje: null,
  formaPago: "Mes anticipado.",
  correoNotificacion: "arriendos@ruiz.co",
  observaciones: null,
  obligaciones: ["Entregar las llaves de la bodega", "No aplica"],
  entregables: [],
  items: [],
  documentos: [],
  ...cambios,
})

const extra: DatosExtraMinuta = {
  proyectoCiudad: "Bogotá",
  empresaNombre: null,
  empresaNit: null,
  contratistaTipoDocumento: "NIT",
  contratistaNumeroDocumento: "900999101",
  contratistaDv: 8,
  contratistaRepresentante: "Pedro Ruiz",
  contratistaRepresentanteDocumento: "80990100",
  contratistaCiudad: "Medellín",
}

describe("minutaArrendamientoPorDefecto", () => {
  const m = minutaArrendamientoPorDefecto(detalle(), extra, "2026-10-08")

  it("el contratista es el arrendador y la empresa el arrendatario", () => {
    expect(m.arrendadorNombre).toBe("Inversiones Ruiz S.A.S")
    expect(m.arrendadorNit).toBe("900999101-8")
    expect(m.arrendadorRepresentante).toBe("Pedro Ruiz")
    expect(m.arrendadorCedula).toBe("80990100")
    expect(m.arrendadorCorreo).toBe("arriendos@ruiz.co")
    expect(m.arrendatarioNombre).toBe(CONTRATANTE_POR_DEFECTO.nombre)
    expect(m.arrendatarioNit).toBe(CONTRATANTE_POR_DEFECTO.nit)
  })

  it("canon = valor mensual, en número y en letras", () => {
    expect(m.canon).toBe("2.500.000")
    expect(m.canonLetras).toMatch(/^DOS MILLONES QUINIENTOS MIL PESOS/)
  })

  it("término y fecha de inicio desde la solicitud", () => {
    expect(m.plazo).toBe("doce (12) meses")
    expect(m.fechaInicio).toBe("2026-11-01")
    const porFechas = minutaArrendamientoPorDefecto(
      detalle({ plazoTipo: "fechas", fechaInicio: "2026-01-15", fechaFin: "2026-07-15", duracionCantidad: null, duracionUnidad: null }),
      extra,
      "2026-10-08"
    )
    expect(porFechas.plazo).toBe("seis (6) meses")
    const dias = minutaArrendamientoPorDefecto(
      detalle({ plazoTipo: "fechas", fechaInicio: "2026-01-15", fechaFin: "2026-02-04", duracionCantidad: null, duracionUnidad: null }),
      extra,
      "2026-10-08"
    )
    expect(dias.plazo).toBe("veinte (20) días")
  })

  it("obligaciones del arrendador: las de la plantilla más las de la solicitud, sin «No aplica»", () => {
    expect(m.obligacionesArrendador).toEqual([...OBLIGACIONES_ARRENDADOR, "Entregar las llaves de la bodega"])
    expect(m.causalesTerminacion).toEqual(CAUSALES_TERMINACION)
    expect(m.paragrafoAdministracion).toBe(PARAGRAFO_ADMINISTRACION)
  })

  it("lo que no está en la app queda vacío para Jurídica", () => {
    expect(m.inmuebleDireccion).toBe("")
    expect(m.destinacion).toBe("")
    expect(m.iva).toBe("")
    expect(m.serviciosPublicos).toBe("")
    expect(m.arrendatarioRepresentante).toBe("")
    expect(m.inmuebleCiudad).toBe("Bogotá")
  })

  it("persona natural: su cédula y sin representante", () => {
    const n = minutaArrendamientoPorDefecto(detalle({ contratistaTipoPersona: "natural" }), { ...extra, contratistaTipoDocumento: "CC", contratistaNumeroDocumento: "79990100" }, "2026-10-08")
    expect(n.arrendadorTipoPersona).toBe("natural")
    expect(n.arrendadorCedula).toBe("79990100")
    expect(n.arrendadorRepresentante).toBe("")
    expect(n.arrendadorNit).toBe("")
    expect(n.arrendadorTipoDocumento).toBe("CC")
  })

  it("tipo de documento: el de la persona natural o el del representante; CC si no viene", () => {
    const ce = minutaArrendamientoPorDefecto(detalle({ contratistaTipoPersona: "natural" }), { ...extra, contratistaTipoDocumento: "CE", contratistaNumeroDocumento: "E12345" }, "2026-10-08")
    expect(ce.arrendadorTipoDocumento).toBe("CE")
    expect(ce.arrendadorCedula).toBe("E12345")
    const rep = minutaArrendamientoPorDefecto(detalle(), { ...extra, contratistaRepresentanteTipoDocumento: "PA" }, "2026-10-08")
    expect(rep.arrendadorTipoDocumento).toBe("PA")
    expect(minutaArrendamientoPorDefecto(detalle(), extra, "2026-10-08").arrendadorTipoDocumento).toBe("CC")
  })

  it("la causal por mora del arrendatario la alega el arrendador", () => {
    expect(m.causalesTerminacion[3]).toMatch(/solo podrá ser alegada por parte del ARRENDADOR\.$/)
  })

  it("sin valor mensual el canon queda vacío", () => {
    const sin = minutaArrendamientoPorDefecto(detalle({ valorMensual: null }), extra, "2026-10-08")
    expect(sin.canon).toBe("")
    expect(sin.canonLetras).toBe("")
  })
})

describe("mezclarMinutaArrendamiento", () => {
  const defecto = minutaArrendamientoPorDefecto(detalle(), extra, "2026-10-08")

  it("lo guardado gana; ignora campos desconocidos y valores inválidos", () => {
    const r = mezclarMinutaArrendamiento(defecto, {
      destinacion: "oficina de obra",
      iva: "incluido",
      serviciosPublicos: "gratis",
      arrendadorTipoPersona: "otra",
      inventado: "x",
      canon: 5,
      arrendadorTipoDocumento: "NIT",
    })
    expect(r.arrendadorTipoDocumento).toBe("CC")
    expect(r.destinacion).toBe("oficina de obra")
    expect(r.iva).toBe("incluido")
    expect(r.serviciosPublicos).toBe("")
    expect(r.arrendadorTipoPersona).toBe("juridica")
    expect(r.canon).toBe("2.500.000")
    expect("inventado" in r).toBe(false)
  })

  it("una minuta de mano de obra guardada no rompe la de arrendamiento", () => {
    const r = mezclarMinutaArrendamiento(defecto, { contratistaNombre: "X", ciudadFirma: "Cali", items: [] })
    expect(r.ciudadFirma).toBe("Cali")
    expect(r.arrendadorNombre).toBe("Inversiones Ruiz S.A.S")
  })

  it("con datos que no son objeto devuelve lo calculado", () => {
    expect(mezclarMinutaArrendamiento(defecto, null)).toBe(defecto)
    expect(mezclarMinutaArrendamiento(defecto, ["a"])).toBe(defecto)
  })
})

describe("limpiarMinutaArrendamiento", () => {
  it("quita renglones y cláusulas vacías", () => {
    const m = limpiarMinutaArrendamiento({
      ...minutaArrendamientoVacia(),
      obligacionesArrendador: [" a ", "", "  "],
      causalesTerminacion: ["", "b"],
      clausulasAdicionales: [{ titulo: " ", texto: "" }, { titulo: "Pólizas", texto: " t " }],
    })
    expect(m.obligacionesArrendador).toEqual(["a"])
    expect(m.causalesTerminacion).toEqual(["b"])
    expect(m.clausulasAdicionales).toEqual([{ titulo: "Pólizas", texto: "t" }])
  })
})

describe("origenCampoArrendamiento", () => {
  const defecto = minutaArrendamientoPorDefecto(detalle(), extra, "2026-10-08")
  it("plantilla, solicitud, editado o vacío", () => {
    expect(origenCampoArrendamiento("arrendatarioCorreo", defecto.arrendatarioCorreo, defecto)).toBe("plantilla")
    expect(origenCampoArrendamiento("arrendatarioNombre", defecto.arrendatarioNombre, defecto)).toBe("plantilla")
    expect(origenCampoArrendamiento("arrendadorNombre", defecto.arrendadorNombre, defecto)).toBe("solicitud")
    expect(origenCampoArrendamiento("arrendadorNombre", "Otro", defecto)).toBe("editado")
    expect(origenCampoArrendamiento("destinacion", "", defecto)).toBe("vacio")
  })
})

it("nombre del archivo sin tildes ni símbolos", () => {
  expect(nombreArchivoMinutaArrendamiento(21, "Inversiones Ruiz S.A.S (PRUEBA)")).toBe("minuta-arrendamiento-21-inversiones-ruiz-s-a-s-prueba.pdf")
})
