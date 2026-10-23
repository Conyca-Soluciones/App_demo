import { describe, expect, it } from "vitest"
import { COLUMNAS_EXCEL_INVENTARIO, valoresFilaInventario } from "@/lib/exportar-inventario"

describe("Excel del inventario", () => {
  it("una celda por columna, en el orden de la tabla; UM vacía si no tiene", () => {
    const valores = valoresFilaInventario({
      insumoCodigo: 559,
      insumoDescripcion: "CEMENTO BLANCO",
      insumoUm: null,
      cantidadEntrada: 100,
      cantidadSalida: 40,
      cantidadDisponible: 60,
      costoPromedio: 1500,
      valorInventario: 90000,
    })
    expect(valores).toHaveLength(COLUMNAS_EXCEL_INVENTARIO.length)
    expect(valores).toEqual([559, "CEMENTO BLANCO", "", 100, 40, 60, 1500, 90000])
  })
})
