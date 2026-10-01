"use server"

// app/(app)/admin-tecnico/actions.ts
//
// Aprobación de REQUISICIONES (agrupadas: cabecera con número + insumos).
// Aprobar, rechazar y desaprobar actúan sobre la requisición ENTERA; las
// funciones de la base están en supabase/migrations/20261008000000_requisiciones.sql.

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, obtenerPermisosRol } from "@/lib/permisos"
import {
  cargarLineas,
  mapResumen,
  type LineaRequisicion,
  type RequisicionResumen,
} from "@/lib/requisiciones-lineas"

export type EstadoAprobacion = "pendiente" | "aprobada" | "rechazada"

export type RequisicionParaAprobar = RequisicionResumen & {
  lineas: LineaRequisicion[]
  // Solo rechazadas: el motivo y quién rechazó.
  motivoRechazo: string | null
  resueltoPorNombre: string | null
  resueltoAt: string | null
}

// "pendiente" = cola de aprobación; "aprobada" = ya aprobadas (para poder
// desaprobarlas mientras ningún insumo esté en una orden de compra);
// "rechazada" = historial de rechazos, con motivo y quién rechazó. Ve todos
// los proyectos (quien aprueba no está limitado a los suyos).
export async function verRequisicionesPorEstado(
  estado: EstadoAprobacion
): Promise<RequisicionParaAprobar[]> {
  await requerirAccion("aprobar_pedidos")
  const supabase = await createClient()

  let query = supabase.from("requisiciones_vista").select("*").eq("estado", estado)
  query =
    estado === "pendiente"
      ? query.order("urgente", { ascending: false }).order("created_at", { ascending: true }).limit(500)
      : query.order("created_at", { ascending: false }).limit(300)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as any[]
  if (filas.length === 0) return []

  const lineas = await cargarLineas(supabase, filas.map((f) => f.id))

  return filas.map((f) => {
    const ls = lineas.get(f.id) ?? []
    const resuelta = ls.find((l) => l._resueltoAt)
    return {
      ...mapResumen(f),
      lineas: ls.map(({ _resolutor, _resueltoAt, _comentario, _motivoCancelacion, ...l }) => l),
      motivoRechazo: estado === "rechazada" ? ls.find((l) => l._comentario)?._comentario ?? null : null,
      resueltoPorNombre: resuelta?._resolutor ?? null,
      resueltoAt: resuelta?._resueltoAt ?? null,
    }
  })
}

// Aprueba o rechaza la requisición completa (todas sus líneas pendientes).
// El motivo del rechazo es obligatorio: es lo que le llega al solicitante en
// la notificación.
export async function resolverRequisicion(
  id: string,
  estado: "aprobado" | "rechazado",
  comentario?: string
) {
  await requerirAccion("aprobar_pedidos")
  const motivo = comentario?.trim() || null
  if (estado === "rechazado" && !motivo) throw new Error("Escribe el motivo del rechazo.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_requisicion", {
    p_id: id,
    p_estado: estado,
    p_comentario: motivo,
  })
  if (error) throw new Error(error.message)
}

// Devuelve una requisición aprobada a pendiente. Solo si ningún insumo suyo
// está en una orden de compra vigente (lo valida la base). Motivo obligatorio.
export async function desaprobarRequisicion(id: string, motivo: string) {
  await requerirAccion("desaprobar_pedidos")
  if (!motivo.trim()) throw new Error("El motivo es obligatorio.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("desaprobar_requisicion", {
    p_id: id,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}

export type PermisosPedidos = { aprobar: boolean; desaprobar: boolean }

export async function obtenerPermisosPedidos(): Promise<PermisosPedidos> {
  const permisos = await obtenerPermisosRol()
  if (!permisos) return { aprobar: false, desaprobar: false }
  const puede = (a: string) => permisos.esAdministrador || permisos.acciones.includes(a)
  return {
    aprobar: puede("aprobar_pedidos"),
    desaprobar: puede("desaprobar_pedidos"),
  }
}
