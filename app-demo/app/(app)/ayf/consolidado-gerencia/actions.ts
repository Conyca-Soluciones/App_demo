"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { CAMPOS_PAGO, CAMPOS_PAGO_TERCERO_INNER, conProyectos, mapPago, filtrarSemanaCreacion, rangosCreacion } from "@/lib/pagos-db"
import { mapMovimientoGerencia, type MovimientoGerencia } from "@/lib/balances"
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

// Una página (50), todo filtrado en la base. Solo pagos con semana (de un consolidado).
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
    .not("semana", "is", null)

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
    .order("referencia", { ascending: true, nullsFirst: false })
    .order("aprobado_en", { ascending: true })
    .order("id", { ascending: true })

  const { data, error } = await query.range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return { pagos: await conProyectos(supabase, filas.map(mapPago)), hayMas }
}

// El soporte original de cada pago de la página (lib/soportes-pagos-db).
export async function soportesDePagos(pagos: PagoParaSoporte[]): Promise<Record<string, SoportePago>> {
  await requerirPestana(PESTANA_CONSOLIDADO_GERENCIA)
  if (pagos.length > 100) throw new Error("Como mucho 100 pagos a la vez.")
  return buscarSoportesDePagos(await createClient(), pagos)
}

// Ingresos y egresos externos de Balances (20270101001200), si se marcaron sus
// casillas: mismas semanas (por la fecha del movimiento), grupo empresarial (la
// empresa de la cuenta), tercero (= titular), solicitante (quien lo registró) y
// semana de creación. No tienen proyecto: con ese filtro no sale ninguno.
export async function movimientosConsolidadoGerencia(filtros: FiltrosConsolidadoGerencia = {}): Promise<MovimientoGerencia[]> {
  await requerirPestana(PESTANA_CONSOLIDADO_GERENCIA)
  const tipos = [filtros.incluirIngresos ? "ingreso" : null, filtros.incluirEgresos ? "egreso" : null].filter(Boolean) as string[]
  if (tipos.length === 0 || filtros.proyectoId) return []
  for (const v of [filtros.empresaId, filtros.solicitanteId]) if (v && !UUID.test(v)) throw new Error("Filtro no válido.")
  const rangos = rangosCreacion(filtros)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("movimientos_consolidado_gerencia", {
    p_tipos: tipos,
    p_anios: enteros(filtros.anios, 2020, 2100, "un año no válido"),
    p_semanas: enteros(filtros.semanas, 1, 53, "una semana no válida"),
    p_empresa_id: filtros.empresaId ?? null,
    p_titular: filtros.tercero?.trim() || null,
    p_solicitante_id: filtros.solicitanteId ?? null,
    p_creado_desde: rangos.map((r) => r.desde),
    p_creado_hasta: rangos.map((r) => r.hasta),
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map(mapMovimientoGerencia)
}

// Total de TODOS los pagos con los filtros (no solo la página): con el filtro de
// proyecto, lo gastado en ese proyecto (20270101001300). Sin anulados ni rechazados.
export async function totalConsolidadoGerencia(filtros: FiltrosConsolidadoGerencia = {}): Promise<{ pagos: number; valor: number; anulados: number }> {
  await requerirPestana(PESTANA_CONSOLIDADO_GERENCIA)
  for (const v of [filtros.empresaId, filtros.proyectoId, filtros.solicitanteId]) if (v && !UUID.test(v)) throw new Error("Filtro no válido.")
  const rangos = rangosCreacion(filtros)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("total_consolidado_gerencia", {
    p_anios: enteros(filtros.anios, 2020, 2100, "un año no válido"),
    p_semanas: enteros(filtros.semanas, 1, 53, "una semana no válida"),
    p_empresa_id: filtros.empresaId ?? null,
    p_proyecto_id: filtros.proyectoId ?? null,
    p_solicitante_id: filtros.solicitanteId ?? null,
    p_tercero: filtros.tercero?.trim() || null,
    p_creado_desde: rangos.map((r) => r.desde),
    p_creado_hasta: rangos.map((r) => r.hasta),
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { pagos?: number; valor?: number; anulados?: number }
  return { pagos: Number(r.pagos ?? 0), valor: Number(r.valor ?? 0), anulados: Number(r.anulados ?? 0) }
}
