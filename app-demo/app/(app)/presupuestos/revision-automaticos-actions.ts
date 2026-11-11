"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion } from "@/lib/permisos"
import { eliminarInsumoApu, recalcularValorItemDesdeApu } from "@/app/(app)/presupuestos/actions"

// Rechazar un automático de "Revisar pendientes" (decisión del usuario,
// 2026-11-11): se quita del APU la línea que puso el auto-match y la línea de
// la revisión vuelve a "pendiente" con sus mismos candidatos. Ahí se resuelve
// como cualquier pendiente: otro candidato, buscar en la maestra, "No existe —
// crear solicitud" o "No aplica". Sirve para insumos y equipo.
//
// Primero se borra la línea del APU: si ya tiene requisiciones, eliminarInsumoApu
// falla con un mensaje claro y la revisión no se toca. La FK de la revisión a
// item_apu es "on delete set null", así que el borrado no choca con ella.
export async function rechazarAutoMatch(revisionId: string): Promise<void> {
  await requerirAccion("editar_presupuestos")
  const supabase = await createClient()

  const { data: fila, error: errorLectura } = await supabase
    .from("apu_import_revision")
    .select("estado, presupuesto_item_id, item_apu_id")
    .eq("id", revisionId)
    .single()
  if (errorLectura) throw new Error(errorLectura.message)
  if (fila.estado !== "auto_match") {
    throw new Error("Esa línea ya no es un automático (actualiza la revisión).")
  }

  if (fila.item_apu_id) await eliminarInsumoApu(fila.item_apu_id)

  const { data: actualizada, error: errorUpdate } = await supabase
    .from("apu_import_revision")
    .update({
      estado: "pendiente",
      insumo_id_asignado: null,
      equipo_categoria_id_asignado: null,
      item_apu_id: null,
    })
    .eq("id", revisionId)
    .eq("estado", "auto_match")
    .select("id")
  if (errorUpdate) throw new Error(errorUpdate.message)
  // RLS no da error al bloquear un UPDATE: solo no devuelve la fila.
  if (!actualizada || actualizada.length === 0) {
    throw new Error("No se pudo rechazar el automático: no tienes permiso para editar este presupuesto.")
  }

  await recalcularValorItemDesdeApu(fila.presupuesto_item_id)
}
