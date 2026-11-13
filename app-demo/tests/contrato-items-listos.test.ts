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
