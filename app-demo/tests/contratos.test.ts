import { describe, expect, it } from "vitest"
import {
  anticipoEnLetras,
  esNoAplica,
  leerNumero,
  pideValorMensual,
  porcentajeEnLetras,
  totalAnexo,
  validarSolicitud,
  datosTipoABase,
  datosTipoDesdeBase,
  type ItemPresupuestoContrato,
  type SolicitudContratoForm,
} from "@/lib/contratos"

// Solicitud válida de valor global; cada prueba cambia solo lo que le importa.
const base: SolicitudContratoForm = {
  tipo: "mano_obra",
  contratistaId: "c1",
  objeto: "Ejecutar la mampostería del bloque 2",
  anexoTipo: "valor_global",
  valor: "25.000.000",
  valorMensual: "",
  items: [],
  tieneAnticipo: false,
  anticipoPorcentaje: "",
  formaPago: "Actas quincenales",
  plazoTipo: "fechas",
  fechaInicio: "2026-10-01",
  fechaFin: "2026-12-31",
  duracionCantidad: "",
  duracionUnidad: "meses",
  obligaciones: ["Usar dotación"],
  entregables: ["Acta de entrega"],
  correoNotificacion: "Obras@Contratista.co",
  observaciones: "",
  departamentoDomicilio: "Arauca",
  // mano de obra (plantilla GJ-F-003 versión 04)
  pagoCadaDias: "15",
  retencionGarantia: "no",
  retencionPorcentaje: "",
  inmuebleDireccion: "",
  inmuebleUso: "",
  canonIva: "",
  serviciosIncluidos: "",
  correoFactura: "",
  bienNombre: "",
  actas: "",
  exigeGarantia: "si",
}

const errores = (f: Partial<SolicitudContratoForm>, catalogo?: Map<string, ItemPresupuestoContrato>) => {
  const r = validarSolicitud({ ...base, ...f }, catalogo)
  return r.ok ? {} : r.errores
}

describe("leerNumero (formato colombiano)", () => {
  it.each([
    ["1.250,5", 1250.5],
    ["38.500", 38500],
    ["1.500.000", 1500000],
    ["2.5", 2.5],
    ["$ 1.000", 1000],
    ["1436,45", 1436.45],
    ["0", 0],
  ])("%s -> %d", (texto, esperado) => {
    expect(leerNumero(texto)).toBe(esperado)
  })

  it.each(["", "  ", "abc", "1,2,3", "-5", "1.2.3,4,5"])("%j no es número", (texto) => {
    expect(leerNumero(texto)).toBeNull()
  })
})

describe("validarSolicitud", () => {
  it("acepta una solicitud completa y limpia los datos", () => {
    const r = validarSolicitud(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.datos.valor).toBe(25_000_000)
    expect(r.datos.correoNotificacion).toBe("obras@contratista.co")
    expect(r.datos.valorMensual).toBeNull()
    expect(r.datos.observaciones).toBeNull()
  })

  it("el objeto debe empezar con un verbo en infinitivo", () => {
    expect(errores({ objeto: "La mampostería del bloque 2" }).objeto).toMatch(/verbo/)
    expect(errores({ objeto: "Suministrar e instalar ventanas" }).objeto).toBeUndefined()
  })

  it("obligaciones y entregables son obligatorios (vale N/A)", () => {
    const e = errores({ obligaciones: [" "], entregables: [] })
    expect(e.obligaciones).toMatch(/N\/A/)
    expect(e.entregables).toMatch(/N\/A/)
    expect(errores({ obligaciones: ["N/A"], entregables: ["No aplica"] })).toEqual({})
  })

  it("quita los renglones vacíos de obligaciones y entregables", () => {
    const r = validarSolicitud({ ...base, obligaciones: ["  a  ", "", "b"] })
    expect(r.ok && r.datos.obligaciones).toEqual(["a", "b"])
  })

  describe("pago mensual", () => {
    it.each(["prestacion_servicios", "alquiler_vehiculo", "arrendamiento"] as const)("es obligatorio en %s", (tipo) => {
      expect(pideValorMensual(tipo)).toBe(true)
      expect(errores({ tipo }).valorMensual).toBeDefined()
      // (arrendamiento y alquiler piden además sus datos de la minuta: aquí solo el pago mensual)
      expect(errores({ tipo, valorMensual: "2.000.000" }).valorMensual).toBeUndefined()
    })

    it("no aplica (ni se guarda) en los demás tipos", () => {
      expect(pideValorMensual("mano_obra")).toBe(false)
      const r = validarSolicitud({ ...base, valorMensual: "999" })
      expect(r.ok && r.datos.valorMensual).toBeNull()
    })

    it("no puede pasar el valor del contrato", () => {
      expect(errores({ tipo: "arrendamiento", valorMensual: "30.000.000" }).valorMensual).toMatch(/mayor/)
    })
  })

  it("anticipo entre 1 y 100 %", () => {
    expect(errores({ tieneAnticipo: true, anticipoPorcentaje: "" }).anticipoPorcentaje).toBeDefined()
    expect(errores({ tieneAnticipo: true, anticipoPorcentaje: "120" }).anticipoPorcentaje).toBeDefined()
    expect(errores({ tieneAnticipo: true, anticipoPorcentaje: "30" })).toEqual({})
  })

  it("plazo por fechas: la de fin no puede ser anterior", () => {
    expect(errores({ fechaInicio: "2026-12-01", fechaFin: "2026-11-01" }).plazo).toMatch(/anterior/)
  })

  it("plazo por duración: número entero", () => {
    expect(errores({ plazoTipo: "duracion", duracionCantidad: "2,5" }).plazo).toBeDefined()
    expect(errores({ plazoTipo: "duracion", duracionCantidad: "3" })).toEqual({})
  })

  it("correo válido", () => {
    expect(errores({ correoNotificacion: "no-es-correo" }).correoNotificacion).toBeDefined()
  })

  describe("valores unitarios contra el presupuesto", () => {
    const catalogo = new Map<string, ItemPresupuestoContrato>([
      ["p1", { id: "p1", codigo: "3.1", descripcion: "Muro", unidad: "m2", cantidad: 100, valorUnitario: 28_000, valorManoObra: 0, contratado: 40, disponible: 60 }],
      ["p3", { id: "p3", codigo: "3.3", descripcion: "Enchape", unidad: "m2", cantidad: 100, valorUnitario: 28_000, valorManoObra: 12_000, contratado: 0, disponible: 100 }],
      ["p2", { id: "p2", codigo: "3.2", descripcion: "Pañete", unidad: "m2", cantidad: 100, valorUnitario: 15_000, valorManoObra: 0, contratado: 0, disponible: 100 }],
    ])
    const unitarios = (cantidad: string, valorUnitario: string): Partial<SolicitudContratoForm> => ({
      anexoTipo: "valores_unitarios",
      valor: "",
      items: [{ presupuestoItemId: "p1", cantidad, valorUnitario }],
    })

    it("el valor es la suma del anexo", () => {
      const r = validarSolicitud({ ...base, ...unitarios("10", "28.000") }, catalogo)
      expect(r.ok && r.datos.valor).toBe(280_000)
    })

    it("la cantidad no pasa lo disponible", () => {
      expect(errores(unitarios("61", "28.000"), catalogo).items).toMatch(/disponible/)
    })

    it("el valor unitario no pasa el del presupuesto", () => {
      expect(errores(unitarios("10", "28.001"), catalogo).items).toMatch(/supera/)
    })

    it("mano de obra: el tope es la mano de obra del APU; sin mano de obra, el ítem completo", () => {
      const mo = (presupuestoItemId: string, valorUnitario: string): Partial<SolicitudContratoForm> => ({
        tipo: "mano_obra",
        anexoTipo: "valores_unitarios",
        valor: "",
        items: [{ presupuestoItemId, cantidad: "1", valorUnitario }],
      })
      expect(errores(mo("p3", "12.000"), catalogo).items).toBeUndefined()
      expect(errores(mo("p3", "12.001"), catalogo).items).toMatch(/mano de obra/)
      expect(errores(mo("p2", "15.000"), catalogo).items).toBeUndefined()
      expect(errores({ ...mo("p3", "28.000"), tipo: "obra" }, catalogo).items).toBeUndefined()
    })

    it("no repite ítems", () => {
      const items = [
        { presupuestoItemId: "p1", cantidad: "1", valorUnitario: "1" },
        { presupuestoItemId: "p1", cantidad: "1", valorUnitario: "1" },
      ]
      expect(errores({ anexoTipo: "valores_unitarios", items }, catalogo).items).toMatch(/repite/)
    })
  })
})

describe("totalAnexo", () => {
  it("suma redondeando a centavos e ignora líneas incompletas", () => {
    expect(
      totalAnexo([
        { presupuestoItemId: "a", cantidad: "1,5", valorUnitario: "10.000" },
        { presupuestoItemId: "b", cantidad: "0,333", valorUnitario: "1" },
        { presupuestoItemId: "c", cantidad: "", valorUnitario: "5" },
      ])
    ).toBe(15_000.33)
  })
})

describe("en letras", () => {
  it("porcentajes enteros y con decimales", () => {
    expect(porcentajeEnLetras(30)).toBe("treinta por ciento (30 %)")
    expect(porcentajeEnLetras(12.5)).toBe("doce coma cinco por ciento (12,5 %)")
    expect(porcentajeEnLetras(5.05)).toBe("cinco coma cero cinco por ciento (5,05 %)")
  })

  it("anticipo en número y en letras", () => {
    expect(anticipoEnLetras(30, 30_000_000)).toMatch(/^treinta por ciento \(30 %\) del valor del contrato, es decir NUEVE MILLONES DE PESOS M\/CTE/)
  })

  it.each(["N/A", "n/a", "NA", "No aplica", "no aplica."])("%j cuenta como 'no aplica'", (t) => {
    expect(esNoAplica(t)).toBe(true)
  })

  it("un texto real no cuenta como 'no aplica'", () => {
    expect(esNoAplica("No aplica la póliza de cumplimiento")).toBe(false)
  })
})

describe("domicilio y datos de la minuta según el tipo", () => {
  it("el departamento de domicilio es obligatorio en todos los tipos", () => {
    expect(errores({ departamentoDomicilio: "  " }).departamentoDomicilio).toBeTruthy()
    expect(errores({}).departamentoDomicilio).toBeUndefined()
  })

  it("obra: pago cada X días y retención en garantía", () => {
    const e = errores({ tipo: "obra", pagoCadaDias: "", retencionGarantia: "" })
    expect(e.pagoCadaDias).toBeTruthy()
    expect(e.retencion).toBeTruthy()
    expect(errores({ tipo: "obra", pagoCadaDias: "15.5", retencionGarantia: "no" }).pagoCadaDias).toBeTruthy()
    expect(errores({ tipo: "obra", pagoCadaDias: "15", retencionGarantia: "si", retencionPorcentaje: "" }).retencion).toBeTruthy()
    const r = validarSolicitud({ ...base, tipo: "obra", pagoCadaDias: "15", retencionGarantia: "si", retencionPorcentaje: "5%" })
    expect(r.ok && r.datos.datosTipo).toEqual({ pagoCadaDias: 15, retencionGarantia: true, retencionPorcentaje: 5 })
    const sin = validarSolicitud({ ...base, tipo: "obra", pagoCadaDias: "30", retencionGarantia: "no" })
    expect(sin.ok && sin.datos.datosTipo).toEqual({ pagoCadaDias: 30, retencionGarantia: false })
  })

  it("mano de obra: pago cada X días, retención en garantía y garantías", () => {
    const e = errores({ pagoCadaDias: "", retencionGarantia: "", exigeGarantia: "" })
    expect(e.pagoCadaDias && e.retencion && e.exigeGarantia).toBeTruthy()
    const r = validarSolicitud({ ...base, retencionGarantia: "si", retencionPorcentaje: "5", exigeGarantia: "no" })
    expect(r.ok && r.datos.datosTipo).toEqual({ pagoCadaDias: 15, retencionGarantia: true, retencionPorcentaje: 5, exigeGarantia: false })
    expect(datosTipoABase("mano_obra", { pagoCadaDias: 15, retencionGarantia: false, exigeGarantia: true })).toEqual({
      pago_cada_dias: 15,
      retencion_garantia: false,
      exige_garantia: true,
    })
    // obra no guarda garantías (su plantilla siempre las exige)
    expect(datosTipoABase("obra", { pagoCadaDias: 15, retencionGarantia: false, exigeGarantia: true })).toEqual({ pago_cada_dias: 15, retencion_garantia: false })
  })

  it("arrendamiento: inmueble, uso, IVA, servicios y correo de la factura", () => {
    const e = errores({ tipo: "arrendamiento", valorMensual: "2.000.000" })
    for (const campo of ["inmuebleDireccion", "inmuebleUso", "canonIva", "serviciosIncluidos", "correoFactura"] as const) expect(e[campo]).toBeTruthy()
    const r = validarSolicitud({
      ...base,
      tipo: "arrendamiento",
      valorMensual: "2.000.000",
      inmuebleDireccion: "Calle 1 # 2-3",
      inmuebleUso: "Campamento de obra",
      canonIva: "incluido",
      serviciosIncluidos: "no",
      correoFactura: " Facturas@Conyca.CO ",
    })
    expect(r.ok && r.datos.datosTipo).toEqual({
      inmuebleDireccion: "Calle 1 # 2-3",
      inmuebleUso: "Campamento de obra",
      canonIva: "incluido",
      serviciosIncluidos: false,
      correoFactura: "facturas@conyca.co",
    })
  })

  it("alquiler: nombre corto, actas y garantías", () => {
    const e = errores({ tipo: "alquiler_vehiculo", valorMensual: "1.000.000", exigeGarantia: "" })
    expect(e.bienNombre && e.actas && e.exigeGarantia).toBeTruthy()
    const r = validarSolicitud({ ...base, tipo: "alquiler_vehiculo", valorMensual: "1.000.000", bienNombre: " Volqueta ", actas: "quincenales", exigeGarantia: "si" })
    expect(r.ok && r.datos.datosTipo).toEqual({ bienNombre: "Volqueta", actas: "quincenales", exigeGarantia: true })
  })

  it("los demás tipos no llevan datos extra; ida y vuelta con la base", () => {
    const r = validarSolicitud({ ...base, tipo: "suministro_instalacion" })
    expect(r.ok && r.datos.datosTipo).toEqual({})
    expect(datosTipoABase("obra", { pagoCadaDias: 15, retencionGarantia: false })).toEqual({ pago_cada_dias: 15, retencion_garantia: false })
    expect(datosTipoDesdeBase({ bien_nombre: "Grúa", actas: "otra", exige_garantia: false, raro: 1 })).toEqual({ bienNombre: "Grúa", exigeGarantia: false })
    expect(datosTipoDesdeBase(null)).toEqual({})
  })
})
