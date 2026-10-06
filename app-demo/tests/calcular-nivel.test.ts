import { describe, expect, it } from "vitest"
import { calcularNivelDesdeCodigo, nuevoStackNiveles } from "@/lib/calcular-nivel"

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
