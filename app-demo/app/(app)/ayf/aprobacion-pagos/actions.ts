"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { CAMPOS_PAGO, CAMPOS_PAGO_TERCERO_INNER, mapPago } from "@/lib/pagos-db"
import type { FiltrosAprobacionPagos, Pago } from "@/lib/pagos"

const PESTANA = "ayf.aprobacion_pagos"

// Una página (50) de pagos. Primero se liberan los saldos "por fecha" que ya
// llegaron a su día (idempotente, usa un índice parcial): así aparecen en
// "Por aprobar" sin necesitar un proceso programado.
export async function listarPagosAprobacion(
  filtros: FiltrosAprobacionPagos = {},
  pagina = 0
): Promise<{ pagos: Pago[]; hayMas: boolean }> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()

  const { error: errorLiberar } = await supabase.rpc("liberar_pagos_programados")
  if (errorLiberar) throw new Error(errorLiberar.message)

  const tercero = filtros.tercero?.trim()
  let query: any = supabase
    .from("pagos")
    .select(tercero ? CAMPOS_PAGO_TERCERO_INNER : CAMPOS_PAGO)
    .order("solicitado_en", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })

  if (filtros.estado) query = query.eq("estado", filtros.estado)
  if (tercero) query = query.ilike("tercero.razon_social", `%${tercero}%`)

  const { data, error } = await query.range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return { pagos: filas.map(mapPago), hayMas }
}

async function obtenerPago(id: string): Promise<Pago> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("pagos").select(CAMPOS_PAGO).eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("El pago no existe o no tienes acceso.")
  return mapPago(data)
}

export async function aprobarPago(pagoId: string): Promise<Pago> {
  await requerirAccion("aprobar_pagos")
  const supabase = await createClient()
  const { error } = await supabase.rpc("aprobar_pago", { p_pago_id: pagoId })
  if (error) throw new Error(error.message)
  return await obtenerPago(pagoId)
}

export async function rechazarPago(pagoId: string, motivo: string): Promise<Pago> {
  await requerirAccion("aprobar_pagos")
  if (!motivo.trim()) throw new Error("El motivo de rechazo es obligatorio.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("rechazar_pago", { p_pago_id: pagoId, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
  return await obtenerPago(pagoId)
}
