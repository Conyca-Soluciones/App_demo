"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAdmin } from "@/lib/permisos"
import { TAMANO_PAGINA, cortarPagina } from "@/lib/paginacion"
import type { TipoHistorial } from "@/app/(app)/almacen/historial/actions"

// ---------------------------------------------------------------------------
// Auditoría (solo Administrador): todo lo que quedó en el historial
// (historial_eventos y terceros_auditoria), más reciente primero. La consulta
// y el permiso viven en listar_auditoria (20261118200000_historial_completo_y_auditoria.sql).
// ---------------------------------------------------------------------------

export type FiltrosAuditoria = {
  tipo?: TipoHistorial
  usuarioId?: string
  desde?: string // AAAA-MM-DD (hora Colombia)
  hasta?: string
}

export type FilaAuditoria = {
  id: string
  tipo: TipoHistorial
  entidadId: string | null
  evento: string
  motivo: string | null
  datos: Record<string, any> | null
  createdAt: string
  usuarioNombre: string | null
  usuarioRol: string | null
  referencia: string | null
}

export async function listarAuditoria(
  filtros: FiltrosAuditoria,
  pagina: number
): Promise<{ filas: FilaAuditoria[]; hayMas: boolean }> {
  await requerirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_auditoria", {
    p_tipo: filtros.tipo ?? null,
    p_usuario: filtros.usuarioId ?? null,
    p_desde: filtros.desde || null,
    p_hasta: filtros.hasta || null,
    p_offset: pagina * TAMANO_PAGINA,
    p_limite: TAMANO_PAGINA + 1,
  })
  if (error) throw new Error(error.message)

  const filas = ((data ?? []) as any[]).map(
    (f): FilaAuditoria => ({
      id: f.id,
      tipo: f.tipo,
      entidadId: f.entidad_id ?? null,
      evento: f.evento,
      motivo: f.motivo ?? null,
      datos: f.datos ?? null,
      createdAt: f.created_at,
      usuarioNombre: f.usuario_nombre ?? null,
      usuarioRol: f.usuario_rol ?? null,
      referencia: f.referencia ?? null,
    })
  )
  return cortarPagina(filas)
}
