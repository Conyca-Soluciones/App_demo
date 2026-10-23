"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { CAMPOS_PAGO, CAMPOS_PAGO_TERCERO_INNER, mapPago, filtrarSemanaCreacion } from "@/lib/pagos-db"
import { buscarSoportesDePagos, type PagoParaSoporte } from "@/lib/soportes-pagos-db"
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
  query = filtrarSemanaCreacion(query, filtros)
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

// El soporte original de cada pago de la página (lib/soportes-pagos-db).
export async function soportesDePagos(pagos: PagoParaSoporte[]): Promise<Record<string, SoportePago>> {
  await requerirPestana(PESTANA_CONSOLIDADO_GERENCIA)
  if (pagos.length > 100) throw new Error("Como mucho 100 pagos a la vez.")
  return buscarSoportesDePagos(await createClient(), pagos)
}
