import { describe, expect, it } from "vitest"
import { claveLinea, compararApu, compararVersion, hayDiferencias, type ItemExcel, type ItemVigente } from "@/lib/comparar-version"

const vig = (p: Partial<ItemVigente> & { codigo: string }): ItemVigente => ({
  descripcion: `Ítem ${p.codigo}`,
  unidad: "m2",
  cantidad: 10,
  precioOficial: 1000,
  esHoja: true,
  tieneApu: true,
  modalidad: null,
  conRequisiciones: false,
  conContratos: false,
  lineas: [],
  ...p,
})
const exc = (p: Partial<ItemExcel> & { codigo: string }): ItemExcel => ({
  descripcion: `Ítem ${p.codigo}`,
  unidad: "m2",
  cantidad: 10,
  precioOficial: 1000,
  esHoja: true,
  esGlobal: false,
  lineas: [],
  ...p,
})
const L = (descripcion: string, cantidad: number, tipo = "INSUMO") => ({ tipo, descripcion, unidad: "und", cantidad })

describe("comparar el Excel con la versión vigente", () => {
  it("sin diferencias", () => {
    const r = compararVersion([vig({ codigo: "1.1", lineas: [L("Cemento", 2)] })], [exc({ codigo: "1.1", lineas: [L("cemento ", 2)] })])
    expect(r.sinCambios).toBe(1)
    expect(hayDiferencias(r)).toBe(false)
  })

  it("ítems nuevos y quitados", () => {
    const r = compararVersion([vig({ codigo: "1.1" }), vig({ codigo: "1.2" })], [exc({ codigo: "1.1" }), exc({ codigo: "1.3" })])
    expect(r.nuevos.map((i) => i.codigo)).toEqual(["1.3"])
    expect(r.quitados.map((i) => i.codigo)).toEqual(["1.2"])
    expect(r.alertas).toEqual([])
  })

  it("no deja quitar un ítem con requisiciones o contratos (alerta)", () => {
    const r = compararVersion([vig({ codigo: "1.2", conContratos: true })], [])
    expect(r.quitados[0].conMovimientos).toBe(true)
    expect(r.alertas[0]).toMatchObject({ tipo: "quitado_con_movimientos", codigo: "1.2" })
  })

  it("cambios de cantidad, descripción, unidad y precio oficial (sin mayúsculas ni espacios de más)", () => {
    const r = compararVersion(
      [vig({ codigo: "2.1", descripcion: "Muro  en bloque", unidad: "M2", cantidad: 10, precioOficial: 1000 })],
      [exc({ codigo: "2.1", descripcion: "muro en bloque", unidad: "m²", cantidad: 12.5, precioOficial: 1200 })]
    )
    expect(r.cambios[0].campos.map((c) => c.campo)).toEqual(["cantidad", "precioOficial"])
  })

  it("avisa si baja la cantidad de un ítem con requisiciones", () => {
    const r = compararVersion([vig({ codigo: "3.1", cantidad: 10, conRequisiciones: true })], [exc({ codigo: "3.1", cantidad: 8 })])
    expect(r.alertas[0]).toMatchObject({ tipo: "baja_con_movimientos" })
  })

  it("APU: líneas nuevas, quitadas y con otra cantidad (las repetidas se emparejan en orden)", () => {
    const c = compararApu(
      [L("Arena", 1), L("Arena", 2), L("Cuadrilla AA", 0.5, "MO"), L("Puntilla", 1)],
      [L("Arena", 1), L("Arena", 3), L("Cuadrilla AA", 0.5, "MO"), L("Alambre", 1)]
    )
    expect(c.nuevas.map((l) => l.descripcion)).toEqual(["Alambre"])
    expect(c.quitadas.map((l) => l.descripcion)).toEqual(["Puntilla"])
    expect(c.cantidades).toEqual([{ tipo: "INSUMO", descripcion: "Arena", unidad: "und", antes: 2, ahora: 3 }])
  })

  it("el tipo no cuenta (el import reclasifica: Volqueta EQUIPO -> TRANSPORTE)", () => {
    const c = compararApu([L("Volqueta (6 m3)", 0.3, "TRANSPORTE")], [L("Volqueta (6 m3)", 0.3, "EQUIPO")])
    expect(c.nuevas).toHaveLength(0)
    expect(c.quitadas).toHaveLength(0)
  })

  it("cantidad vacía cuenta como 0 (capítulos y líneas sin cantidad)", () => {
    const r = compararVersion(
      [vig({ codigo: "1", esHoja: false, cantidad: 0, precioOficial: null, tieneApu: false })],
      [exc({ codigo: "1", esHoja: false, cantidad: null, precioOficial: null, lineas: null })]
    )
    expect(r.sinCambios).toBe(1)
  })

  it("alerta cuando un ítem con APU no trae bloque (salvo globales y todo costo sin líneas)", () => {
    const r = compararVersion(
      [vig({ codigo: "10.1.1", lineas: [L("Cable", 1)] }), vig({ codigo: "10.1.2" }), vig({ codigo: "7.1", modalidad: "todo_costo" })],
      [exc({ codigo: "10.1.1", lineas: null }), exc({ codigo: "10.1.2", lineas: null, esGlobal: true }), exc({ codigo: "7.1", lineas: null })]
    )
    expect(r.alertas.map((a) => [a.tipo, a.codigo])).toEqual([["pierde_apu", "10.1.1"]])
  })

  it("alerta cuando un ítem sin APU sí trae bloque", () => {
    const r = compararVersion([vig({ codigo: "5.1", tieneApu: false })], [exc({ codigo: "5.1", lineas: [L("Pintura", 1)] })])
    expect(r.alertas[0]).toMatchObject({ tipo: "gana_apu" })
    expect(r.apus[0].nuevas).toHaveLength(1)
  })

  it("los capítulos no comparan precio ni APU", () => {
    const r = compararVersion(
      [vig({ codigo: "1", esHoja: false, precioOficial: null, cantidad: null, tieneApu: false })],
      [exc({ codigo: "1", esHoja: false, precioOficial: 5, cantidad: null, lineas: null })]
    )
    expect(r.sinCambios).toBe(1)
  })

  it("la tilde, el superíndice y la puntuación no hacen distinta una línea", () => {
    const c = compararApu(
      [L("Volqueta (6 m3)", 0.115, "EQUIPO"), L("Cuadrilla AA (Albañilería)", 0.45, "MO"), L("Concreto 3000 psi 210 kg/cm2", 0.1)],
      [L("Volqueta (6 m³)", 0.115, "EQUIPO"), L("Cuadrilla AA (Albañileria)", 0.45, "MO"), L("Concreto 3000 psi 210 kg/cm²", 0.1)]
    )
    expect(c.nuevas).toHaveLength(0)
    expect(c.quitadas).toHaveLength(0)
    expect(c.cantidades).toHaveLength(0)
    expect(claveLinea('Tubo PVC 1/2"')).not.toBe(claveLinea('Tubo PVC 12"'))
  })
})
