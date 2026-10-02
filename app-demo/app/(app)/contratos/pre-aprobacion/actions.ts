"use server"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import type { EstadoContrato } from "@/lib/contratos"
import { SELECT_FILA_CONTRATO, mapFilaContrato, type SolicitudContratoFila } from "@/lib/contratos-db"

// ---------------------------------------------------------------------------
// Pre-aprobación de contratos: Jurídica revisa las solicitudes de TODOS los
// proyectos que puede ver (no solo el proyecto actual), y las aprueba,
// devuelve o rechaza. La base valida permiso, proyecto y estado
// (resolver_solicitud_contrato, 20261014000000_preaprobacion_contratos.sql).
// ---------------------------------------------------------------------------

export type FiltrosPreaprobacion = {
  estado?: EstadoContrato // sin estado = todas
  proyectoId?: string
}

export async function listarSolicitudesPreaprobacion(filtros: FiltrosPreaprobacion): Promise<SolicitudContratoFila[]> {
  await requerirPestana("contratos.preaprobacion")
  const supabase = await createClient()
  const filas = await traerTodo<any>((desde, hasta) => {
    let q = supabase.from("contratos").select(SELECT_FILA_CONTRATO)
    if (filtros.estado) q = q.eq("estado", filtros.estado)
    if (filtros.proyectoId) q = q.eq("proyecto_id", filtros.proyectoId)
    // Las que esperan revisión: primero las más antiguas (orden de llegada).
    return q
      .order("enviado_at", { ascending: filtros.estado === "pre_aprobacion" })
      .order("id", { ascending: true })
      .range(desde, hasta)
  })
  return filas.map(mapFilaContrato)
}

export type AccionPreaprobacion = "aprobar" | "devolver" | "rechazar"

export async function resolverSolicitudContrato(id: string, accion: AccionPreaprobacion, motivo?: string): Promise<void> {
  await requerirAccion("aprobar_contratos")
  if ((accion === "devolver" || accion === "rechazar") && !motivo?.trim()) {
    throw new Error("Escribe el motivo.")
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_solicitud_contrato", {
    p_id: id,
    p_accion: accion,
    p_motivo: motivo?.trim() || null,
  })
  if (error) throw new Error(error.message)
}
