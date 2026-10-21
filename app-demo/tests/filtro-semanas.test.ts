import { describe, expect, it } from "vitest"
import { resumirNumeros } from "@/components/selector-numeros"
import { fechasSemanaIso, semanaIso, semanasDelAnio } from "@/lib/pagos"

describe("filtro de años y semanas del consolidado", () => {
  it("resume la selección en tramos", () => {
    expect(resumirNumeros([42])).toBe("42")
    expect(resumirNumeros([40, 41])).toBe("40, 41")
    expect(resumirNumeros([45, 40, 41, 42])).toBe("40–42, 45")
    expect(resumirNumeros([1, 2, 3, 10, 11, 20])).toBe("1–3, 10, 11, 20")
  })

  it("da el lunes y el domingo de la semana ISO", () => {
    expect(fechasSemanaIso(2026, 42)).toBe("12/10/2026 al 18/10/2026")
    expect(fechasSemanaIso(2026, 1)).toBe("29/12/2025 al 04/01/2026")
    // Cada día de la semana cae en la misma semana ISO.
    expect(semanaIso(new Date("2026-10-12T15:00:00Z"))).toEqual({ anio: 2026, semana: 42 })
    expect(semanaIso(new Date("2026-10-18T15:00:00Z"))).toEqual({ anio: 2026, semana: 42 })
  })

  it("sabe si el año tiene 52 o 53 semanas", () => {
    expect(semanasDelAnio(2026)).toBe(53)
    expect(semanasDelAnio(2027)).toBe(52)
  })
})
