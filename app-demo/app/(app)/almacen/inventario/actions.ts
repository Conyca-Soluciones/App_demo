"use server"

import { createClient } from "@/lib/supabase/server"

// ---------------------------------------------------------------------------
// INVENTARIO de bodega por proyecto = entradas - salidas. Todo el cálculo y
// el chequeo de permiso viven en la función SQL inventario_proyecto (ver
// 20260930100000_inventario_almacen.sql). Se pide como un solo jsonb
// (inventario_proyecto_completo): una fila por insumo se cortaba en 1000 y
// en Salidas un insumo fuera de esas filas salía "sin disponible".
// ---------------------------------------------------------------------------

export type InsumoInventario = {
  insumoId: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  cantidadEntrada: number
  cantidadSalida: number
  cantidadDisponible: number
  costoPromedio: number
  valorInventario: number
}

export async function obtenerInventarioProyecto(proyectoId: string): Promise<InsumoInventario[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("inventario_proyecto_completo", {
    p_proyecto_id: proyectoId,
  })
  if (error) throw new Error(error.message)

  return ((data ?? []) as any[]).map((f: any) => ({
    insumoId: f.insumo_id,
    insumoCodigo: f.insumo_codigo,
    insumoDescripcion: f.insumo_descripcion,
    insumoUm: f.insumo_um,
    cantidadEntrada: Number(f.cantidad_entrada),
    cantidadSalida: Number(f.cantidad_salida),
    cantidadDisponible: Number(f.cantidad_disponible),
    costoPromedio: Number(f.costo_promedio),
    valorInventario: Number(f.valor_inventario),
  }))
}
