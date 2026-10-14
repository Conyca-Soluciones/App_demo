import { describe, expect, it } from "vitest"
import {
  buscarInsumosPrecios,
  comparacionPrecio,
  indexarPrecios,
  mapControlProyecto,
  partesBarraPlata,
  totalesControl,
  type PrecioProveedor,
} from "@/lib/control-proyecto"

const base = mapControlProyecto({
  presupuesto: 1000,
  presupuesto_materiales: 400,
  presupuesto_mano_obra: 300,
  compras: 200,
  actas: 100,
  por_comprar: 50,
  salidas_valor: 100,
  contratado: 250,
  actas_contratadas: 100,
})

describe("totalesControl", () => {
  it("gastado = compras + actas y cada avance contra su propio total", () => {
    const t = totalesControl(base)
    expect(t.gastado).toBe(300)
    expect(t.pctGastado).toBe(30)
    expect(t.pctBodega).toBe(25) // 100 de 400 en materiales
    expect(t.pctActas).toBe(40) // 100 de 250 contratado
    expect(t.disponible).toBe(650)
  })

  it("sin base no divide entre cero", () => {
    const t = totalesControl(mapControlProyecto({}))
    expect(t.pctGastado).toBe(0)
    expect(t.pctBodega).toBe(0)
    expect(t.pctActas).toBe(0)
  })
})

describe("partesBarraPlata", () => {
  it("dentro del presupuesto, las partes suman 100", () => {
    const p = partesBarraPlata(base)
    expect(p.compras + p.actas + p.porComprar + p.disponible).toBeCloseTo(100)
    expect(p.sobrepasa).toBe(false)
  })

  it("si se pasa, la base es lo usado y marca sobrepasa", () => {
    const p = partesBarraPlata(mapControlProyecto({ presupuesto: 100, compras: 150, actas: 50 }))
    expect(p.compras).toBe(75)
    expect(p.actas).toBe(25)
    expect(p.disponible).toBe(0)
    expect(p.sobrepasa).toBe(true)
  })
})

describe("comparacionPrecio", () => {
  it("encima, debajo o sin referencia", () => {
    expect(comparacionPrecio(110, 100)).toBe("encima")
    expect(comparacionPrecio(100, 100)).toBe("debajo")
    expect(comparacionPrecio(100, null)).toBe("sin_referencia")
    expect(comparacionPrecio(100, 0)).toBe("sin_referencia")
  })
})

describe("precios por proveedor e insumo", () => {
  const p = (proveedorId: string, insumoId: string, descripcion: string, precio: number, valor: number): PrecioProveedor => ({
    proveedorId,
    insumoId,
    codigo: 1,
    descripcion,
    um: "UND",
    cantidad: 1,
    valor,
    precioPromedio: precio,
    ultima: null,
    precioPresupuesto: 100,
  })
  const precios = [p("a", "cem", "Cemento gris", 120, 500), p("b", "cem", "Cemento gris", 90, 300), p("a", "ace", "Acero 1/2", 50, 900)]

  it("indexa en una pasada y ordena", () => {
    const { porProveedor, porInsumo } = indexarPrecios(precios)
    expect(porProveedor.get("a")!.map((x) => x.insumoId)).toEqual(["ace", "cem"])
    expect(porInsumo.get("cem")!.map((x) => x.proveedorId)).toEqual(["b", "a"])
  })

  it("busca sin tildes ni mayúsculas, mínimo 2 letras", () => {
    const { porInsumo } = indexarPrecios(precios)
    expect(buscarInsumosPrecios(porInsumo, "c")).toEqual([])
    const r = buscarInsumosPrecios(porInsumo, "CEMÉNTO")
    expect(r).toHaveLength(1)
    expect(r[0].valor).toBe(800)
    expect(r[0].proveedores).toHaveLength(2)
  })
})
