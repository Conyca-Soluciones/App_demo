import { describe, expect, it } from "vitest"
import {
  etapaReqAdministrativa,
  lineasParaGuardar,
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
    expect(etapaReqAdministrativa({ estado: "aprobada", estadoCompra: "rechazada_compras" }).etiqueta).toBe("Rechazada por Compras")
    expect(etapaReqAdministrativa({ estado: "cancelada", estadoCompra: null }).etiqueta).toBe("Cancelada")
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
  })
})
