"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { mapControlProyecto, totalOrden, type ControlProyecto, type OrdenControl } from "@/lib/control-proyecto"

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

// Órdenes de compra del proyecto creadas entre dos fechas (AAAA-MM-DD,
// ambas incluidas, hora Colombia), las más nuevas primero. Todas, con su
// estado: el total del período en la pantalla suma solo las aprobadas.
export async function listarOrdenesControl(proyectoId: string, desde: string, hasta: string): Promise<OrdenControl[]> {
  await requerirPestana("admin.visualizacion")
  const fecha = /^\d{4}-\d{2}-\d{2}$/
  if (!fecha.test(desde) || !fecha.test(hasta)) throw new Error("Escoge las dos fechas.")
  if (desde > hasta) throw new Error("La fecha inicial es posterior a la final.")
  const supabase = await createClient()
  type FilaOrden = {
    id: string
    numero: number
    estado: OrdenControl["estado"]
    created_at: string
    proveedor: { nombre: string } | null
    lineas: Parameters<typeof totalOrden>[0] | null
  }
  const filas = await traerTodo<FilaOrden>((d, h) =>
    supabase
      .from("ordenes_compra")
      .select(`
        id, numero, estado, created_at,
        proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre),
        lineas:ordenes_compra_items(cantidad, precio_unitario, porcentaje_descuento, porcentaje_iva)
      `)
      .eq("proyecto_id", proyectoId)
      .gte("created_at", `${desde}T00:00:00-05:00`)
      .lte("created_at", `${hasta}T23:59:59.999-05:00`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(d, h)
      // Los embebidos son a-uno (proveedor) y a-muchos (lineas); sin los tipos
      // de la base, supabase-js toma todos como listas.
      .overrideTypes<FilaOrden[], { merge: false }>()
  )
  return filas.map((o) => ({
    id: o.id,
    numero: Number(o.numero),
    estado: o.estado,
    fecha: o.created_at,
    proveedor: o.proveedor?.nombre ?? "(proveedor eliminado)",
    total: totalOrden(o.lineas ?? []),
    lineas: (o.lineas ?? []).length,
  }))
}
