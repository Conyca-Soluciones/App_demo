import { describe, expect, it, vi, beforeEach } from "vitest"

// Cliente de Supabase falso: guarda cada llamada y responde desde memoria.
// Sirve para medir cuántas idas a la base hace "Guardar todos" y que
// ninguna lleve cientos de ids en la URL (eso daba 400).
type Llamada = { tabla: string; op: string; inIds: number; filas?: number }
const llamadas: Llamada[] = []
let revisiones: Map<string, any>
const itemApu = new Map<string, any>()

function builder(tabla: string) {
  const estado: any = { tabla, op: "select", filtros: [] as [string, any][], inIds: 0 }
  const b: any = {
    select: () => b,
    order: () => b,
    range: () => b,
    eq: (col: string, v: any) => (estado.filtros.push([col, v]), b),
    is: () => b,
    in: (col: string, vs: any[]) => ((estado.inIds = vs.length), estado.filtros.push([col, new Set(vs)]), b),
    update: (valores: any) => ((estado.op = "update"), (estado.valores = valores), b),
    delete: () => ((estado.op = "delete"), b),
    insert: (valores: any) => ((estado.op = "insert"), (estado.valores = valores), b),
    then: (res: any, rej: any) => Promise.resolve(ejecutar(estado)).then(res, rej),
  }
  return b
}

function coincide(fila: any, filtros: [string, any][]) {
  return filtros.every(([col, v]) => (v instanceof Set ? v.has(fila[col]) : fila[col] === v))
}

function ejecutar(e: any) {
  const filas = Array.isArray(e.valores) ? e.valores.length : undefined
  llamadas.push({ tabla: e.tabla, op: e.op, inIds: e.inIds, filas })
  if (e.tabla === "apu_import_revision") {
    const todas = Array.from(revisiones.values()).filter((f) => coincide(f, e.filtros))
    if (e.op === "update") for (const f of todas) Object.assign(f, e.valores)
    return { data: e.op === "select" ? todas.map((f) => ({ ...f, presupuesto_items: { descripcion: "x" } })) : null, error: null }
  }
  if (e.tabla === "item_apu") {
    if (e.op === "insert") {
      const lista = Array.isArray(e.valores) ? e.valores : [e.valores]
      if (lista.some((f: any) => f.factor_unidad == null)) return { data: null, error: { message: "factor null" } }
      for (const f of lista) itemApu.set(f.id, f)
    }
    return { data: null, error: null }
  }
  if (e.tabla === "maestro_insumos") {
    const ids = Array.from(e.filtros[0][1] as Set<string>)
    return { data: ids.map((id) => ({ id, u_m: "UNIDAD - UND", unidad_uso: null, contenido: null })), error: null }
  }
  if (e.tabla === "mano_obra_categorias" || e.tabla === "equipo_categorias") {
    const ids = Array.from(e.filtros[0][1] as Set<string>)
    return { data: ids.map((id) => ({ id, valor_unitario: 1000 })), error: null }
  }
  if (e.tabla === "presupuesto_items") {
    const ids = Array.from(e.filtros[0][1] as Set<string>)
    return { data: ids.map((id) => ({ id, apu_id: "apu-" + id, valor_unitario: 1, valor_total: 1 })), error: null }
  }
  return { data: [], error: null }
}

const clienteFalso = {
  from: (tabla: string) => builder(tabla),
  rpc: async (nombre: string, args: any) => {
    llamadas.push({ tabla: "rpc:" + nombre, op: "rpc", inIds: 0 })
    if (nombre === "precios_efectivos_insumos") {
      return {
        data: (args.p_insumo_ids as string[]).map((id) => ({ insumo_id: id, precio_efectivo: 5000, tipo: "MATERIAL" })),
        error: null,
      }
    }
    return { data: null, error: null }
  },
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => clienteFalso }))
vi.mock("@/lib/permisos", () => ({
  obtenerPermisosRol: async () => null,
  obtenerPermisosUsuario: async () => null,
  obtenerUsuarioId: async () => "u1",
  requerirScope: async () => undefined,
}))

const { resolverLineasRevisionEnLote } = await import("@/app/(app)/presupuestos/actions")

function crearRevisiones(n: number, tipo: string) {
  for (let i = 0; i < n; i++) {
    const id = `${tipo}-${String(i).padStart(4, "0")}-0000-0000-000000000000`
    revisiones.set(id, {
      id,
      apu_id: `apu-${i % 300}`,
      presupuesto_item_id: `item-${i % 300}`,
      descripcion_original: `linea ${i % 40}`,
      tipo,
      unidad: "und",
      cantidad: 2,
      rendimiento: null,
      estado: "pendiente",
    })
  }
}

describe("resolverLineasRevisionEnLote", () => {
  beforeEach(() => {
    llamadas.length = 0
    itemApu.clear()
    revisiones = new Map()
  })

  it("guarda 650 insumos sin URLs gigantes y con pocas consultas por insumo", async () => {
    crearRevisiones(650, "INSUMO")
    const { errores } = await resolverLineasRevisionEnLote(
      Array.from(revisiones.keys()).map((id, i) => ({ revisionId: id, accion: "maestro" as const, insumoId: `ins-${i % 40}` }))
    )
    expect(errores).toEqual([])
    expect(itemApu.size).toBe(650)
    expect(Array.from(revisiones.values()).every((f) => f.estado === "resuelto" && itemApu.has(f.item_apu_id))).toBe(true)
    // ningún .in() con más de 200 ids
    expect(Math.max(...llamadas.map((l) => l.inIds))).toBeLessThanOrEqual(200)
    // precios: una sola llamada (antes una por línea)
    expect(llamadas.filter((l) => l.tabla === "rpc:precios_efectivos_insumos")).toHaveLength(1)
    // inserts en bloque (antes uno por línea)
    expect(llamadas.filter((l) => l.tabla === "item_apu" && l.op === "insert")).toHaveLength(3)
  })

  it("mezcla insumos, mano de obra y equipo en el mismo bloque", async () => {
    crearRevisiones(5, "INSUMO")
    crearRevisiones(5, "MO")
    crearRevisiones(5, "EQUIPO")
    const res = Array.from(revisiones.values()).map((f) =>
      f.tipo === "INSUMO"
        ? { revisionId: f.id, accion: "maestro" as const, insumoId: "ins-1" }
        : f.tipo === "MO"
          ? { revisionId: f.id, accion: "mano_obra" as const, manoObraCategoriaId: "mo-1" }
          : { revisionId: f.id, accion: "equipo" as const, equipoCategoriaId: "eq-1" }
    )
    const { errores } = await resolverLineasRevisionEnLote(res)
    expect(errores).toEqual([])
    const lineas = Array.from(itemApu.values())
    expect(lineas.filter((l) => l.mano_obra_categoria_id === "mo-1" && l.insumo_id === null)).toHaveLength(5)
    expect(lineas.filter((l) => l.equipo_categoria_id === "eq-1" && l.factor_unidad === 1)).toHaveLength(5)
    expect(lineas.filter((l) => l.insumo_id === "ins-1" && l.precio_unitario_congelado === 5000)).toHaveLength(5)
  })

  it("una línea con la unidad que no cuadra queda con error y las demás se guardan", async () => {
    crearRevisiones(3, "INSUMO")
    const [a, b, c] = Array.from(revisiones.keys())
    revisiones.get(b).unidad = "kg"
    const { errores } = await resolverLineasRevisionEnLote(
      [a, b, c].map((id) => ({ revisionId: id, accion: "maestro" as const, insumoId: "ins-1" }))
    )
    expect(errores.map((e) => e.revisionId)).toEqual([b])
    expect(revisiones.get(a).estado).toBe("resuelto")
    expect(revisiones.get(b).estado).toBe("pendiente")
    expect(revisiones.get(c).estado).toBe("resuelto")
  })

  it("no repite líneas ya resueltas", async () => {
    crearRevisiones(2, "INSUMO")
    const [a] = Array.from(revisiones.keys())
    revisiones.get(a).estado = "resuelto"
    await resolverLineasRevisionEnLote(
      Array.from(revisiones.keys()).map((id) => ({ revisionId: id, accion: "maestro" as const, insumoId: "ins-1" }))
    )
    expect(itemApu.size).toBe(1)
  })
})
