"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAdmin } from "@/lib/permisos"

// ---------------------------------------------------------------------------
// Panel admin/visualizacion -- estado de obra: cuánto se ha comprado (vía OC
// aprobadas) y cuánto ha SALIDO de bodega hacia obra (vía salidas_insumos)
// frente a lo presupuestado, por proyecto y por insumo. Comprado != avance
// real: lo que de verdad mide ejecución de obra es lo que salió de bodega.
//
// El cruce presupuesto_items + item_apu + pedidos_insumos + ordenes_compra
// vive en la función SQL `resumen_ejecucion_proyecto` (security definer).
// Es un agregado a través de tablas con RLS pensada para flujos distintos
// (ingeniero/compras/admin), no para esta vista cruzada -- el gate de
// autorización (solo admin) vive acá, no en la función SQL.
//
// Importante (corregido en la migración `fix_valor_presupuestado_resumen_
// ejecucion`): el valor presupuestado por insumo se calcula como
// cantidad_item × cantidad_apu × precio_unitario_del_insumo (con IVA, vía
// maestro_insumos.vr_neto) -- NO como una porción de
// presupuesto_items.valor_total, que es el total del ítem completo (mano
// de obra + equipo + transporte + materiales) y se estaba sumando
// completo una vez por cada insumo del ítem cuando el ítem tenía varios
// materiales. Se usa vr_neto (con IVA) para que sea comparable contra
// "comprado", que ya incluye IVA de la orden de compra.
// ---------------------------------------------------------------------------

export type ProyectoParaVisualizacion = { id: string; codigo: string | null; nombre: string }

export async function listarProyectosParaVisualizacion(): Promise<ProyectoParaVisualizacion[]> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proyectos")
    .select("id, codigo, nombre")
    .order("codigo", { ascending: false, nullsFirst: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export type InsumoEjecucion = {
  insumoId: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  cantidadPresupuestada: number
  valorPresupuestado: number
  cantidadPedida: number
  cantidadComprada: number
  valorComprado: number
  cantidadSalida: number
  valorSalida: number
}

export type OrdenCompraEstado = "pendiente_aprobacion" | "aprobada" | "rechazada"

export type OrdenCompraResumenEstado = {
  id: string
  numero: number
  estado: OrdenCompraEstado
  proveedorNombre: string
  createdAt: string
}

export type ResumenEjecucionProyecto = {
  insumos: InsumoEjecucion[]
  ordenes: OrdenCompraResumenEstado[]
}

export async function obtenerResumenEjecucion(proyectoId: string): Promise<ResumenEjecucionProyecto> {
  await requerirAdmin()
  const supabase = await createClient()

  const [{ data: insumos, error: errorInsumos }, { data: ordenes, error: errorOrdenes }] = await Promise.all([
    supabase.rpc("resumen_ejecucion_proyecto", { p_proyecto_id: proyectoId }),
    supabase
      .from("ordenes_compra")
      .select(
        `
        id, numero, estado, created_at,
        proveedor:proveedores!ordenes_compra_proveedor_id_fkey(nombre)
      `
      )
      .eq("proyecto_id", proyectoId)
      .order("created_at", { ascending: false }),
  ])

  if (errorInsumos) throw new Error(errorInsumos.message)
  if (errorOrdenes) throw new Error(errorOrdenes.message)

  return {
    insumos: (insumos ?? []).map((i: any) => ({
      insumoId: i.insumo_id,
      insumoCodigo: i.insumo_codigo,
      insumoDescripcion: i.insumo_descripcion,
      insumoUm: i.insumo_um,
      cantidadPresupuestada: Number(i.cantidad_presupuestada),
      valorPresupuestado: Number(i.valor_presupuestado),
      cantidadPedida: Number(i.cantidad_pedida),
      cantidadComprada: Number(i.cantidad_comprada),
      valorComprado: Number(i.valor_comprado),
      cantidadSalida: Number(i.cantidad_salida),
      valorSalida: Number(i.valor_salida),
    })),
    ordenes: (ordenes ?? []).map((o: any) => ({
      id: o.id,
      numero: o.numero,
      estado: o.estado,
      proveedorNombre: o.proveedor?.nombre ?? "(proveedor eliminado)",
      createdAt: o.created_at,
    })),
  }
}