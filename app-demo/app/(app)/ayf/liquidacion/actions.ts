"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { CAMPOS_PAGO, CAMPOS_PAGO_TERCERO_INNER, mapPago } from "@/lib/pagos-db"
import type { Pago } from "@/lib/pagos"
import {
  catalogoDesdeJson,
  contextoDesdeJson,
  type CatalogoLiquidacion,
  type ContextoPago,
  type LineaLiquidacion,
} from "@/lib/liquidacion"
import type { FiltrosLiquidacion } from "@/lib/liquidacion-pantalla"

const PESTANA = "ayf.liquidacion"

export async function listarConsolidadosLiquidacion(): Promise<{ id: string; nombre: string }[]> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const { data, error } = await supabase.from("consolidados").select("id, nombre").order("orden", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((c: any) => ({ id: c.id, nombre: c.nombre }))
}

function enteros(lista: number[] | undefined, min: number, max: number): number[] {
  const unicos = [...new Set(lista ?? [])]
  if (unicos.length > 53 || unicos.some((n) => !Number.isInteger(n) || n < min || n > max)) {
    throw new Error("El filtro de años o semanas no es válido.")
  }
  return unicos
}

// Una página (50): por liquidar (aprobados) o ya liquidados. Todo se filtra en
// la base (índices por consolidado, año, semana y estado).
export async function listarPagosLiquidacion(
  filtros: FiltrosLiquidacion,
  pagina = 0
): Promise<{ pagos: Pago[]; hayMas: boolean }> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const tercero = filtros.tercero?.trim()
  let query: any = supabase
    .from("pagos")
    .select(tercero ? CAMPOS_PAGO_TERCERO_INNER : CAMPOS_PAGO)
    .eq("estado", filtros.estado === "liquidado" ? "liquidado" : "aprobado")
  const anios = enteros(filtros.anios, 2020, 2100)
  const semanas = enteros(filtros.semanas, 1, 53)
  if (anios.length > 0) query = query.in("anio", anios)
  if (semanas.length > 0) query = query.in("semana", semanas)
  if (filtros.consolidadoId) query = query.eq("consolidado_id", filtros.consolidadoId)
  if (tercero) query = query.ilike("tercero.razon_social", `%${tercero}%`)
  query = query
    .order("anio", { ascending: false, nullsFirst: false })
    .order("semana", { ascending: false, nullsFirst: false })
    .order("consolidado_id", { ascending: true })
    .order("item", { ascending: true })
    .order("id", { ascending: true })
  const { data, error } = await query.range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return { pagos: filas.map(mapPago), hayMas }
}

// Lo que necesita el motor para los pagos de la página (una sola llamada).
export async function contextoLiquidacion(
  pagoIds: string[]
): Promise<{ catalogo: CatalogoLiquidacion; contextos: Record<string, ContextoPago> }> {
  await requerirPestana(PESTANA)
  if (pagoIds.length > 200) throw new Error("Como mucho 200 pagos a la vez.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("contexto_liquidacion", { p_pago_ids: pagoIds })
  if (error) throw new Error(error.message)
  const j = data as any
  // Los pagos de requisiciones administrativas no tienen OC ni acta: el motor
  // clasifica su concepto escrito (contexto_liquidacion no lo trae).
  const admin = Object.entries(j?.pagos ?? {})
    .filter(([, p]: [string, any]) => p?.fuente === "requisicion_admin")
    .map(([id]) => id)
  const conceptos = new Map<string, string>()
  for (let i = 0; i < admin.length; i += 100) {
    const { data: filas, error: e } = await supabase.from("pagos").select("id, concepto").in("id", admin.slice(i, i + 100))
    if (e) throw new Error(e.message)
    for (const f of (filas ?? []) as any[]) conceptos.set(f.id, f.concepto)
  }
  const contextos: Record<string, ContextoPago> = {}
  for (const [id, p] of Object.entries(j?.pagos ?? {}))
    contextos[id] = contextoDesdeJson(conceptos.has(id) ? { ...(p as object), concepto: conceptos.get(id) } : p)
  return { catalogo: catalogoDesdeJson(j), contextos }
}

// Líneas de la liquidación vigente (para corregir un pago ya liquidado).
export async function lineasLiquidacionVigente(pagoId: string): Promise<LineaLiquidacion[]> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("pago_liquidaciones")
    .select("id, pago_liquidacion_lineas(orden, tipo, concepto_clave, municipio_id, actividad_ica, descripcion, base, tarifa, valor, asumida, regla, editada)")
    .eq("pago_id", pagoId)
    .eq("estado", "vigente")
    .maybeSingle()
  if (error) throw new Error(error.message)
  const filas = ((data as any)?.pago_liquidacion_lineas ?? []) as any[]
  return filas
    .sort((a, b) => a.orden - b.orden)
    .map((l) => ({
      tipo: l.tipo,
      concepto: l.concepto_clave ?? null,
      municipioId: l.municipio_id ?? null,
      actividad: l.actividad_ica ?? null,
      descripcion: l.descripcion ?? null,
      base: l.base == null ? null : Number(l.base),
      tarifa: l.tarifa == null ? null : Number(l.tarifa),
      valor: Number(l.valor),
      asumida: Boolean(l.asumida),
      regla: l.regla ?? null,
      editada: Boolean(l.editada),
    }))
}

async function leerPago(supabase: any, id: string): Promise<Pago> {
  const { data, error } = await supabase.from("pagos").select(CAMPOS_PAGO).eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("El pago no existe o no tienes acceso.")
  return mapPago(data)
}

export async function liquidarPago(pagoId: string, datos: unknown): Promise<Pago> {
  await requerirAccion("liquidar_pagos")
  const supabase = await createClient()
  const { error } = await supabase.rpc("liquidar_pago", { p_pago_id: pagoId, p_datos: datos })
  if (error) throw new Error(error.message)
  return await leerPago(supabase, pagoId)
}

export type ResultadoLote = { pagoId: string; ok: boolean; error?: string }

// Liquidar varios con su sugerencia (uno tras otro: cada uno es su propia
// transacción y un error no detiene a los demás). Como mucho 50.
export async function liquidarVarios(items: { pagoId: string; datos: unknown }[]): Promise<ResultadoLote[]> {
  await requerirAccion("liquidar_pagos")
  if (items.length > 50) throw new Error("Como mucho 50 pagos a la vez.")
  const supabase = await createClient()
  const resultados: ResultadoLote[] = []
  for (const it of items) {
    const { error } = await supabase.rpc("liquidar_pago", { p_pago_id: it.pagoId, p_datos: it.datos })
    resultados.push(error ? { pagoId: it.pagoId, ok: false, error: error.message } : { pagoId: it.pagoId, ok: true })
  }
  return resultados
}

export async function deshacerLiquidacion(pagoId: string, motivo: string): Promise<Pago> {
  await requerirAccion("liquidar_pagos")
  if (!motivo.trim()) throw new Error("El motivo es obligatorio.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("deshacer_liquidacion", { p_pago_id: pagoId, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
  return await leerPago(supabase, pagoId)
}
