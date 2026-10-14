import { describe, expect, it } from "vitest"
import { formatoCantidadExcel, valoresFilaExcel, type FilaExcelRequisicion } from "@/lib/exportar-requisiciones"

const fila = (cambios: Partial<FilaExcelRequisicion> = {}): FilaExcelRequisicion => ({
  numero: 34,
  proyecto: "P-01 — Obra",
  solicitadoPor: "Ana",
  insumoCodigo: 559,
  insumo: "CEMENTO BLANCO",
  unidad: "KG",
  cantidad: 96,
  fechaRequisicion: "2026-10-14T15:00:00Z",
  fechaRequerida: "2026-10-20",
  estado: "aprobada",
  estadoCompra: "pendiente",
  ...cambios,
})

describe("Excel del registro de requisiciones", () => {
  it("cantidad entera sin punto; con decimales, hasta dos", () => {
    expect(formatoCantidadExcel(96)).toBe("#,##0")
    expect(formatoCantidadExcel(96.5)).toBe("#,##0.##")
  })
  it("estado de la compra al final; vacío si no aplica", () => {
    expect(valoresFilaExcel(fila()).slice(-2)).toEqual(["Aprobada", "Pendiente"])
    expect(valoresFilaExcel(fila({ estado: "rechazada", estadoCompra: null })).slice(-2)).toEqual(["Rechazada", ""])
    expect(valoresFilaExcel(fila({ estadoCompra: "rechazada_compras" })).at(-1)).toBe("Rechazada por Compras")
  })
})
