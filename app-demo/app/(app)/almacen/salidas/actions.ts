"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirScope } from "@/lib/permisos"

// ---------------------------------------------------------------------------
// SALIDAS de bodega hacia obra. Limitadas por el inventario disponible
// (entradas - salidas no anuladas). El tope, el permiso y el bloqueo de
// concurrencia viven en las funciones SQL de
// 20260930200000_salidas_almacen.sql; la tabla ya no acepta inserts directos.
// El stock disponible por insumo sale de obtenerInventarioProyecto
// (almacen/inventario/actions.ts).
// ---------------------------------------------------------------------------

export type SalidaRegistrada = {
  id: string
  fecha: string
  createdAt: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  cantidad: number
  retira: string | null
  observaciones: string | null
  registradoPorNombre: string | null
  anuladaAt: string | null
  motivoAnulacion: string | null
}

export async function listarSalidasDelProyecto(proyectoId: string): Promise<SalidaRegistrada[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_salidas_proyecto", {
    p_proyecto_id: proyectoId,
  })
  if (error) throw new Error(error.message)

  return (data ?? []).map((s: any) => ({
    id: s.id,
    fecha: s.fecha,
    createdAt: s.created_at,
    insumoCodigo: s.insumo_codigo,
    insumoDescripcion: s.insumo_descripcion,
    insumoUm: s.insumo_um,
    cantidad: Number(s.cantidad),
    retira: s.retira,
    observaciones: s.observaciones,
    registradoPorNombre: s.registrado_por_nombre,
    anuladaAt: s.anulada_at,
    motivoAnulacion: s.motivo_anulacion,
  }))
}

export type DatosSalida = {
  proyectoId: string
  retira?: string | null
  observaciones?: string | null
  lineas: { insumoId: string; cantidad: number }[]
}

// Devuelve cuántas líneas se registraron.
export async function registrarSalida(datos: DatosSalida): Promise<number> {
  await requerirScope("admin_insumos")

  const lineas = datos.lineas.filter((l) => l.cantidad > 0)
  if (lineas.length === 0) {
    throw new Error("Ingresa la cantidad a sacar de al menos un insumo.")
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("registrar_salida_almacen", {
    p_proyecto_id: datos.proyectoId,
    p_lineas: lineas.map((l) => ({ insumo_id: l.insumoId, cantidad: l.cantidad })),
    p_retira: datos.retira ?? null,
    p_observaciones: datos.observaciones ?? null,
  })
  if (error) throw new Error(error.message)
  return data as number
}

export async function anularSalida(salidaId: string, motivo: string): Promise<void> {
  await requerirScope("admin_insumos")
  if (!motivo.trim()) throw new Error("El motivo de anulación es obligatorio.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("anular_salida_almacen", {
    p_salida_id: salidaId,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}
