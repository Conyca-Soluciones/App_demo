"use server"

import { createClient } from "@/lib/supabase/server"
import { mapGrupos, type GrupoPendientes } from "@/lib/pendientes"

// Bandeja de quien consulta. La función usa auth.uid(): nadie puede pedir los
// pendientes de otro, y el permiso y los proyectos los decide la base.
export async function obtenerMisPendientes(): Promise<GrupoPendientes[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("mis_pendientes", { p_por_grupo: 20 })
  if (error) throw new Error(error.message)
  return mapGrupos(data)
}

// Número del menú. Si la migración no se ha corrido o falla, 0 (el menú no se rompe).
export async function contarMisPendientes(): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("contar_mis_pendientes")
  if (error) return 0
  return Number(data ?? 0)
}
