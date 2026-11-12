import { describe, expect, it } from "vitest"
import { calcularNivelDesdeCodigo, nuevoStackNiveles, resolverPadreImport } from "@/lib/calcular-nivel"

// Procesa una lista de códigos en orden (como las filas del Excel).
const niveles = (codigos: string[]) => {
  const stack = nuevoStackNiveles()
  return codigos.map((c) => {
    const r = calcularNivelDesdeCodigo(c, stack)
    return r.ok ? r.nivel : r.razon
  })
}

describe("calcularNivelDesdeCodigo", () => {
  it("códigos con puntos: nivel = segmentos", () => {
    expect(niveles(["1", "1.1", "1.1.1", "4.1.1.1", "2"])).toEqual([1, 2, 3, 4, 1])
  })

  it("la coma funciona como punto", () => {
    expect(niveles(["5", "5,1", "5,1,2"])).toEqual([1, 2, 3])
  })

  it("dígitos seguidos: por contexto, de a pares", () => {
    expect(niveles(["1", "101", "10101", "10102", "102", "2"])).toEqual([1, 2, 3, 3, 2, 1])
  })

  it("un capítulo puede saltar directo a un ítem", () => {
    expect(niveles(["2", "20101"])).toEqual([1, 3])
  })

  it("capítulos de 2 dígitos", () => {
    expect(niveles(["10", "1001", "100101", "11"])).toEqual([1, 2, 3, 1])
  })

  it("se pueden mezclar los dos formatos", () => {
    expect(niveles(["1", "1.1", "2", "201"])).toEqual([1, 2, 1, 2])
  })

  it("rechaza vacíos y formatos raros", () => {
    expect(niveles(["", "A1", "1.a", "1-2"])).toEqual(["vacio", "formato_no_reconocido", "formato_no_reconocido", "formato_no_reconocido"])
  })

  it("un número largo sin capítulo abierto no se adivina", () => {
    expect(niveles(["12345"])).toEqual(["formato_no_reconocido"])
  })
})

// Padre de cada código (por código, para leer fácil), como en el import.
const padres = (codigos: string[]) => {
  const stack = nuevoStackNiveles()
  const pila: { id: string; nivel: number }[] = []
  const resultado: Record<string, string | null> = {}
  for (const c of codigos) {
    const r = calcularNivelDesdeCodigo(c, stack)
    if (!r.ok) throw new Error(c)
    resultado[c] = resolverPadreImport(pila, c, r.nivel)
  }
  return resultado
}

describe("resolverPadreImport", () => {
  it("jerarquía completa", () => {
    expect(padres(["1", "1.1", "1.1.1", "1.1.2", "1.2", "2"])).toEqual({
      "1": null, "1.1": "1", "1.1.1": "1.1", "1.1.2": "1.1", "1.2": "1", "2": null,
    })
  })

  it("nivel saltado (Malecón: 12 -> 12.1.1 sin 12.1): todos cuelgan del capítulo", () => {
    expect(padres(["11", "11.1", "11.1.1", "12", "12.1.1", "12.1.2", "12.1.3", "13", "13.1"])).toEqual({
      "11": null, "11.1": "11", "11.1.1": "11.1",
      "12": null, "12.1.1": "12", "12.1.2": "12", "12.1.3": "12",
      "13": null, "13.1": "13",
    })
  })

  it("nivel saltado con dígitos seguidos (2 -> 20101)", () => {
    expect(padres(["2", "20101", "20102", "3"])).toEqual({
      "2": null, "20101": "2", "20102": "2", "3": null,
    })
  })
})
