"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { CAMPOS_PAGO, CAMPOS_PAGO_TERCERO_INNER, mapPago } from "@/lib/pagos-db"
import {
  PESTANA_CONSOLIDADO_GERENCIA,
  type FiltrosConsolidadoGerencia,
  type OpcionesConsolidadoGerencia,
  type Pago,
  type SoportePago,
} from "@/lib/pagos"

// Consolidado Gerencia: los pagos de los tres consolidados (la base se los da
// a la pestaña ayf.consolidado_gerencia, 20261212000000).

export async function opcionesConsolidadoGerencia(): Promise<OpcionesConsolidadoGerencia> {
  await requerirPestana(PESTANA_CONSOLIDADO_GERENCIA)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("opciones_consolidado_gerencia")
  if (error) throw new Error(error.message)
  const j = (data ?? {}) as any
  return {
    empresas: (j.empresas ?? []).map((e: any) => ({ id: e.id, nombre: e.nombre })),
    proyectos: (j.proyectos ?? []).map((p: any) => ({ id: p.id, codigo: p.codigo ?? null, nombre: p.nombre })),
    solicitantes: (j.solicitantes ?? []).map((s: any) => ({ id: s.id, nombre: s.nombre })),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function enteros(lista: number[] | undefined, min: number, max: number, nombre: string): number[] {
  const unicos = [...new Set(lista ?? [])]
  if (unicos.length > 53 || unicos.some((n) => !Number.isInteger(n) || n < min || n > max)) {
    throw new Error(`El filtro tiene ${nombre}.`)
  }
  return unicos
}

// Una página (50), todo filtrado en la base. Solo pagos con ITEM (de un consolidado).
export async function listarConsolidadoGerencia(
  filtros: FiltrosConsolidadoGerencia = {},
  pagina = 0
): Promise<{ pagos: Pago[]; hayMas: boolean }> {
  await requerirPestana(PESTANA_CONSOLIDADO_GERENCIA)
  const supabase = await createClient()

  const tercero = filtros.tercero?.trim()
  let query: any = supabase
    .from("pagos")
    .select(tercero ? CAMPOS_PAGO_TERCERO_INNER : CAMPOS_PAGO)
    .not("consolidado_id", "is", null)
    .not("item", "is", null)

  const anios = enteros(filtros.anios, 2020, 2100, "un año no válido")
  const semanas = enteros(filtros.semanas, 1, 53, "una semana no válida")
  if (anios.length > 0) query = query.in("anio", anios)
  if (semanas.length > 0) query = query.in("semana", semanas)
  for (const [valor, columna] of [
    [filtros.empresaId, "empresa_id"],
    [filtros.proyectoId, "proyecto_id"],
    [filtros.solicitanteId, "solicitado_por"],
  ] as const) {
    if (!valor) continue
    if (!UUID.test(valor)) throw new Error("Filtro no válido.")
    query = query.eq(columna, valor)
  }
  if (tercero) query = query.ilike("tercero.razon_social", `%${tercero}%`)

  query = query
    .order("anio", { ascending: false })
    .order("semana", { ascending: false })
    .order("consolidado_id", { ascending: true })
    .order("item", { ascending: true })
    .order("id", { ascending: true })

  const { data, error } = await query.range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return { pagos: filas.map(mapPago), hayMas }
}

// El soporte original de cada pago de la página (tres consultas por lotes).
// OC: el soporte de la orden (factura / cuenta de cobro antes que cotización);
// acta: su soporte de pago (factura o cuenta de cobro); requisición
// administrativa: el del ítem.
export async function soportesDePagos(
  pagos: { id: string; ordenCompraId: string | null; actaId: string | null; requisicionAdminItemId: string | null }[]
): Promise<Record<string, SoportePago>> {
  await requerirPestana(PESTANA_CONSOLIDADO_GERENCIA)
  if (pagos.length > 100) throw new Error("Como mucho 100 pagos a la vez.")
  const supabase = await createClient()
  const ocs = [...new Set(pagos.map((p) => p.ordenCompraId).filter((x): x is string => Boolean(x)))]
  const actas = [...new Set(pagos.map((p) => p.actaId).filter((x): x is string => Boolean(x)))]
  const items = [...new Set(pagos.map((p) => p.requisicionAdminItemId).filter((x): x is string => Boolean(x)))]

  const [rOc, rActa, rItem] = await Promise.all([
    ocs.length
      ? supabase.from("orden_compra_soportes").select("id, orden_compra_id, tipo, nombre_archivo, created_at").in("orden_compra_id", ocs)
      : Promise.resolve({ data: [], error: null }),
    actas.length
      ? supabase
          .from("acta_soportes")
          .select("acta_id, tipo, ruta, nombre_archivo, created_at")
          .in("acta_id", actas)
          .in("tipo", ["factura", "cuenta_cobro"])
      : Promise.resolve({ data: [], error: null }),
    items.length
      ? supabase.from("requisicion_admin_items").select("id, soporte_ruta, soporte_nombre, soporte_tipo").in("id", items).not("soporte_ruta", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [rOc, rActa, rItem]) if (r.error) throw new Error(r.error.message)

  // Uno por documento: el más reciente, y en las OC la factura o cuenta de
  // cobro antes que la cotización.
  const peso = (tipo: string) => (tipo === "cotizacion" ? 0 : 1)
  const porOc = new Map<string, any>()
  for (const s of (rOc.data ?? []) as any[]) {
    const previo = porOc.get(s.orden_compra_id)
    if (!previo || peso(s.tipo) > peso(previo.tipo) || (peso(s.tipo) === peso(previo.tipo) && s.created_at > previo.created_at)) {
      porOc.set(s.orden_compra_id, s)
    }
  }
  const porActa = new Map<string, any>()
  for (const s of (rActa.data ?? []) as any[]) {
    const previo = porActa.get(s.acta_id)
    if (!previo || s.created_at > previo.created_at) porActa.set(s.acta_id, s)
  }
  const porItem = new Map<string, any>(((rItem.data ?? []) as any[]).map((i) => [i.id, i]))

  const salida: Record<string, SoportePago> = {}
  for (const p of pagos) {
    const oc = p.ordenCompraId ? porOc.get(p.ordenCompraId) : null
    const acta = p.actaId ? porActa.get(p.actaId) : null
    const item = p.requisicionAdminItemId ? porItem.get(p.requisicionAdminItemId) : null
    if (oc) salida[p.id] = { origen: "orden_compra", id: oc.id, nombre: oc.nombre_archivo, tipo: oc.tipo }
    else if (acta) salida[p.id] = { origen: "acta", ruta: acta.ruta, nombre: acta.nombre_archivo, tipo: acta.tipo }
    else if (item) salida[p.id] = { origen: "requisicion_admin", ruta: item.soporte_ruta, nombre: item.soporte_nombre, tipo: item.soporte_tipo }
  }
  return salida
}
