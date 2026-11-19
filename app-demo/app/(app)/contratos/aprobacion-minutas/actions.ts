"use server"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import type { EstadoMinuta } from "@/lib/contratos"
import { SELECT_FILA_CONTRATO, mapFilaContrato, type SolicitudContratoFila } from "@/lib/contratos-db"

// ---------------------------------------------------------------------------
// Aprobación de minutas: Gerencia revisa las minutas que Jurídica envía,
// de TODOS los proyectos que puede ver (no depende del proyecto actual), y las
// aprueba o devuelve. La base valida permiso, proyecto y estado
// (resolver_minuta_contrato, 20261111000000_aprobacion_minutas.sql).
// ---------------------------------------------------------------------------

export type FiltrosMinutas = {
  estado?: EstadoMinuta // sin estado = todas las que ya se enviaron alguna vez
  proyectoId?: string
}

export async function listarMinutasGerencia(filtros: FiltrosMinutas): Promise<SolicitudContratoFila[]> {
  await requerirPestana("contratos.aprobar_minutas")
  const supabase = await createClient()
  const filas = await traerTodo<any>((desde, hasta) => {
    let q = supabase.from("contratos").select(SELECT_FILA_CONTRATO).eq("estado", "aprobada")
    q = filtros.estado ? q.eq("minuta_estado", filtros.estado) : q.not("minuta_estado", "is", null)
    if (filtros.proyectoId) q = q.eq("proyecto_id", filtros.proyectoId)
    // Las que esperan revisión: primero las más antiguas (orden de llegada).
    return q
      .order("minuta_enviada_at", { ascending: filtros.estado === "en_revision", nullsFirst: false })
      .order("id", { ascending: true })
      .range(desde, hasta)
  })
  return filas.map(mapFilaContrato)
}

// Contratos de obra o mano de obra con actividades por encima del tope,
// esperando la autorización de Gerencia (20270101004200).
export async function listarContratosSobreTope(proyectoId?: string): Promise<SolicitudContratoFila[]> {
  await requerirPestana("contratos.aprobar_minutas")
  const supabase = await createClient()
  const filas = await traerTodo<any>((desde, hasta) => {
    let q = supabase.from("contratos").select(SELECT_FILA_CONTRATO).eq("estado", "por_autorizar")
    if (proyectoId) q = q.eq("proyecto_id", proyectoId)
    return q.order("enviado_at", { ascending: true }).order("id", { ascending: true }).range(desde, hasta)
  })
  return filas.map(mapFilaContrato)
}

export type AccionTope = "autorizar" | "devolver" | "rechazar"

export async function resolverAutorizacionTope(id: string, accion: AccionTope, motivo?: string): Promise<void> {
  await requerirAccion("autorizar_contratos_sobre_tope")
  if (accion !== "autorizar" && !motivo?.trim()) throw new Error("Escribe el motivo.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_autorizacion_tope", {
    p_id: id,
    p_accion: accion,
    p_motivo: motivo?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export type AccionMinuta = "aprobar" | "devolver"

export async function resolverMinutaContrato(id: string, accion: AccionMinuta, motivo?: string): Promise<void> {
  await requerirAccion("aprobar_minutas")
  if (accion === "devolver" && !motivo?.trim()) {
    throw new Error("Escribe el motivo.")
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_minuta_contrato", {
    p_id: id,
    p_accion: accion,
    p_motivo: motivo?.trim() || null,
  })
  if (error) throw new Error(error.message)
}
