import { describe, expect, it } from "vitest"
import { valoresFilaCompras } from "@/lib/exportar-pedidos-compra"
import type { PedidoParaComprar } from "@/app/(app)/almacen/comprar-pedidos/actions"

const base = {
  id: "p1",
  requisicionId: "r1",
  requisicionCodigo: "RQ-002-0004",
  requisicionNumero: 4,
  urgente: true,
  proyectoTexto: "002-CAPACITACION",
  itemCodigo: "9.2.2",
  insumoCodigo: 2781,
  insumoDescripcion: 'ADAPTADOR MACHO PVC 1/2"',
  um: "UNIDAD - UND",
  cantidad: 3,
  cantidadPendiente: 2,
  valorUnitarioProyectado: 378,
  solicitadoPorNombre: "Ana",
  fechaPedido: "2026-11-24T02:30:00Z", // 23/11 en Colombia
  fechaRequerida: "2026-11-30",
  direccionEntrega: "Bodega",
  observaciones: null,
} as unknown as PedidoParaComprar

describe("Excel de Requisiciones por comprar", () => {
  it("arma la fila con la unidad abreviada, las fechas de Colombia y el enlace a los anexos", () => {
    const v = valoresFilaCompras(base, 2)
    expect(v).toMatchObject({ ref: "RQ-002-0004", urgente: "Sí", um: "UND", porComprar: 2, pedida: 3, anexos: "Ver anexos (2)" })
    expect(v.fechaPedido?.toISOString().slice(0, 10)).toBe("2026-11-23")
    expect(v.fechaRequerida?.toISOString().slice(0, 10)).toBe("2026-11-30")
  })

  it("sin anexos la celda queda vacía; con uno, en singular", () => {
    expect(valoresFilaCompras({ ...base, urgente: false } as PedidoParaComprar, 0)).toMatchObject({ urgente: "", anexos: "" })
    expect(valoresFilaCompras(base, 1).anexos).toBe("Ver anexo")
  })
})
