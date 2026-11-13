"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { mapControlProyecto, type ControlProyecto } from "@/lib/control-proyecto"

// ---------------------------------------------------------------------------
// Control del proyecto (Control › Visualización): a dónde va la plata de un
// proyecto. Todo sale de UNA función de la base, control_proyecto
// (20261112000000_control_proyecto.sql), que valida la pestaña
// admin.visualizacion y el acceso al proyecto y devuelve un solo jsonb. Las
// definiciones (gastado, avance de bodega y de actas, precio promedio) están
// en el encabezado de esa migración.
// ---------------------------------------------------------------------------

export async function obtenerControlProyecto(proyectoId: string): Promise<ControlProyecto> {
  await requerirPestana("admin.visualizacion")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("control_proyecto", { p_proyecto_id: proyectoId })
  if (error) throw new Error(error.message)
  return mapControlProyecto(data)
}
