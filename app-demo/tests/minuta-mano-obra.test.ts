import { describe, expect, it } from "vitest"
import type { SolicitudContratoDetalle } from "@/lib/contratos"
import {
  CONTRATANTE_POR_DEFECTO,
  OBLIGACIONES_CONTRATISTA,
  cantidadEnLetras,
  fechaLarga,
  limpiarMinuta,
  mezclarMinuta,
  minutaPorDefecto,
  minutaVacia,
  nombreArchivoMinuta,
  ordinalClausula,
  origenCampo,
  origenRenglon,
  type DatosExtraMinuta,
} from "@/lib/minuta-mano-obra"

const detalle = (cambios: Partial<SolicitudContratoDetalle> = {}): SolicitudContratoDetalle => ({
  id: "c1",
  numero: 17,
  proyectoId: "p1",
  proyectoCodigo: "P-01",
  proyectoNombre: "Edificio Altos",
  tipo: "mano_obra",
  estado: "pre_aprobacion",
  contratistaNombre: "CONSTRUCCIONES ÁLVAREZ S.A.S",
  contratistaDocumento: "NIT 901234567-8",
  objeto: "Ejecutar la mampostería del bloque 2.",
  valor: 30_000_000,
  plazoTipo: "duracion",
  fechaInicio: "2026-01-31",
  fechaFin: null,
  duracionCantidad: 1,
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
  anexoTipo: "valores_unitarios",
  valorMensual: null,
  tieneAnticipo: true,
  anticipoPorcentaje: 30,
  formaPago: "Actas quincenales.",
  correoNotificacion: "obras@alvarez.co",
  observaciones: null,
  obligaciones: ["Suministrar la herramienta menor", "N/A"],
  entregables: [],
  items: [{ presupuestoItemId: "i1", codigo: "3.1", actividad: "Muro en bloque", unidad: "m2", cantidad: 1250.5, valorUnitario: 24_000 }],
  documentos: [],
  ...cambios,
})

const extra: DatosExtraMinuta = {
  proyectoCiudad: "Bogotá",
  empresaNombre: null,
  empresaNit: null,
  contratistaTipoDocumento: "NIT",
  contratistaNumeroDocumento: "901234567",
  contratistaDv: 8,
  contratistaRepresentante: "Juan Álvarez",
  contratistaRepresentanteDocumento: "79123456",
  contratistaCiudad: "Soacha",
}

describe("minutaPorDefecto", () => {
  const m = minutaPorDefecto(detalle(), extra, "2026-10-02")

  it("toma las partes de la solicitud, el contratista y el proyecto", () => {
    expect(m.contratanteNombre).toBe(CONTRATANTE_POR_DEFECTO.nombre)
    expect(m.contratistaNit).toBe("901234567-8")
    expect(m.contratistaRepresentante).toBe("Juan Álvarez")
    expect(m.ciudadFirma).toBe("Bogotá")
    expect(m.obra).toBe("Edificio Altos")
    expect(m.fechaFirma).toBe("2026-10-02")
  })

  it("el objeto sigue a 'encarga al CONTRATISTA'", () => {
    expect(m.objeto).toMatch(/^ejecutar la mampostería del bloque 2, conforme/)
  })

  it("la empresa del proyecto reemplaza al contratante por defecto", () => {
    const otra = minutaPorDefecto(detalle(), { ...extra, empresaNombre: "OTRA S.A.S", empresaNit: "900.1" }, "2026-10-02")
    expect(otra.contratanteNombre).toBe("OTRA S.A.S")
  })

  it("agrega las obligaciones de la solicitud sin los 'N/A'", () => {
    expect(m.obligacionesContratista).toEqual([...OBLIGACIONES_CONTRATISTA, "Suministrar la herramienta menor"])
  })

  it("plazo y vencimiento desde la duración (31 ene + 1 mes = 28 feb)", () => {
    expect(m.plazo).toBe("de un (1) mes contados a partir de la firma de este")
    expect(m.vencimiento).toBe("2026-02-28")
  })

  it("vencimiento = fecha de fin cuando el plazo es por fechas", () => {
    const f = minutaPorDefecto(detalle({ plazoTipo: "fechas", fechaInicio: "2026-03-01", fechaFin: "2026-06-30", duracionCantidad: null }), extra, "2026-10-02")
    expect(f.vencimiento).toBe("2026-06-30")
    expect(f.plazo).toBe("comprendido entre el 1 de marzo de 2026 y el 30 de junio de 2026")
  })

  it("forma de pago con el anticipo en letras", () => {
    expect(m.formaPago).toContain("treinta por ciento (30 %) del valor del contrato, es decir NUEVE MILLONES DE PESOS")
  })

  it("valor global: el anexo es una sola línea con el objeto", () => {
    const g = minutaPorDefecto(detalle({ items: [], anexoTipo: "valor_global" }), extra, "2026-10-02")
    expect(g.items).toEqual([{ actividad: "Ejecutar la mampostería del bloque 2.", unidad: "GL", cantidad: "1", valorUnitario: "30.000.000" }])
  })

  it("persona natural: firma el mismo contratista con su cédula", () => {
    const n = minutaPorDefecto(detalle({ contratistaTipoPersona: "natural", contratistaNombre: "JUAN PÉREZ" }), { ...extra, contratistaTipoDocumento: "CC", contratistaNumeroDocumento: "1010" }, "2026-10-02")
    expect(n.contratistaRepresentante).toBe("JUAN PÉREZ")
    expect(n.contratistaCedula).toBe("1010")
    expect(n.contratistaNit).toBe("")
  })
})

describe("mezclarMinuta", () => {
  const defecto = minutaPorDefecto(detalle(), extra, "2026-10-02")

  it("lo guardado gana campo por campo y lo nuevo sale del defecto", () => {
    const m = mezclarMinuta(defecto, { ciudadFirma: "Cali", obligacionesContratante: ["Una"] })
    expect(m.ciudadFirma).toBe("Cali")
    expect(m.obligacionesContratante).toEqual(["Una"])
    expect(m.obra).toBe(defecto.obra)
    expect(m.vencimiento).toBe(defecto.vencimiento)
  })

  it("ignora basura: tipos equivocados, campos desconocidos y valores raros", () => {
    const m = mezclarMinuta(defecto, {
      ciudadFirma: 123,
      contratistaTipoPersona: "otra",
      inventado: "x",
      items: [null, "x", { actividad: "A", cantidad: 2 }],
      clausulasAdicionales: [{ titulo: "T" }],
    })
    expect(m.ciudadFirma).toBe(defecto.ciudadFirma)
    expect(m.contratistaTipoPersona).toBe("juridica")
    expect("inventado" in m).toBe(false)
    expect(m.items).toEqual([{ actividad: "A", unidad: "", cantidad: "2", valorUnitario: "" }])
    expect(m.clausulasAdicionales).toEqual([{ titulo: "T", texto: "" }])
  })

  it.each([null, undefined, "texto", [1, 2]])("si lo guardado no es un objeto (%j), queda el defecto", (g) => {
    expect(mezclarMinuta(defecto, g)).toEqual(defecto)
  })
})

describe("limpiarMinuta", () => {
  it("quita renglones, actividades y cláusulas vacías", () => {
    const m = limpiarMinuta({
      ...minutaVacia(),
      obligacionesContratante: [" a ", "", "  "],
      items: [{ actividad: " ", unidad: "m2", cantidad: "", valorUnitario: "" }, { actividad: "B", unidad: "", cantidad: "1", valorUnitario: "2" }],
      clausulasAdicionales: [{ titulo: "", texto: " " }, { titulo: " Seguridad ", texto: "Texto" }],
    })
    expect(m.obligacionesContratante).toEqual(["a"])
    expect(m.items).toHaveLength(1)
    expect(m.clausulasAdicionales).toEqual([{ titulo: "Seguridad", texto: "Texto" }])
  })
})

describe("origen de los datos", () => {
  const defecto = minutaPorDefecto(detalle(), extra, "2026-10-02")

  it("campos", () => {
    expect(origenCampo("contratanteNombre", defecto.contratanteNombre, defecto)).toBe("plantilla")
    expect(origenCampo("contratanteCorreo", defecto.contratanteCorreo, defecto)).toBe("plantilla")
    expect(origenCampo("ciudadFirma", defecto.ciudadFirma, defecto)).toBe("solicitud")
    expect(origenCampo("ciudadFirma", "Cali", defecto)).toBe("editado")
    expect(origenCampo("domicilioDepartamento", "", defecto)).toBe("vacio")
  })

  it("renglones de listas", () => {
    expect(origenRenglon(OBLIGACIONES_CONTRATISTA[0], OBLIGACIONES_CONTRATISTA)).toBe("plantilla")
    expect(origenRenglon("De la solicitud", OBLIGACIONES_CONTRATISTA, ["De la solicitud"])).toBe("solicitud")
    expect(origenRenglon("Otra", OBLIGACIONES_CONTRATISTA, [])).toBe("editado")
    expect(origenRenglon("  ", OBLIGACIONES_CONTRATISTA)).toBe("vacio")
  })
})

describe("textos", () => {
  it.each([
    [19, "DÉCIMA NOVENA"],
    [20, "VIGÉSIMA"],
    [21, "VIGÉSIMA PRIMERA"],
    [30, "TRIGÉSIMA"],
  ])("ordinal %d", (n, t) => {
    expect(ordinalClausula(n)).toBe(t)
  })

  it("cantidades delante de días y meses", () => {
    expect(cantidadEnLetras(3)).toBe("tres (3)")
    expect(cantidadEnLetras(21)).toBe("veintiún (21)")
    expect(cantidadEnLetras(1)).toBe("un (1)")
  })

  it("fechas largas", () => {
    expect(fechaLarga("2026-10-05")).toBe("5 de octubre de 2026")
    expect(fechaLarga("")).toBe("__________")
    expect(fechaLarga("2026-13-01")).toBe("__________")
  })

  it("nombre del archivo sin tildes ni símbolos", () => {
    expect(nombreArchivoMinuta(17, "CONSTRUCCIONES ÁLVAREZ S.A.S")).toBe("minuta-contrato-17-construcciones-alvarez-s-a-s.pdf")
  })
})
