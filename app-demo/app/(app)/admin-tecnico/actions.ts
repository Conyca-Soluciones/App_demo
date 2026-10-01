"use server"

// app/(app)/admin-tecnico/actions.ts

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, obtenerPermisosRol, obtenerUsuarioId } from "@/lib/permisos"

export type PedidoPendiente = {
  id: string
  estado: "pendiente" | "aprobado"
  resueltoAt: string | null
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
// "pendiente" = cola de aprobación; "aprobado" = ya aprobados (para poder
// desaprobarlos, mientras no estén en una orden de compra).
export async function verPedidosPorEstado(
  estado: "pendiente" | "aprobado"
): Promise<PedidoPendiente[]> {
  await requerirAccion("aprobar_pedidos")
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("pedidos_insumos")
    .select(`
      id, grupo_pedido_id, cantidad, created_at, fecha_requerida, resuelto_at,
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
    .eq("estado", estado)
    .order(estado === "pendiente" ? "urgente" : "resuelto_at", { ascending: false })
    .order("created_at", { ascending: estado === "pendiente" })
    .limit(estado === "aprobado" ? 300 : 1000)

  if (error) throw new Error(error.message)
  if (!data) return []

  return data.map((p: any) => ({
    id: p.id,
    estado,
    resueltoAt: p.resuelto_at,
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
  await requerirAccion("aprobar_pedidos")
  const supabase = await createClient()

  const userId = await obtenerUsuarioId()

  if (!userId) throw new Error("No autenticado.")

  const { error } = await supabase
    .from("pedidos_insumos")
    .update({
      estado,
      resuelto_por: userId,
      resuelto_at: new Date().toISOString(),
      comentario_resolucion: comentario ?? null,
    })
    .eq("id", id)

  if (error) throw new Error(error.message)
}
// Devuelve un pedido aprobado a pendiente. Solo si ninguna orden de compra
// activa lo usa (lo valida la base). Motivo obligatorio.
export async function desaprobarPedido(id: string, motivo: string) {
  await requerirAccion("desaprobar_pedidos")
  if (!motivo.trim()) throw new Error("El motivo es obligatorio.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("desaprobar_pedido", {
    p_pedido_id: id,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}

export type PermisosPedidos = { aprobar: boolean; desaprobar: boolean }

export async function obtenerPermisosPedidos(): Promise<PermisosPedidos> {
  const permisos = await obtenerPermisosRol()
  if (!permisos) return { aprobar: false, desaprobar: false }
  const puede = (a: string) => permisos.esAdministrador || permisos.acciones.includes(a)
  return {
    aprobar: puede("aprobar_pedidos"),
    desaprobar: puede("desaprobar_pedidos"),
  }
}
