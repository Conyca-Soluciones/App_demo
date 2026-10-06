import { describe, expect, it } from "vitest"
import { formatearFechaSinHora, hoyColombia } from "@/lib/fechas"
import { COMODIN_LISTAR, LIMITE_BUSQUEDA, LIMITE_LISTAR, limiteBusqueda, puedeBuscar } from "@/lib/busqueda"
import { TAMANO_PAGINA, cortarPagina, rangoPagina } from "@/lib/paginacion"

describe("fechas sin hora", () => {
  it("no corre el día por la zona horaria", () => {
    expect(formatearFechaSinHora("2026-10-05")).toBe("05/10/2026")
  })
  it("vacío", () => {
    expect(formatearFechaSinHora(null)).toBe("—")
  })
  it("hoy en formato AAAA-MM-DD", () => {
    expect(hoyColombia()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("búsqueda", () => {
  it("pide 2 letras salvo el comodín", () => {
    expect(puedeBuscar("a")).toBe(false)
    expect(puedeBuscar("ab")).toBe(true)
    expect(puedeBuscar(COMODIN_LISTAR)).toBe(true)
    expect(puedeBuscar(null)).toBe(false)
  })
  it("el comodín lista más", () => {
    expect(limiteBusqueda(COMODIN_LISTAR)).toBe(LIMITE_LISTAR)
    expect(limiteBusqueda("cemento")).toBe(LIMITE_BUSQUEDA)
  })
})

describe("paginación", () => {
  it("pide una fila de más para saber si hay otra página", () => {
    expect(rangoPagina(0)).toEqual([0, TAMANO_PAGINA])
    expect(rangoPagina(2)).toEqual([2 * TAMANO_PAGINA, 3 * TAMANO_PAGINA])
  })
  it("corta la fila extra", () => {
    const filas = Array.from({ length: TAMANO_PAGINA + 1 }, (_, i) => i)
    expect(cortarPagina(filas)).toEqual({ filas: filas.slice(0, TAMANO_PAGINA), hayMas: true })
    expect(cortarPagina([1, 2])).toEqual({ filas: [1, 2], hayMas: false })
  })
})
