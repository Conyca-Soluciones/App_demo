import { describe, expect, it } from "vitest"
import { direccionesDeRequisiciones, MAX_DIRECCION_ENTREGA, normalizarDireccion, validarDireccion } from "@/lib/direccion-entrega"

describe("dirección de entrega", () => {
  it("quita espacios de más", () => {
    expect(normalizarDireccion("  Cra 5   # 10-20 \n Bodega 2 ")).toBe("Cra 5 # 10-20 Bodega 2")
    expect(normalizarDireccion(null)).toBe("")
  })

  it("es obligatoria y tiene un máximo", () => {
    expect(validarDireccion("   ")).toBe("Falta la dirección de entrega.")
    expect(validarDireccion("Obra Malecón, portería 2")).toBeNull()
    expect(validarDireccion("x".repeat(MAX_DIRECCION_ENTREGA + 1))).toMatch(/muy larga/)
  })

  it("sugiere el sitio de entrega solo si todas las requisiciones coinciden", () => {
    expect(direccionesDeRequisiciones(["Obra 1", " obra  1 ", null])).toEqual({ unica: "Obra 1", distintas: ["Obra 1"] })
    expect(direccionesDeRequisiciones(["Obra 1", "Bodega"])).toEqual({ unica: null, distintas: ["Obra 1", "Bodega"] })
    expect(direccionesDeRequisiciones([null, ""])).toEqual({ unica: null, distintas: [] })
  })
})
