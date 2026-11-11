"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion } from "@/lib/permisos"
import type { SaldoFavor, SaldoProveedor, VistaCierreFaltante } from "@/lib/saldo-favor"

// ---------------------------------------------------------------------------
// Paquete C, entregas 2 y 3 (20261231999200 / 20261231999300): cerrar una OC
// con faltante y saldos a favor de proveedores. Todo pasa por funciones de la
// base, que revisan el permiso (Comprar) y el proyecto otra vez.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const n = (v: unknown) => Number(v ?? 0)

// Función que no existe todavía (migración sin correr): PostgREST da PGRST202.
const sinMigracion = (code?: string) => code === "PGRST202" || code === "42883"

export async function vistaCierreFaltante(ordenId: string): Promise<VistaCierreFaltante> {
  await requerirAccion("comprar")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("vista_cierre_faltante", { p_orden_id: ordenId })
  if (error) throw new Error(error.message)
  const d = data as any
  return {
    totalActual: n(d.total_actual),
    totalNuevo: n(d.total_nuevo),
    valorFaltante: n(d.valor_faltante),
    pagosReducidos: n(d.pagos_reducidos),
    saldoFavor: n(d.saldo_favor),
    motivoNo: d.motivo_no ?? null,
    lineas: (d.lineas ?? []).map((l: any) => ({
      id: l.id,
      insumoCodigo: l.insumo_codigo ?? null,
      insumoDescripcion: l.insumo_descripcion ?? "(insumo)",
      unidad: l.unidad ?? null,
      pedido: n(l.pedido),
      recibido: n(l.recibido),
      valorFaltante: n(l.valor_faltante),
    })),
    pagos: (d.pagos ?? []).map((p: any) => ({ tipo: p.tipo, estado: p.estado, valor: n(p.valor), menos: n(p.menos), queda: n(p.queda) })),
  }
}

export async function cerrarOrdenConFaltante(ordenId: string, motivo: string) {
  await requerirAccion("comprar")
  if (motivo.trim().length < 3) throw new Error("Escribe el motivo del cierre.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("cerrar_orden_con_faltante", { p_orden_id: ordenId, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
  const d = data as any
  return { valorFaltante: n(d.valor_faltante), pagosReducidos: n(d.pagos_reducidos), saldoFavor: n(d.saldo_favor) }
}

export async function listarSaldosFavor(soloDisponibles: boolean): Promise<SaldoFavor[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_saldos_favor", { p_solo_disponibles: soloDisponibles })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((s) => ({
    id: s.id,
    proveedorId: s.proveedor_id,
    proveedor: s.proveedor ?? "(proveedor)",
    empresa: s.empresa ?? null,
    ordenOrigenId: s.orden_origen_id,
    ordenOrigen: s.orden_origen ?? "",
    valor: n(s.valor),
    disponible: n(s.disponible),
    creadoAt: s.creado_at,
    creadoPor: s.creado_por ?? null,
    cerradoAt: s.cerrado_at ?? null,
    cerradoPor: s.cerrado_por ?? null,
    motivoCierre: s.motivo_cierre ?? null,
    aplicaciones: ((s.aplicaciones ?? []) as any[]).map((a) => ({
      ordenId: a.orden_id,
      orden: a.orden ?? "",
      estado: a.estado,
      valor: n(a.valor),
      fecha: a.fecha,
    })),
  }))
}

// Saldos disponibles del proveedor en la empresa del proyecto. [] si la base
// todavía no tiene la migración (Generar OC sigue igual).
export async function saldosFavorProveedor(proveedorId: string, proyectoId: string): Promise<SaldoProveedor[]> {
  await requerirAccion("comprar")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("saldos_favor_proveedor", { p_proveedor_id: proveedorId, p_proyecto_id: proyectoId })
  if (error) {
    if (sinMigracion(error.code)) return []
    throw new Error(error.message)
  }
  return ((data ?? []) as any[]).map((s) => ({ id: s.id, disponible: n(s.disponible), ordenOrigen: s.orden_origen ?? "", creadoAt: s.creado_at }))
}

export async function cerrarSaldoFavor(saldoId: string, motivo: string): Promise<void> {
  await requerirAccion("comprar")
  if (motivo.trim().length < 3) throw new Error("Escribe el motivo para cerrar el saldo.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("cerrar_saldo_favor", { p_saldo_id: saldoId, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}
