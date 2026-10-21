"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, requerirAccion, requerirPestana } from "@/lib/permisos"
import { TAMANO_PAGINA, cortarPagina, rangoPagina } from "@/lib/paginacion"
import { CAMPOS_PAGO, CAMPOS_PAGO_TERCERO_INNER, mapPago } from "@/lib/pagos-db"
import type { FiltrosAprobacionPagos, Pago } from "@/lib/pagos"
import {
  mapDetalleReqAdmin,
  mapFilaReqAdmin,
  type EstadoReqAdmin,
  type RequisicionAdminDetalle,
  type RequisicionAdminFila,
} from "@/lib/requisiciones-admin"

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

  // Saldos con fecha que ya están a 3 días o menos: los pasa a solicitado una
  // tarea de pg_cron cada hora; esto lo adelanta al abrir la pantalla (misma
  // regla, ver 20261102000000_pagos_programados_cron.sql).
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

// Pago de orden de compra rechazado: crea uno nuevo "por aprobar" con los
// mismos datos (el rechazado queda como registro). Acción aprobar_pagos o
// gestionar_pagos; la base lo vuelve a exigir.
export async function resolicitarPago(pagoId: string): Promise<Pago> {
  const permisos = await obtenerPermisosRol()
  if (!permisos?.esAdministrador && !permisos?.acciones.some((a) => a === "aprobar_pagos" || a === "gestionar_pagos")) {
    throw new Error("No tienes permiso para volver a solicitar pagos.")
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("resolicitar_pago", { p_pago_id: pagoId })
  if (error) throw new Error(error.message)
  return await obtenerPago(data as string)
}

// ---------------------------------------------------------------------------
// Requisiciones administrativas (20261202000000): A&F las aprueba o rechaza
// COMPLETAS. Aprobar crea un pago aprobado por ítem, con su ITEM del
// consolidado.
// ---------------------------------------------------------------------------

export async function listarRequisicionesAdminAprobacion(
  filtros: { estado?: EstadoReqAdmin; numero?: number } = {},
  pagina = 0
): Promise<{ filas: RequisicionAdminFila[]; hayMas: boolean }> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_requisiciones_admin", {
    p_mias: false,
    p_estado: filtros.estado ?? null,
    p_numero: filtros.numero ?? null,
    p_offset: pagina * TAMANO_PAGINA,
    p_limite: TAMANO_PAGINA + 1,
  })
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return { filas: filas.map(mapFilaReqAdmin), hayMas }
}

export async function obtenerRequisicionAdminAprobacion(id: string): Promise<RequisicionAdminDetalle> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("detalle_requisicion_admin", { p_id: id })
  if (error) throw new Error(error.message)
  return mapDetalleReqAdmin(data)
}

export async function resolverRequisicionAdmin(
  id: string,
  accion: "aprobar" | "rechazar",
  motivo?: string
): Promise<RequisicionAdminDetalle> {
  await requerirAccion("aprobar_pagos")
  if (accion === "rechazar" && !motivo?.trim()) throw new Error("El motivo de rechazo es obligatorio.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_requisicion_admin", {
    p_id: id,
    p_accion: accion,
    p_motivo: accion === "rechazar" ? motivo!.trim() : null,
  })
  if (error) throw new Error(error.message)
  return await obtenerRequisicionAdminAprobacion(id)
}
