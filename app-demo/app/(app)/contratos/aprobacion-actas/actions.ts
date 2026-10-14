"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import type { ActaAprobacionFila, EstadoActa } from "@/lib/actas"

// ---------------------------------------------------------------------------
// Aprobación de actas: las actas de TODOS los proyectos que el usuario ve (no
// usa el proyecto actual), con filtro por estado y proyecto. La base valida
// pestaña, acción, proyecto y estado (20261110100000_aprobacion_actas.sql).
// El detalle de un acta es obtenerActa (contratos/actas/actions.ts).
// ---------------------------------------------------------------------------

export type FiltrosAprobacionActas = { estado?: EstadoActa; proyectoId?: string }
export type AccionActa = "aprobar" | "rechazar"

export async function listarActasAprobacion(filtros: FiltrosAprobacionActas): Promise<ActaAprobacionFila[]> {
  await requerirPestana("contratos.aprobar_actas")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_actas_aprobacion", {
    p_estado: filtros.estado ?? null,
    p_proyecto_id: filtros.proyectoId ?? null,
  })
  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((f: any) => ({
    id: f.acta_id,
    numero: Number(f.numero),
    tipo: f.tipo,
    estado: f.estado,
    valorBruto: Number(f.valor_bruto),
    neto: Number(f.neto),
    createdAt: f.created_at,
    creadoPorNombre: f.creado_por_nombre ?? null,
    contratoId: f.contrato_id,
    numeroContrato: f.numero_contrato ?? "",
    contratoValor: Number(f.contrato_valor),
    proyectoCodigo: f.proyecto_codigo ?? "",
    proyectoNombre: f.proyecto_nombre ?? "",
    contratistaNombre: f.contratista_nombre,
    resueltoPorNombre: f.resuelto_por_nombre ?? null,
    resueltoAt: f.resuelto_at ?? null,
  }))
}

export async function resolverActa(id: string, accion: AccionActa, motivo: string): Promise<void> {
  await requerirAccion("aprobar_actas")
  if (accion === "rechazar" && !motivo.trim()) throw new Error("Escribe el motivo.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_acta", {
    p_acta_id: id,
    p_accion: accion,
    p_motivo: accion === "rechazar" ? motivo.trim() : null,
  })
  if (error) throw new Error(error.message)
}
