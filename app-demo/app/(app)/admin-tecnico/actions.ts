"use server"

// app/(app)/admin-tecnico/actions.ts
//
// Aprobación de REQUISICIONES (agrupadas: cabecera con número + insumos).
// Aprobar, rechazar y desaprobar actúan sobre la requisición ENTERA; las
// funciones de la base están en supabase/migrations/20261008000000_requisiciones.sql.

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, obtenerPermisosRol } from "@/lib/permisos"
import type { FiltrosRequisiciones } from "@/app/(app)/almacen/actions"
import {
  cargarLineas,
  mapResumen,
  SELECT_REQUISICIONES,
  SELECT_REQUISICIONES_CON_INSUMO,
  type LineaRequisicion,
  type RequisicionResumen,
} from "@/lib/requisiciones-lineas"

export type RequisicionParaAprobar = RequisicionResumen & {
  lineas: LineaRequisicion[]
  // Solo rechazadas: el motivo y quién rechazó.
  motivoRechazo: string | null
  resueltoPorNombre: string | null
  resueltoAt: string | null
}

// Consulta de requisiciones para aprobar. Sin filtro de estado trae las
// pendientes, aprobadas y rechazadas (no las canceladas); cada una se muestra
// con las acciones de su propio estado (pendiente: aprobar o rechazar;
// aprobada: desaprobar mientras ningún insumo esté en una orden de compra).
// Ve todos los proyectos (quien aprueba no está limitado a los suyos).
export async function verRequisicionesAprobacion(
  filtros: FiltrosRequisiciones = {}
): Promise<RequisicionParaAprobar[]> {
  await requerirAccion("aprobar_pedidos")
  const supabase = await createClient()

  let query = supabase
    .from("requisiciones_vista")
    .select(filtros.insumoId ? SELECT_REQUISICIONES_CON_INSUMO : SELECT_REQUISICIONES)
  query = filtros.estado
    ? query.eq("estado", filtros.estado)
    : query.in("estado", ["pendiente", "aprobada", "rechazada"])

  if (filtros.numero !== undefined) query = query.eq("numero", filtros.numero)
  if (filtros.proyectoId) query = query.eq("proyecto_id", filtros.proyectoId)
  if (filtros.solicitadoPorId) query = query.eq("solicitado_por", filtros.solicitadoPorId)
  // Colombia es UTC-5 todo el año: así "hasta" incluye el día completo.
  if (filtros.desde) query = query.gte("created_at", `${filtros.desde}T00:00:00-05:00`)
  if (filtros.hasta) query = query.lte("created_at", `${filtros.hasta}T23:59:59.999-05:00`)
  if (filtros.insumoId) query = query.eq("filtro_insumo.insumo_id", filtros.insumoId)

  const { data, error } = await query.order("created_at", { ascending: false }).limit(500)
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as any[]
  if (filas.length === 0) return []

  const lineas = await cargarLineas(supabase, filas.map((f) => f.id))

  const lista = filas.map((f) => {
    const ls = lineas.get(f.id) ?? []
    const resuelta = ls.find((l) => l._resueltoAt)
    const resumen = mapResumen(f)
    return {
      ...resumen,
      lineas: ls.map(({ _resolutor, _resueltoAt, _comentario, _motivoCancelacion, ...l }) => l),
      motivoRechazo:
        resumen.estado === "rechazada" ? ls.find((l) => l._comentario)?._comentario ?? null : null,
      resueltoPorNombre: resuelta?._resolutor ?? null,
      resueltoAt: resuelta?._resueltoAt ?? null,
    }
  })

  // Primero lo que falta por aprobar (urgentes y más antiguas arriba); después
  // el resto, de la más reciente a la más antigua.
  const pendientes = lista
    .filter((r) => r.estado === "pendiente")
    .sort((x, y) => Number(y.urgente) - Number(x.urgente) || x.createdAt.localeCompare(y.createdAt))
  const resto = lista.filter((r) => r.estado !== "pendiente")
  return [...pendientes, ...resto]
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
