// Filtro por semana de creación de los consolidados: rangos lunes a lunes en
// hora de Colombia (UTC-5).

import { describe, expect, it } from "vitest"
import { rangosSemanasIso, semanaIso } from "@/lib/pagos"

describe("rangosSemanasIso", () => {
  it("sin nada elegido no filtra", () => {
    expect(rangosSemanasIso([], [], [2026])).toEqual([])
  })
  it("una semana: lunes 00:00 a lunes 00:00 en Colombia", () => {
    expect(rangosSemanasIso([2026], [43], [])).toEqual([{ desde: "2026-10-19T05:00:00.000Z", hasta: "2026-10-26T05:00:00.000Z" }])
  })
  it("junta las semanas seguidas y separa las demás", () => {
    const r = rangosSemanasIso([2026], [41, 42, 44], [])
    expect(r).toEqual([
      { desde: "2026-10-05T05:00:00.000Z", hasta: "2026-10-19T05:00:00.000Z" },
      { desde: "2026-10-26T05:00:00.000Z", hasta: "2026-11-02T05:00:00.000Z" },
    ])
  })
  it("año completo y semana 53 solo donde existe", () => {
    expect(rangosSemanasIso([2026], [], [])).toEqual([{ desde: "2025-12-29T05:00:00.000Z", hasta: "2027-01-04T05:00:00.000Z" }])
    expect(rangosSemanasIso([2026, 2027], [53], [])).toEqual([{ desde: "2026-12-28T05:00:00.000Z", hasta: "2027-01-04T05:00:00.000Z" }])
  })
  it("coincide con semanaIso en los bordes", () => {
    const [{ desde, hasta }] = rangosSemanasIso([2026], [43], [])
    expect(semanaIso(new Date(desde))).toEqual({ anio: 2026, semana: 43 })
    expect(semanaIso(new Date(Date.parse(hasta) - 1))).toEqual({ anio: 2026, semana: 43 })
    expect(semanaIso(new Date(hasta))).toEqual({ anio: 2026, semana: 44 })
  })
})
