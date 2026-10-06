import { describe, expect, it } from "vitest"
import { buscarSimilares, normalizar } from "@/lib/similitud-texto"

const candidatos = [
  { id: "1", texto: "Columna en concreto 0.25x0.25", unidad: "ml" },
  { id: "2", texto: "Columna en concreto 0.30x0.30", unidad: "ml" },
  { id: "3", texto: "Pañete liso muros interiores", unidad: "m2" },
  { id: "4", texto: "Cemento gris x 50 kg", unidad: "bulto" },
]

describe("normalizar", () => {
  it("mayúsculas y sin tildes", () => {
    expect(normalizar("PAÑETE Liso")).toBe("PANETE LISO")
  })
})

describe("buscarSimilares", () => {
  it("lo más parecido va primero y lo que no tiene relación no aparece", () => {
    const r = buscarSimilares("pañete liso muros", "m2", candidatos)
    expect(r[0].candidato.id).toBe("3")
    expect(r.map((x) => x.candidato.id)).not.toContain("4")
  })

  it("la medida distinta baja en el ranking pero sigue apareciendo", () => {
    const r = buscarSimilares("columna concreto 0.25x0.25", "ml", candidatos)
    expect(r[0].candidato.id).toBe("1")
    const otra = r.find((x) => x.candidato.id === "2")
    expect(otra?.detalle.medidaDistinta).toBe(true)
  })

  it("respeta top y umbral", () => {
    expect(buscarSimilares("columna concreto", "ml", candidatos, { top: 1 })).toHaveLength(1)
    expect(buscarSimilares("columna concreto", "ml", candidatos, { umbral: 1.01 })).toHaveLength(0)
    expect(buscarSimilares("algo", null, [])).toEqual([])
  })
})
