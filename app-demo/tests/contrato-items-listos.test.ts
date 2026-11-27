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

describe("motivoItemNoListo con la mano de obra dividida (20270101007900)", () => {
  const aprobado = { categoriaId: "fab", nombre: "Fabricación", valorTope: 100, contratado: 0, disponible: 15 }
  const pendiente = { categoriaId: "", nombre: "Instalación", valorTope: 0, contratado: 0, disponible: 0, pendiente: true }
  const loseta = {
    modalidad: "mano_obra" as const,
    manoObraPendiente: true,
    manoObraPendienteSinDividir: false,
    trabajos: [aprobado, pendiente],
  }
  it("el trabajo aprobado se contrata aunque otro siga en aprobación", () => {
    expect(motivoItemNoListo(loseta, "mano_obra", "fab")).toBeNull()
  })
  it("el ítem se puede elegir en el buscador", () => {
    expect(motivoItemNoListo(loseta, "mano_obra")).toBeNull()
  })
  it("la mano de obra completa espera a que se aprueben todos", () => {
    expect(motivoItemNoListo(loseta, "mano_obra", null)).toMatch(/trabajos ya aprobados/)
    expect(motivoItemNoListo(loseta, "mano_obra", "")).toMatch(/trabajos ya aprobados/)
  })
  it("otra mano de obra pendiente fuera de la división frena todo", () => {
    expect(motivoItemNoListo({ ...loseta, manoObraPendienteSinDividir: true }, "mano_obra", "fab")).toMatch(/mano de obra de su APU/)
  })
  it("sin ningún trabajo aprobado sigue frenado", () => {
    expect(motivoItemNoListo({ ...loseta, trabajos: [pendiente, { ...pendiente, nombre: "Otro" }] }, "mano_obra")).toMatch(
      /mano de obra de su APU/
    )
  })
})
