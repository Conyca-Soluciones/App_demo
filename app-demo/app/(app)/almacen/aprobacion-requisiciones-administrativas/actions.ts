"use server"

// Aprobación de requisiciones administrativas (Subgerencia, Paquete A,
// 20261231999400). La lista sale de listar_requisiciones_administrativas_aprobacion
// (exige la pestaña y los proyectos que ve quien consulta; FUNCIONAMIENTO lo ve
// quien tiene la acción). Aprobar y rechazar usan resolver_requisicion, que para
// estas exige la acción aprobar_requisiciones_administrativas.

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, requerirAccion, requerirPestana } from "@/lib/permisos"
import { cortarPagina, TAMANO_PAGINA } from "@/lib/paginacion"
import type { EstadoRequisicion } from "@/lib/requisiciones-lineas"

export type LineaReqAdministrativaAprobacion = {
  id: string
  insumoCodigo: number | null
  insumoDescripcion: string
  insumoUm: string | null
  cantidad: number
}

export type ReqAdministrativaAprobacion = {
  id: string
  codigo: string
  proyecto: string
  funcionamiento: boolean
  solicitanteNombre: string | null
  createdAt: string
  fechaRequerida: string | null
  urgente: boolean
  estado: EstadoRequisicion
  observaciones: string | null
  direccionEntrega: string | null
  motivoResolucion: string | null
  resueltoAt: string | null
  resueltoPorNombre: string | null
  lineas: LineaReqAdministrativaAprobacion[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapFila(f: any): ReqAdministrativaAprobacion {
  return {
    id: String(f.id),
    codigo: String(f.codigo ?? ""),
    proyecto: [f.proyecto_codigo, f.proyecto_nombre].filter(Boolean).join(" - "),
    funcionamiento: f.funcionamiento === true,
    solicitanteNombre: f.solicitante_nombre ?? null,
    createdAt: String(f.created_at ?? ""),
    fechaRequerida: f.fecha_requerida ?? null,
    urgente: f.urgente === true,
    estado: f.estado,
    observaciones: f.observaciones ?? null,
    direccionEntrega: f.direccion_entrega ?? null,
    motivoResolucion: f.motivo_resolucion ?? null,
    resueltoAt: f.resuelto_at ?? null,
    resueltoPorNombre: f.resuelto_por_nombre ?? null,
    lineas: (Array.isArray(f.lineas) ? f.lineas : []).map((l: any) => ({
      id: String(l.id),
      insumoCodigo: l.insumo_codigo == null ? null : Number(l.insumo_codigo),
      insumoDescripcion: String(l.insumo_descripcion ?? "(insumo eliminado)"),
      insumoUm: l.insumo_um ?? null,
      cantidad: Number(l.cantidad ?? 0),
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listarReqAdministrativasAprobacion(
  estado: EstadoRequisicion | null,
  pagina = 0
): Promise<{ filas: ReqAdministrativaAprobacion[]; hayMas: boolean }> {
  await requerirPestana("tecnico.aprobar_administrativas")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_requisiciones_administrativas_aprobacion", {
    p_estado: estado,
    p_offset: pagina * TAMANO_PAGINA,
    p_limite: TAMANO_PAGINA + 1,
  })
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina(((data as unknown[]) ?? []).map(mapFila))
  return { filas, hayMas }
}

// La requisición completa (decisión del usuario). Motivo obligatorio al rechazar.
export async function resolverReqAdministrativa(id: string, estado: "aprobado" | "rechazado", comentario?: string) {
  await requerirAccion("aprobar_requisiciones_administrativas")
  const motivo = comentario?.trim() || null
  if (estado === "rechazado" && !motivo) throw new Error("Escribe el motivo del rechazo.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_requisicion", { p_id: id, p_estado: estado, p_comentario: motivo })
  if (error) throw new Error(error.message)
}

export async function puedeAprobarReqAdministrativas(): Promise<boolean> {
  const permisos = await obtenerPermisosRol()
  if (!permisos) return false
  return permisos.esAdministrador || permisos.acciones.includes("aprobar_requisiciones_administrativas")
}
