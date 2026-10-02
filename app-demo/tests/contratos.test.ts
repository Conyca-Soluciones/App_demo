import { describe, expect, it } from "vitest"
import {
  anticipoEnLetras,
  esNoAplica,
  leerNumero,
  pideValorMensual,
  porcentajeEnLetras,
  totalAnexo,
  validarSolicitud,
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
      expect(errores({ tipo, valorMensual: "2.000.000" })).toEqual({})
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
      ["p1", { id: "p1", codigo: "3.1", descripcion: "Muro", unidad: "m2", cantidad: 100, valorUnitario: 28_000, contratado: 40, disponible: 60 }],
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
