"use server"

// app/(app)/admin-tecnico/actions.ts

import { createClient } from "@/lib/supabase/server"

export type PedidoPendiente = {
  id: string
  grupoPedidoId: string
  cantidad: number
  fechaPedido: string
  fechaRequerida: string
  observaciones: string | null
  soporteUrl: string | null
  urgente: boolean
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  itemCodigo: string
  itemDescripcion: string
  presupuestoId: string
  presupuestoNombre: string
  proyectoId: string
  proyectoNombre: string
  solicitanteNombre: string | null
}

// Un solo viaje a la base de datos -- ahora que
// pedidos_insumos.solicitado_por apunta a perfiles(id) en vez de
// auth.users(id), PostgREST puede resolver ese embed directamente
// (ver migracion_fk_perfiles.sql), igual que ya hace con
// presupuesto_item -> presupuesto -> proyecto.
export async function verPedidosPendientes(): Promise<PedidoPendiente[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("pedidos_insumos")
    .select(`
      id, grupo_pedido_id, cantidad, created_at, fecha_requerida,
      observaciones, soporte_url, urgente,
      insumo:maestro_insumos(codigo, descripcion, u_m),
      presupuesto_item:presupuesto_items(
        codigo, descripcion,
        presupuesto:presupuestos(
          id, nombre,
          proyecto:proyectos(id, nombre)
        )
      ),
      solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre)
    `)
    .eq("estado", "pendiente")
    .order("urgente", { ascending: false })
    .order("created_at", { ascending: true })

  if (error) throw new Error(error.message)
  if (!data) return []

  return data.map((p: any) => ({
    id: p.id,
    grupoPedidoId: p.grupo_pedido_id,
    cantidad: p.cantidad,
    fechaPedido: p.created_at,
    fechaRequerida: p.fecha_requerida,
    observaciones: p.observaciones,
    soporteUrl: p.soporte_url,
    urgente: p.urgente,
    insumoCodigo: p.insumo?.codigo,
    insumoDescripcion: p.insumo?.descripcion,
    insumoUm: p.insumo?.u_m,
    itemCodigo: p.presupuesto_item?.codigo,
    itemDescripcion: p.presupuesto_item?.descripcion,
    presupuestoId: p.presupuesto_item?.presupuesto?.id,
    presupuestoNombre: p.presupuesto_item?.presupuesto?.nombre,
    proyectoId: p.presupuesto_item?.presupuesto?.proyecto?.id,
    proyectoNombre: p.presupuesto_item?.presupuesto?.proyecto?.nombre,
    solicitanteNombre: p.solicitante?.nombre ?? null,
  }))
}

// Aprobar/rechazar actúa sobre UNA fila (un id), no sobre todo el
// grupo_pedido_id -- el admin puede resolver cada línea de un pedido
// repartido por separado.
export async function resolverPedido(
  id: string,
  estado: "aprobado" | "rechazado",
  comentario?: string
) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error("No autenticado.")

  const { error } = await supabase
    .from("pedidos_insumos")
    .update({
      estado,
      resuelto_por: user.id,
      resuelto_at: new Date().toISOString(),
      comentario_resolucion: comentario ?? null,
    })
    .eq("id", id)

  if (error) throw new Error(error.message)
}