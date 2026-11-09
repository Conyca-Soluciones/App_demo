import { describe, expect, it } from "vitest"
import { formatoCantidadExcel, valoresFilaExcel, type FilaExcelRequisicion } from "@/lib/exportar-requisiciones"

const fila = (cambios: Partial<FilaExcelRequisicion> = {}): FilaExcelRequisicion => ({
  codigo: "RQ-001-0034",
  proyecto: "P-01 — Obra",
  solicitadoPor: "Ana",
  insumoCodigo: 559,
  insumo: "CEMENTO BLANCO",
  unidad: "KG",
  cantidad: 96,
  fechaRequisicion: "2026-10-14T15:00:00Z",
  fechaRequerida: "2026-10-20",
  fechaEstimada: null,
  estado: "aprobada",
  estadoCompra: "pendiente",
  extraordinaria: false,
  ...cambios,
})

describe("Excel del registro de requisiciones", () => {
  it("cantidad entera sin punto; con decimales, hasta dos", () => {
    expect(formatoCantidadExcel(96)).toBe("#,##0")
    expect(formatoCantidadExcel(96.5)).toBe("#,##0.##")
  })
  it("estado de la compra antes del tipo; vacío si no aplica", () => {
    expect(valoresFilaExcel(fila()).slice(-3, -1)).toEqual(["Aprobada", "Pendiente"])
    expect(valoresFilaExcel(fila({ estado: "rechazada", estadoCompra: null })).slice(-3, -1)).toEqual(["Rechazada", ""])
    expect(valoresFilaExcel(fila({ estadoCompra: "rechazada_compras" })).at(-2)).toBe("Rechazada por Compras")
  })
  it("fecha estimada de entrega después de la requerida; vacía si no hay", () => {
    expect(valoresFilaExcel(fila()).at(8)).toBeNull()
    expect(valoresFilaExcel(fila({ fechaEstimada: "2026-10-25" })).at(8)).toEqual(new Date(Date.UTC(2026, 9, 25)))
  })
  it("tipo al final: normal o extraordinaria", () => {
    expect(valoresFilaExcel(fila()).at(-1)).toBe("Normal")
    expect(valoresFilaExcel(fila({ extraordinaria: true })).at(-1)).toBe("Extraordinaria")
  })
})
