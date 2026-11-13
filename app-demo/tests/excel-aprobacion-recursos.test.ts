import { describe, expect, it } from "vitest"
import {
  COLUMNAS_APROBACION_RECURSOS as C,
  agruparAprobaciones,
  leerFilasAprobacionRecursos,
  type FilaAprobacionRecurso,
} from "@/lib/excel-aprobacion-recursos"
import {
  capitulosDe,
  claveSolicitudRecurso,
  codigosItems,
  grupoDesdeCapitulo,
  unidadPropuesta,
  type ItemSolicitudRecurso,
} from "@/lib/solicitudes-recurso"

const item = (codigo: string, cantidad: number | null, cap: [string, string] | null = ["4", "ESTRUCTURAS"]): ItemSolicitudRecurso => ({
  codigo,
  cantidad,
  unidad: "m³",
  capituloCodigo: cap?.[0] ?? null,
  capitulo: cap?.[1] ?? null,
  proyecto: "MAL",
})

describe("solicitudes de mano de obra y equipo", () => {
  it("misma actividad y unidad = misma clave (mayúsculas, espacios y m² / m2)", () => {
    expect(claveSolicitudRecurso("Zapata  en concreto ", "m²")).toBe(claveSolicitudRecurso("ZAPATA EN CONCRETO", "M2"))
    expect(claveSolicitudRecurso("Zapata en concreto", "m2")).not.toBe(claveSolicitudRecurso("Zapata en concreto", "m3"))
  })

  it("capítulos, grupo, unidad y códigos salen de los ítems", () => {
    const items = [item("4.1.16.4", 96.03), item("1.5", 53, ["1", "Preliminares"]), item("4.1.8.4", 1.6)]
    expect(capitulosDe(items)).toEqual(["1 Preliminares", "4 ESTRUCTURAS"])
    expect(grupoDesdeCapitulo(items)).toBe("PRELIMINARES")
    expect(codigosItems(items)).toBe("1.5, 4.1.8.4, 4.1.16.4")
    expect(unidadPropuesta("m³", items)).toBe("M3")
    expect(unidadPropuesta(null, [item("2.1", 1)])).toBe("M3")
    expect(grupoDesdeCapitulo([item("9", 1, null)])).toBe("")
  })
})

const encabezado = [C.capitulo, C.actividad, C.items, C.grupo, C.unidad, C.valor, C.motivo, C.id]
const hoja = (...filas: unknown[][]) => [["Mano de obra por aprobar"], [], [], [], [], encabezado, ...filas]
const fila = (p: Partial<Record<keyof typeof C, unknown>>): unknown[] => {
  const base: Record<keyof typeof C, unknown> = {
    capitulo: "4 ESTRUCTURAS", actividad: "Zapata", items: "4.1.8.4",
    grupo: "estructuras", unidad: "m3", valor: null, motivo: null, id: "s1", ...p,
  }
  return encabezado.map((h) => base[(Object.keys(C) as (keyof typeof C)[]).find((k) => C[k] === h)!])
}

describe("leerFilasAprobacionRecursos", () => {
  it("con valor aprueba (grupo y unidad en mayúsculas), con motivo rechaza, sin nada se salta", () => {
    const r = leerFilasAprobacionRecursos(
      hoja(fila({ valor: "45.000", actividad: " Zapata   en  concreto " }), fila({ id: "s2", motivo: "Ya existe como Zapata 3000" }), fila({ id: "s3" }))
    )
    expect(r.errores).toEqual([])
    expect(r.sinLlenar).toBe(1)
    expect(r.filas).toEqual([
      { fila: 7, solicitudId: "s1", actividad: "Zapata en concreto", accion: "aprobar", grupo: "ESTRUCTURAS", unidad: "M3", valor: 45000 },
      { fila: 8, solicitudId: "s2", actividad: "Zapata", accion: "rechazar", motivo: "Ya existe como Zapata 3000" },
    ])
  })

  it("reporta los errores por fila y sigue con las demás", () => {
    const r = leerFilasAprobacionRecursos(
      hoja(
        fila({ valor: 1000, motivo: "no" }),
        fila({ id: "s2", valor: "abc" }),
        fila({ id: "s3", valor: 5000, unidad: "" }),
        fila({ id: "s4", valor: "$ 12.500,5" }),
        fila({ id: "s4", valor: 1 }),
        fila({ id: "s5", valor: 1, actividad: "" })
      )
    )
    expect(r.errores.map((e) => [e.fila, e.mensaje.split(" ")[0]])).toEqual([
      [7, "Tiene"],
      [8, "El"],
      [9, "Escribe"],
      [11, "La"],
      [12, "Escribe"],
    ])
    expect(r.filas).toEqual([expect.objectContaining({ solicitudId: "s4", valor: 12500.5 })])
  })

  it("sin la columna del ID interno no sigue", () => {
    expect(() => leerFilasAprobacionRecursos([[C.actividad, C.valor], ["x", 5]])).toThrow(/ID interno/)
  })
})

describe("agruparAprobaciones: mismo nombre y unidad = una categoría", () => {
  const ap = (f: number, id: string, actividad: string, unidad: string, valor: number, grupo: string | null = null) =>
    ({ fila: f, solicitudId: id, actividad, accion: "aprobar", grupo, unidad, valor }) as Extract<FilaAprobacionRecurso, { accion: "aprobar" }>

  it("junta las talas (mismo nombre sin importar mayúsculas) y deja aparte otra unidad", () => {
    const { grupos, errores } = agruparAprobaciones([
      ap(7, "t1", "TALA DE ARBOL", "UND", 50000, "PRELIMINARES"),
      ap(8, "t2", "Tala de  árbol", "UND", 50000),
      ap(9, "t3", "tala de arbol", "UN", 50000),
      ap(10, "r1", "Relleno", "M3", 25000),
      ap(11, "t4", "TALA DE ARBOL", "M2", 3000),
    ])
    expect(errores).toEqual([])
    // "Tala de  árbol" lleva tilde: es otro nombre (el catálogo los compara igual que la base)
    expect(grupos.map((g) => g.filas.map((f) => f.solicitudId))).toEqual([["t1", "t3"], ["t2"], ["r1"], ["t4"]])
    expect(grupos[0]).toMatchObject({ nombre: "TALA DE ARBOL", unidad: "UND", grupo: "PRELIMINARES", valor: 50000 })
  })

  it("mismo nombre y unidad con valores distintos: ninguna de esas filas se aprueba", () => {
    const { grupos, errores } = agruparAprobaciones([ap(7, "a", "Tala", "UND", 50000), ap(8, "b", "TALA", "UND", 60000), ap(9, "c", "Otra", "UND", 1)])
    expect(grupos.map((g) => g.nombre)).toEqual(["Otra"])
    expect(errores.map((e) => e.fila)).toEqual([7, 8])
  })
})

describe("Excel de aprobación: ida y vuelta", () => {
  it("el archivo descargado, llenado y leído como lo lee la app, da las filas", async () => {
    const XLSX = await import("xlsx")
    const { construirLibroAprobacionRecursos } = await import("@/lib/excel-aprobacion-recursos")
    const libro = await construirLibroAprobacionRecursos(
      "Mano de obra por aprobar",
      [
        { id: "s1", descripcion: "Zapata en concreto", unidad: "m³", grupoSugerido: null, valorPropuesto: null, createdAt: "", solicitadoPorNombre: null, items: [item("4.1.16.4", 96.03), item("4.1.8.4", 1.6)] },
        { id: "s2", descripcion: "Tala de árbol", unidad: "und", grupoSugerido: null, valorPropuesto: null, createdAt: "", solicitadoPorNombre: null, items: [item("1.5", 53, ["1", "PRELIMINARES"])] },
      ],
      { unidades: ["UND", "M3"], grupos: ["ESTRUCTURAS", "PRELIMINARES"] },
      null
    )
    const hojaExcel = libro.getWorksheet("Por aprobar")!
    let filaEncabezado = 0
    hojaExcel.eachRow((r, n) => {
      if (String(r.getCell(2).value) === C.actividad) filaEncabezado = n
    })
    const primera = hojaExcel.getRow(filaEncabezado + 1)
    expect(primera.getCell(1).value).toBe("4 ESTRUCTURAS")
    expect(primera.getCell(2).value).toBe("Zapata en concreto")
    expect(primera.getCell(3).value).toBe("4.1.8.4, 4.1.16.4")
    expect(primera.getCell(4).value).toBe("ESTRUCTURAS") // grupo = capítulo
    expect(primera.getCell(5).value).toBe("M3") // unidad = la del ítem
    expect(primera.getCell(5).dataValidation?.type).toBe("list")
    expect(hojaExcel.getRow(filaEncabezado + 2).getCell(4).value).toBe("PRELIMINARES")
    primera.getCell(2).value = "ZAPATA 4000 PSI" // el nombre se puede cambiar
    primera.getCell(6).value = 45000
    hojaExcel.getRow(filaEncabezado + 2).getCell(7).value = "Ya existe"

    const buffer = await libro.xlsx.writeBuffer()
    const leido = XLSX.read(new Uint8Array(buffer as ArrayBuffer), { type: "array" })
    const filas = XLSX.utils.sheet_to_json<unknown[]>(leido.Sheets[leido.SheetNames[0]], { header: 1, defval: null })
    const r = leerFilasAprobacionRecursos(filas)
    expect(r.errores).toEqual([])
    expect(r.filas).toEqual([
      expect.objectContaining({ solicitudId: "s1", accion: "aprobar", actividad: "ZAPATA 4000 PSI", grupo: "ESTRUCTURAS", unidad: "M3", valor: 45000 }),
      expect.objectContaining({ solicitudId: "s2", accion: "rechazar", motivo: "Ya existe" }),
    ])
  })
})
