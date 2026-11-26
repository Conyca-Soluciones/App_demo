import { describe, expect, it } from "vitest"
import {
  avisosLegalizacion,
  cajaParaGuardar,
  gastoParaGuardar,
  gastoVacio,
  leerFechaCelda,
  leerFilasCajaMenor,
  limpiarDocumento,
  mapLegalizacionDetalle,
  porcentajeDeCaja,
  totalGastos,
  validarCajaMenor,
  validarGasto,
  validarLegalizacion,
  type GastoForm,
} from "@/lib/caja-menor"

const HOY = "2026-11-26"
const soporte = { ruta: "u/a.pdf", nombre: "a.pdf", mime: "application/pdf", tamano: 10 }
const gasto = (cambios: Partial<GastoForm> = {}): GastoForm => ({
  ...gastoVacio("p1"),
  fecha: "2026-11-20",
  numeroFactura: "F-1",
  documento: "900.123.456-7",
  nombre: "Ferretería X",
  concepto: "Tornillos",
  destino: "Obra",
  valor: "150.000",
  soporte,
  ...cambios,
})

describe("validarGasto", () => {
  it("acepta un gasto completo", () => {
    expect(validarGasto(gasto(), HOY)).toBeNull()
  })
  it("pide cada dato", () => {
    expect(validarGasto(gasto({ fecha: "" }), HOY)).toMatch(/fecha/)
    expect(validarGasto(gasto({ fecha: "2026-12-01" }), HOY)).toMatch(/futura/)
    expect(validarGasto(gasto({ proyectoId: "" }), HOY)).toMatch(/proyecto/)
    expect(validarGasto(gasto({ numeroFactura: " " }), HOY)).toMatch(/factura/)
    expect(validarGasto(gasto({ documento: "abc" }), HOY)).toMatch(/NIT o cédula/)
    expect(validarGasto(gasto({ nombre: "" }), HOY)).toMatch(/razón social/)
    expect(validarGasto(gasto({ concepto: "" }), HOY)).toMatch(/concepto/)
    expect(validarGasto(gasto({ destino: "" }), HOY)).toMatch(/destino/)
    expect(validarGasto(gasto({ valor: "0" }), HOY)).toMatch(/mayor que cero/)
    expect(validarGasto(gasto({ soporte: null }), HOY)).toMatch(/soporte/)
  })
  it("acepta el soporte elegido aunque no esté subido", () => {
    expect(validarGasto(gasto({ soporte: null, archivoSoporte: {} as File }), HOY)).toBeNull()
  })
})

describe("validarLegalizacion y totales", () => {
  it("exige al menos un gasto y como máximo 200", () => {
    expect(validarLegalizacion([], HOY)[0].mensaje).toMatch(/al menos un gasto/)
    expect(validarLegalizacion(Array.from({ length: 201 }, () => gasto()), HOY)[0].mensaje).toMatch(/200/)
  })
  it("devuelve el índice de cada gasto con error", () => {
    expect(validarLegalizacion([gasto(), gasto({ destino: "" }), gasto({ valor: "" })], HOY).map((e) => e.indice)).toEqual([1, 2])
  })
  it("suma en formato colombiano", () => {
    expect(totalGastos([gasto({ valor: "150.000" }), gasto({ valor: "80.000,50" })])).toBe(230000.5)
  })
  it("lo que se manda a la base", () => {
    const g = gastoParaGuardar(gasto({ documento: " 900.123.456-7 ", valor: "1.250,5" }))
    expect(g.documento).toBe("900123456-7")
    expect(g.valor).toBe(1250.5)
    expect(g.soporte).toEqual(soporte)
  })
  it("limpiarDocumento", () => {
    expect(limpiarDocumento("CC 1.234.567")).toBe("1234567")
    expect(limpiarDocumento("--900--1-")).toBe("900-1")
  })
})

describe("avisos (no bloquean)", () => {
  it("porcentaje de la caja", () => {
    expect(porcentajeDeCaja(2_300_000, 3_000_000)).toBe(77)
    expect(porcentajeDeCaja(10, 0)).toBe(0)
  })
  it("sin avisos dentro del monto", () => {
    expect(avisosLegalizacion([1_000_000, 1_100_000], 3_000_000)).toEqual([])
  })
  it("avisa si la suma pasa el monto o un gasto es más grande que la caja", () => {
    const a = avisosLegalizacion([3_500_000], 3_000_000)
    expect(a).toHaveLength(2)
    expect(a[0]).toMatch(/117 %/)
    expect(a[1]).toMatch(/Un gasto/)
    expect(avisosLegalizacion([2_000_000, 1_500_000], 3_000_000)).toHaveLength(1)
  })
})

describe("caja", () => {
  const caja = { responsableId: "r", terceroId: "t", terceroNombre: "T", cuentaId: "c", empresaId: "e", proyectoId: "p", monto: "3.000.000", descripcion: " Obra " }
  it("valida y arma lo que se guarda", () => {
    expect(validarCajaMenor(caja)).toBeNull()
    expect(validarCajaMenor({ ...caja, cuentaId: null })).toMatch(/cuenta/)
    expect(validarCajaMenor({ ...caja, monto: "0" })).toMatch(/monto/)
    expect(cajaParaGuardar(caja)).toMatchObject({ monto: 3_000_000, descripcion: "Obra" })
  })
})

describe("leerFechaCelda", () => {
  it("lee fechas de Excel en varios formatos", () => {
    expect(leerFechaCelda(new Date(Date.UTC(2026, 10, 20)))).toBe("2026-11-20")
    expect(leerFechaCelda(46346)).toBe("2026-11-20")
    expect(leerFechaCelda("20/11/2026")).toBe("2026-11-20")
    expect(leerFechaCelda("5/1/2026")).toBe("2026-01-05")
    expect(leerFechaCelda("2026-11-20")).toBe("2026-11-20")
    expect(leerFechaCelda("31/02/2026")).toBeNull()
    expect(leerFechaCelda("ayer")).toBeNull()
  })
})

describe("leerFilasCajaMenor", () => {
  const proyectos = [
    { id: "p1", codigo: "900-CS-YOP-MALECÓN", nombre: "Malecón" },
    { id: "p2", codigo: null, nombre: "FUNCIONAMIENTO" },
  ]
  const encabezado = ["Fecha", "Proyecto", "Número de factura", "NIT o cédula", "Nombre o razón social", "Concepto", "Destino", "Valor total pagado"]

  it("lee las filas llenas y salta las vacías", () => {
    const r = leerFilasCajaMenor(
      [
        ["Caja menor"],
        encabezado,
        ["20/11/2026", "900-cs-yop-malecon", "F-1", "900123456-7", "Ferretería", "Tornillos", "Obra", 150000],
        [null, null, null, null, null, null, null, null],
        [46346, "FUNCIONAMIENTO", 77, 1234, "Gasolinera", "Gasolina", "Camioneta", "80.000,5"],
      ],
      proyectos
    )
    expect(r.errores).toEqual([])
    expect(r.gastos).toHaveLength(2)
    expect(r.gastos[0]).toMatchObject({ fecha: "2026-11-20", proyectoId: "p1", documento: "900123456-7", valor: "150000" })
    expect(r.gastos[1]).toMatchObject({ proyectoId: "p2", numeroFactura: "77", documento: "1234", valor: "80000,5" })
    expect(r.gastos[0].soporte).toBeNull()
  })

  it("informa el error de cada fila con su número de fila del Excel", () => {
    const r = leerFilasCajaMenor(
      [
        encabezado,
        ["32/11/2026", "Malecón", "F", "1", "N", "C", "D", 1],
        ["20/11/2026", "Otro", "F", "1", "N", "C", "D", 1],
        ["20/11/2026", "Malecón", "F", "1", "N", "C", "", 1],
        ["20/11/2026", "Malecón", "F", "1", "N", "C", "D", "cero"],
      ],
      proyectos
    )
    expect(r.gastos).toHaveLength(0)
    expect(r.errores.map((e) => e.fila)).toEqual([2, 3, 4, 5])
    expect(r.errores[0].mensaje).toMatch(/fecha/)
    expect(r.errores[1].mensaje).toMatch(/proyecto/)
    expect(r.errores[2].mensaje).toMatch(/destino/)
    expect(r.errores[3].mensaje).toMatch(/valor/)
  })

  it("exige la plantilla", () => {
    expect(() => leerFilasCajaMenor([["otra cosa"]], proyectos)).toThrow(/plantilla/)
    expect(() => leerFilasCajaMenor([["Fecha", "Valor total pagado"]], proyectos)).toThrow(/Faltan las columnas/)
  })
})

describe("mapLegalizacionDetalle", () => {
  it("mapea lo que devuelve la base", () => {
    const d = mapLegalizacionDetalle({
      id: "l1", codigo: "CM-007-0001", estado: "por_revisar", n_gastos: 1, valor_total: "150000.00", caja_numero: 3,
      es_mia: true,
      gastos: [{ id: "g1", orden: 1, fecha: "2026-11-20", proyecto_id: "p1", numero_factura: "F-1", documento: "1", nombre: "N",
                 concepto: "C", destino: "D", valor: "150000.00", soporte: { ruta: "u/a.pdf", nombre: "a.pdf" } }],
      eventos: [{ evento: "enviada", fecha: "2026-11-26T10:00:00Z", usuario_nombre: "Inge" }],
      caja: null,
    })
    expect(d.valorTotal).toBe(150000)
    expect(d.esMia).toBe(true)
    expect(d.gastos[0].soporte.ruta).toBe("u/a.pdf")
    expect(d.eventos[0].usuarioNombre).toBe("Inge")
    expect(mapLegalizacionDetalle({ estado: "raro" }).estado).toBe("por_revisar")
  })
})

describe("plantilla de Excel (ida y vuelta)", () => {
  it("lo que se llena en la plantilla se lee igual", async () => {
    const { construirPlantillaCajaMenor } = await import("@/lib/excel-caja-menor")
    const XLSX = await import("xlsx")
    const proyectos = [{ id: "p1", codigo: "900-CS-YOP-MALECÓN", nombre: "Malecón" }]
    const libro = await construirPlantillaCajaMenor(proyectos, null)
    const hoja = libro.getWorksheet("Caja menor")!
    let filaEnc = 0
    hoja.eachRow((r, n) => {
      if (!filaEnc && r.getCell(1).value === "Fecha") filaEnc = n
    })
    expect(filaEnc).toBeGreaterThan(0)
    const f = hoja.getRow(filaEnc + 1)
    ;[new Date(Date.UTC(2026, 10, 20)), "900-CS-YOP-MALECÓN", "F-1", "900123456-7", "Ferretería", "Tornillos", "Obra", 150000].forEach(
      (v, i) => (f.getCell(i + 1).value = v)
    )
    const buffer = await libro.xlsx.writeBuffer()
    const leido = XLSX.read(buffer, { type: "array", cellDates: true })
    const filas = XLSX.utils.sheet_to_json<unknown[]>(leido.Sheets["Caja menor"], { header: 1, defval: null, raw: true })
    const r = leerFilasCajaMenor(filas, proyectos)
    expect(r.errores).toEqual([])
    expect(r.gastos).toHaveLength(1)
    expect(r.gastos[0]).toMatchObject({ fecha: "2026-11-20", proyectoId: "p1", documento: "900123456-7", valor: "150000" })
  })
})
