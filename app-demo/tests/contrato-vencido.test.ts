import { describe, expect, it } from "vitest"
import { contratoVencido, fechaFinContrato } from "@/lib/contratos"

const plazo = (cambios: Partial<Parameters<typeof fechaFinContrato>[0]> = {}) => ({
  plazoTipo: "fechas" as "fechas" | "duracion",
  fechaInicio: "2026-09-01",
  fechaFin: "2026-10-01",
  duracionCantidad: null as number | null,
  duracionUnidad: null as "dias" | "meses" | null,
  ...cambios,
})

const contrato = (cambios: Partial<Parameters<typeof contratoVencido>[0]> = {}) => ({
  ...plazo(),
  estado: "aprobada" as const,
  minutaEstado: "aprobada" as const,
  liquidadoAt: null,
  ...cambios,
})

describe("fecha fin del contrato (como _fecha_fin_contrato)", () => {
  it("por fechas: la fecha fin", () => {
    expect(fechaFinContrato(plazo())).toBe("2026-10-01")
  })
  it("por duración en días: inicio + días", () => {
    expect(fechaFinContrato(plazo({ plazoTipo: "duracion", duracionCantidad: 45, duracionUnidad: "dias" }))).toBe("2026-10-16")
  })
  it("por duración en meses: mes de calendario; fin de mes se ajusta como Postgres", () => {
    expect(fechaFinContrato(plazo({ plazoTipo: "duracion", duracionCantidad: 3, duracionUnidad: "meses" }))).toBe("2026-12-01")
    expect(fechaFinContrato(plazo({ plazoTipo: "duracion", fechaInicio: "2026-01-31", duracionCantidad: 1, duracionUnidad: "meses" }))).toBe("2026-02-28")
    expect(fechaFinContrato(plazo({ plazoTipo: "duracion", fechaInicio: "2026-11-15", duracionCantidad: 14, duracionUnidad: "meses" }))).toBe("2028-01-15")
  })
  it("duración sin fecha de inicio: no se sabe", () => {
    expect(fechaFinContrato(plazo({ plazoTipo: "duracion", fechaInicio: null, duracionCantidad: 2, duracionUnidad: "meses" }))).toBeNull()
  })
})

describe("contrato vencido (como _avisar_contratos_vencidos)", () => {
  it("vence cuando su último día ya pasó (no el mismo día)", () => {
    expect(contratoVencido(contrato(), "2026-10-02")).toEqual({ vencido: true, fechaFin: "2026-10-01" })
    expect(contratoVencido(contrato(), "2026-10-01").vencido).toBe(false)
  })
  it("solo si está aprobado por Subgerencia y sin liquidar", () => {
    expect(contratoVencido(contrato({ minutaEstado: "en_revision" }), "2026-10-16").vencido).toBe(false)
    expect(contratoVencido(contrato({ estado: "pre_aprobacion", minutaEstado: null }), "2026-10-16").vencido).toBe(false)
    expect(contratoVencido(contrato({ liquidadoAt: "2026-10-10T15:00:00Z" }), "2026-10-16").vencido).toBe(false)
  })
})
