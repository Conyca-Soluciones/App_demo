import { describe, expect, it } from "vitest"
import { numeroALetrasCOP, numeroATexto } from "@/lib/numero-a-letras"

describe("numeroATexto", () => {
  it.each([
    [0, "cero"],
    [1, "uno"],
    [15, "quince"],
    [16, "dieciséis"],
    [21, "veintiuno"],
    [22, "veintidós"],
    [23, "veintitrés"],
    [26, "veintiséis"],
    [30, "treinta"],
    [31, "treinta y uno"],
    [99, "noventa y nueve"],
    [100, "cien"],
    [101, "ciento uno"],
    [500, "quinientos"],
    [1000, "mil"],
    [2001, "dos mil uno"],
    [21_000, "veintiún mil"],
    [101_000, "ciento un mil"],
    [1_000_000, "un millón"],
    [1_001_000, "un millón mil"],
    [2_500_000, "dos millones quinientos mil"],
    [31_000_000, "treinta y un millones"],
    [1_000_000_000, "mil millones"],
    [2_500_000_000, "dos mil quinientos millones"],
    [999_999_999_999, "novecientos noventa y nueve mil novecientos noventa y nueve millones novecientos noventa y nueve mil novecientos noventa y nueve"],
  ])("%d -> %s", (n, texto) => {
    expect(numeroATexto(n)).toBe(texto)
  })

  it("con apócope (delante de un sustantivo)", () => {
    expect(numeroATexto(1, true)).toBe("un")
    expect(numeroATexto(21, true)).toBe("veintiún")
    expect(numeroATexto(31, true)).toBe("treinta y un")
    expect(numeroATexto(11, true)).toBe("once")
  })

  it("fuera de rango o no entero: en cifras", () => {
    expect(numeroATexto(1e12)).toBe("1000000000000")
    expect(numeroATexto(-5)).toBe("-5")
    expect(numeroATexto(1.5)).toBe("1.5")
  })
})

describe("numeroALetrasCOP", () => {
  it.each([
    [1, "UN PESO M/CTE"],
    [21, "VEINTIÚN PESOS M/CTE"],
    [15_500, "QUINCE MIL QUINIENTOS PESOS M/CTE"],
    [21_000, "VEINTIÚN MIL PESOS M/CTE"],
    [1_000_000, "UN MILLÓN DE PESOS M/CTE"],
    [9_000_000, "NUEVE MILLONES DE PESOS M/CTE"],
    [1_200_000, "UN MILLÓN DOSCIENTOS MIL PESOS M/CTE"],
    [31_000_000, "TREINTA Y UN MILLONES DE PESOS M/CTE"],
    [1_250_000_000, "MIL DOSCIENTOS CINCUENTA MILLONES DE PESOS M/CTE"],
  ])("%d", (n, texto) => {
    expect(numeroALetrasCOP(n)).toBe(texto)
  })

  it("con centavos", () => {
    expect(numeroALetrasCOP(1500.5)).toBe("MIL QUINIENTOS PESOS CON CINCUENTA CENTAVOS M/CTE")
    expect(numeroALetrasCOP(2.01)).toBe("DOS PESOS CON UN CENTAVO M/CTE")
  })

  it("redondea bien los centavos (no '100 centavos')", () => {
    expect(numeroALetrasCOP(1.996)).toBe("DOS PESOS M/CTE")
  })
})
