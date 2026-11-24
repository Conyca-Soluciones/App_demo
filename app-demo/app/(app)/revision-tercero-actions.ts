"use server"

import { createClient } from "@/lib/supabase/server"

// ---------------------------------------------------------------------------
// Revisión por cambio del tercero (20270101006100): si Financiera cambia el
// tercero, su proveedor y su contratista quedan en revisión hasta que los marquen
// como revisados; mientras tanto no se les hacen órdenes ni contratos nuevos.
// ---------------------------------------------------------------------------

export type CambioTercero = { de: unknown; a: unknown }
export type RevisionTercero = { cambios: Record<string, CambioTercero>; desde: string; pedidaPor: string | null }

export async function revisionTercero(entidad: "proveedor" | "contratista", id: string): Promise<RevisionTercero | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("revision_tercero", { p_entidad: entidad, p_id: id })
  if (error) return null
  const d = data as { cambios: Record<string, CambioTercero>; desde: string; pedida_por: string | null } | null
  return d ? { cambios: d.cambios ?? {}, desde: d.desde, pedidaPor: d.pedida_por } : null
}

export async function enRevisionTercero(entidad: "proveedor" | "contratista"): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("en_revision_tercero", { p_entidad: entidad })
  if (error) return []
  return ((data ?? []) as unknown[]).map((x) => String(x))
}

export async function marcarRevisadoTercero(entidad: "proveedor" | "contratista", id: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("marcar_revisado_tercero", { p_entidad: entidad, p_id: id })
  if (error) throw new Error(error.message)
}
