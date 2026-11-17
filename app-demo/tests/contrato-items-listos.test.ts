import { describe, expect, it } from "vitest"
import { motivoItemNoListo } from "@/lib/contratos"

describe("contratos de obra y mano de obra solo con ítems listos", () => {
  it("mano de obra: solo bloquea si falta la mano de obra", () => {
    expect(motivoItemNoListo({ pendientes: 3, manoObraPendiente: true }, "mano_obra")).toMatch(/mano de obra/)
    expect(motivoItemNoListo({ pendientes: 3, manoObraPendiente: false }, "mano_obra")).toBeNull()
  })
  it("obra: bloquea con cualquier línea pendiente; otros tipos no", () => {
    expect(motivoItemNoListo({ pendientes: 2, manoObraPendiente: false }, "obra")).toBe("Su APU tiene 2 línea(s) sin resolver")
    expect(motivoItemNoListo({ pendientes: 0 }, "obra")).toBeNull()
    expect(motivoItemNoListo({ pendientes: 5, manoObraPendiente: true }, "suministro_instalacion")).toBeNull()
  })
})

describe("motivoItemNoListo por modalidad (20270101003900)", () => {
  it("todo costo solo va en contrato de obra", () => {
    expect(motivoItemNoListo({ modalidad: "todo_costo" }, "mano_obra")).toMatch(/todo costo/)
    expect(motivoItemNoListo({ modalidad: "todo_costo" }, "obra")).toBeNull()
  })
  it("subcontrato de mano de obra solo va en contrato de mano de obra", () => {
    expect(motivoItemNoListo({ modalidad: "mano_obra" }, "obra")).toMatch(/contrato de mano de obra/)
    expect(motivoItemNoListo({ modalidad: "mano_obra" }, "mano_obra")).toBeNull()
  })
  it("administración no va en contrato de obra ni de mano de obra", () => {
    expect(motivoItemNoListo({ modalidad: "administracion" }, "obra")).toMatch(/administración/)
    expect(motivoItemNoListo({ modalidad: "administracion" }, "mano_obra")).toMatch(/administración/)
    expect(motivoItemNoListo({ modalidad: "administracion" }, "suministro_instalacion")).toBeNull()
  })
  it("sin modalidad: como antes", () => {
    expect(motivoItemNoListo({ modalidad: null }, "obra")).toBeNull()
  })
})
