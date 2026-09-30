"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirScope } from "@/lib/permisos"

// ---------------------------------------------------------------------------
// ENTRADAS de almacén -- recepción de material contra órdenes de compra.
// Las OC aprobadas aparecen mientras su estado_entrega sea sin_entregar o
// entrega_parcial; al completarse todas las líneas pasan a 'entregada' y
// dejan de listarse. Toda la lógica (tope por línea, cambio de estado) vive
// en las funciones SQL de 20260930000000_entradas_almacen.sql, que además
// validan el permiso (es_admin / admin_insumos).
// ---------------------------------------------------------------------------

export type EstadoEntrega = "sin_entregar" | "entrega_parcial" | "entregada"

export type OrdenParaEntrada = {
  id: string
  numero: number
  estadoEntrega: EstadoEntrega
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  fechaEntrega: string | null
  totalLineas: number
  cantidadOrdenada: number
  cantidadRecibida: number
}

export async function listarOrdenesParaEntrada(): Promise<OrdenParaEntrada[]> {
  await requerirScope("admin_insumos")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_ordenes_para_entrada")
  if (error) throw new Error(error.message)

  return (data ?? []).map((o: any) => ({
    id: o.id,
    numero: o.numero,
    estadoEntrega: o.estado_entrega,
    proyectoCodigo: o.proyecto_codigo,
    proyectoNombre: o.proyecto_nombre,
    proveedorNombre: o.proveedor_nombre ?? "(proveedor eliminado)",
    fechaEntrega: o.fecha_entrega,
    totalLineas: Number(o.total_lineas),
    cantidadOrdenada: Number(o.cantidad_ordenada),
    cantidadRecibida: Number(o.cantidad_recibida),
  }))
}

export type LineaEntrada = {
  id: string // ordenes_compra_items.id
  insumoCodigo: number
  insumoDescripcion: string
  um: string | null
  cantidadOrdenada: number
  cantidadRecibida: number
  cantidadPendiente: number
}

export type EntradaRegistrada = {
  id: string
  numero: number
  remision: string | null
  observaciones: string | null
  recibidoPor: string | null
  createdAt: string
  lineas: { insumoDescripcion: string; um: string | null; cantidad: number }[]
}

export type DetalleOrdenEntrada = {
  id: string
  numero: number
  estadoEntrega: EstadoEntrega
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  lineas: LineaEntrada[]
  entradas: EntradaRegistrada[]
}

export async function obtenerDetalleOrdenParaEntrada(
  ordenId: string
): Promise<DetalleOrdenEntrada> {
  await requerirScope("admin_insumos")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("detalle_orden_para_entrada", {
    p_orden_id: ordenId,
  })
  if (error) throw new Error(error.message)

  const d = data as any
  return {
    id: d.id,
    numero: d.numero,
    estadoEntrega: d.estado_entrega,
    proyectoCodigo: d.proyecto_codigo,
    proyectoNombre: d.proyecto_nombre,
    proveedorNombre: d.proveedor_nombre ?? "(proveedor eliminado)",
    lineas: (d.lineas ?? []).map((l: any) => ({
      id: l.id,
      insumoCodigo: l.insumo_codigo,
      insumoDescripcion: l.insumo_descripcion,
      um: l.um,
      cantidadOrdenada: Number(l.cantidad_ordenada),
      cantidadRecibida: Number(l.cantidad_recibida),
      cantidadPendiente: Number(l.cantidad_pendiente),
    })),
    entradas: (d.entradas ?? []).map((e: any) => ({
      id: e.id,
      numero: e.numero,
      remision: e.remision,
      observaciones: e.observaciones,
      recibidoPor: e.recibido_por,
      createdAt: e.created_at,
      lineas: (e.lineas ?? []).map((l: any) => ({
        insumoDescripcion: l.insumo_descripcion,
        um: l.um,
        cantidad: Number(l.cantidad),
      })),
    })),
  }
}

export type DatosEntrada = {
  ordenId: string
  remision?: string | null
  observaciones?: string | null
  lineas: { ordenCompraItemId: string; cantidad: number }[]
}

// Devuelve el estado_entrega en el que quedó la OC tras registrar la entrada.
export async function registrarEntrada(datos: DatosEntrada): Promise<EstadoEntrega> {
  await requerirScope("admin_insumos")

  const lineas = datos.lineas.filter((l) => l.cantidad > 0)
  if (lineas.length === 0) {
    throw new Error("Ingresa la cantidad recibida de al menos un insumo.")
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("registrar_entrada_almacen", {
    p_orden_id: datos.ordenId,
    p_remision: datos.remision ?? null,
    p_observaciones: datos.observaciones ?? null,
    p_lineas: lineas.map((l) => ({
      orden_compra_item_id: l.ordenCompraItemId,
      cantidad: l.cantidad,
    })),
  })
  if (error) throw new Error(error.message)

  const detalle = await obtenerDetalleOrdenParaEntrada(datos.ordenId)
  return detalle.estadoEntrega
}
