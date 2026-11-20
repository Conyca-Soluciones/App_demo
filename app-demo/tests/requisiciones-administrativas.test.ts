import { describe, expect, it } from "vitest"
import {
  MAX_LINEAS_REQ_ADMINISTRATIVA,
  etapaReqAdministrativa,
  etapaReqEspera,
  lineasParaGuardar,
  nuevosParaGuardar,
  mapDetalleReqAdministrativa,
  validarReqAdministrativa,
  type LineaFormReqAdministrativa,
} from "@/lib/requisiciones-administrativas"

const linea = (p: Partial<LineaFormReqAdministrativa> = {}): LineaFormReqAdministrativa => ({
  insumoId: "i1",
  codigo: 101,
  descripcion: "Resma papel carta",
  unidad: "UND",
  cantidad: "10",
  ...p,
})

describe("requisición administrativa (FUNCIONAMIENTO)", () => {
  const hoy = "2026-11-06"

  it("pide fecha requerida desde hoy, al menos un insumo y cantidades enteras", () => {
    expect(validarReqAdministrativa([linea()], hoy, hoy)).toBeNull()
    expect(validarReqAdministrativa([linea()], "", hoy)).toMatch(/fecha requerida/)
    expect(validarReqAdministrativa([linea()], "2026-11-05", hoy)).toMatch(/anterior a hoy/)
    expect(validarReqAdministrativa([], hoy, hoy)).toMatch(/al menos un insumo/)
    expect(validarReqAdministrativa([linea({ cantidad: "1,5" })], hoy, hoy)).toMatch(/entero/)
    expect(validarReqAdministrativa([linea({ cantidad: "0" })], hoy, hoy)).toMatch(/mayor que cero/)
    expect(validarReqAdministrativa([linea(), linea()], hoy, hoy)).toMatch(/repetido/)
    expect(validarReqAdministrativa([linea()], hoy, hoy, null)).toMatch(/FUNCIONAMIENTO o el proyecto/)
    expect(validarReqAdministrativa([linea()], hoy, hoy, "p1")).toBeNull()
  })

  it("manda insumo y cantidad (1.500 = 1500)", () => {
    expect(lineasParaGuardar([linea({ cantidad: "1.500" })])).toEqual([{ insumo_id: "i1", cantidad: 1500 }])
  })

  it("estado que ve quien la pidió", () => {
    expect(etapaReqAdministrativa({ estado: "aprobada", estadoCompra: "pendiente" }).etiqueta).toBe("En Compras")
    expect(etapaReqAdministrativa({ estado: "aprobada", estadoCompra: "completa" }).etiqueta).toBe("Comprada")
    expect(etapaReqAdministrativa({ estado: "aprobada", estadoCompra: "parcial" }).etiqueta).toBe("Compra parcial")
    expect(etapaReqAdministrativa({ estado: "aprobada", estadoCompra: "rechazada_compras" }).etiqueta).toBe("Rechazada por Compras")
    expect(etapaReqAdministrativa({ estado: "cancelada", estadoCompra: null }).etiqueta).toBe("Cancelada")
    expect(etapaReqAdministrativa({ estado: "pendiente", estadoCompra: "pendiente" }).etiqueta).toBe("Por aprobar (Subgerencia)")
    expect(etapaReqAdministrativa({ estado: "rechazada", estadoCompra: null }).etiqueta).toBe("Rechazada por Subgerencia")
  })

  it("detalle con sus líneas", () => {
    const d = mapDetalleReqAdministrativa({
      id: "r1",
      numero: 12,
      estado: "aprobada",
      estado_compra: "pendiente",
      fecha_requerida: "2026-11-10",
      urgente: true,
      cancelable: true,
      es_mia: true,
      lineas: [{ id: "p1", insumo_codigo: 101, insumo_descripcion: "Resma", unidad: "UND", cantidad: 10, estado: "aprobado", comprado: 4 }],
    })
    expect(d).toMatchObject({ numero: 12, nLineas: 1, urgente: true, cancelable: true })
    expect(d.lineas[0]).toMatchObject({ cantidad: 10, comprado: 4, rechazadoCompras: false })
    expect(d.modificable).toBe(false)
  })

  it("detalle modificable trae el proyecto y el insumo de cada línea", () => {
    const d = mapDetalleReqAdministrativa({
      id: "r2",
      numero: 3,
      estado: "pendiente",
      modificable: true,
      proyecto_id: "py1",
      lineas: [{ id: "p1", insumo_id: "i9", insumo_codigo: 101, insumo_descripcion: "Resma", cantidad: 2, estado: "pendiente" }],
    })
    expect(d).toMatchObject({ modificable: true, proyectoId: "py1" })
    expect(d.lineas[0].insumoId).toBe("i9")
  })
})

describe("requisición con insumos nuevos (en espera)", () => {
  const nuevo = (cantidad: string, descripcion = "RESMA CARTA", unidad = "UNIDAD - UND") => ({
    clave: descripcion,
    descripcion,
    unidad,
    cantidad,
  })

  it("acepta una requisición solo con insumos nuevos", () => {
    expect(validarReqAdministrativa([], "2099-01-01", "2026-11-20", "p", [nuevo("3")])).toBeNull()
  })

  it("pide nombre, unidad y cantidad entera en los insumos nuevos", () => {
    expect(validarReqAdministrativa([], "2099-01-01", "2026-11-20", "p", [nuevo("3", " ")])).toMatch(/nombre/)
    expect(validarReqAdministrativa([], "2099-01-01", "2026-11-20", "p", [nuevo("3", "X", "")])).toMatch(/unidad/)
    expect(validarReqAdministrativa([], "2099-01-01", "2026-11-20", "p", [nuevo("0")])).toMatch(/mayor que cero/)
    expect(validarReqAdministrativa([], "2099-01-01", "2026-11-20", "p", [nuevo("1,5")])).not.toBeNull()
  })

  it("cuenta los insumos nuevos en el máximo de líneas", () => {
    const muchos = Array.from({ length: MAX_LINEAS_REQ_ADMINISTRATIVA + 1 }, (_, i) => nuevo("1", `INSUMO ${i}`))
    expect(validarReqAdministrativa([], "2099-01-01", "2026-11-20", "p", muchos)).toMatch(/máximo/)
  })

  it("nuevosParaGuardar convierte la cantidad", () => {
    expect(nuevosParaGuardar([nuevo("1.500", " RESMA ")])).toEqual([{ descripcion: "RESMA", unidad: "UNIDAD - UND", cantidad: 1500 }])
  })

  it("etapaReqEspera dice qué falta", () => {
    const base = { estado: "esperando" as const, nuevos: [] as { estado: "esperando" | "aprobado" | "rechazado" }[] }
    expect(etapaReqEspera({ ...base, estado: "error" } as never).etiqueta).toBe("No se pudo enviar")
    expect(etapaReqEspera({ ...base, nuevos: [{ estado: "rechazado" }, { estado: "esperando" }] } as never).etiqueta).toMatch(/1 insumo\(s\) rechazado/)
    expect(etapaReqEspera({ ...base, nuevos: [{ estado: "aprobado" }, { estado: "esperando" }] } as never).etiqueta).toMatch(/1 insumo\(s\) nuevo/)
  })
})
