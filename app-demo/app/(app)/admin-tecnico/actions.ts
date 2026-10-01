"use server"

// app/(app)/admin-tecnico/actions.ts

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, obtenerPermisosRol, obtenerUsuarioId } from "@/lib/permisos"

export type EstadoAprobacion = "pendiente" | "aprobado" | "rechazado"

export type PedidoPendiente = {
  id: string
  estado: EstadoAprobacion
  resueltoAt: string | null
  // Solo rechazadas: el motivo (comentario_resolucion) y quién rechazó.
  motivoRechazo: string | null
  resueltoPorNombre: string | null
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
// desaprobarlos o cancelarlos, mientras no estén en una orden de compra);
// "rechazado" = historial de rechazos, con motivo y quién rechazó.
export async function verPedidosPorEstado(estado: EstadoAprobacion): Promise<PedidoPendiente[]> {
  await requerirAccion("aprobar_pedidos")
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("pedidos_insumos")
    .select(`
      id, grupo_pedido_id, cantidad, created_at, fecha_requerida, resuelto_at,
      observaciones, soporte_url, urgente, comentario_resolucion,
      insumo:maestro_insumos(codigo, descripcion, u_m),
      presupuesto_item:presupuesto_items(
        codigo, descripcion,
        presupuesto:presupuestos(
          id, nombre,
          proyecto:proyectos(id, nombre)
        )
      ),
      solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre),
      resolutor:perfiles!pedidos_insumos_resuelto_por_fkey(nombre)
    `)
    .eq("estado", estado)
    .order(estado === "pendiente" ? "urgente" : "resuelto_at", { ascending: false })
    .order("created_at", { ascending: estado === "pendiente" })
    .limit(estado === "pendiente" ? 1000 : 300)

  if (error) throw new Error(error.message)
  if (!data) return []

  return data.map((p: any) => ({
    id: p.id,
    estado,
    resueltoAt: p.resuelto_at,
    motivoRechazo: estado === "rechazado" ? p.comentario_resolucion ?? null : null,
    resueltoPorNombre: p.resolutor?.nombre ?? null,
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
  // El motivo del rechazo es obligatorio: es lo que le llega al ingeniero en
  // la notificación (trigger notificar_pedido_rechazado_tecnico usa
  // comentario_resolucion). Antes la pantalla rechazaba sin pedirlo y la
  // notificación decía "Motivo: (sin motivo)".
  const motivo = comentario?.trim() || null
  if (estado === "rechazado" && !motivo) throw new Error("Escribe el motivo del rechazo.")

  const supabase = await createClient()

  const userId = await obtenerUsuarioId()

  if (!userId) throw new Error("No autenticado.")

  const { error } = await supabase
    .from("pedidos_insumos")
    .update({
      estado,
      resuelto_por: userId,
      resuelto_at: new Date().toISOString(),
      comentario_resolucion: motivo,
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

// Cancelar el pedido de otra persona, o uno ya aprobado. Quien hizo un pedido
// pendiente lo cancela desde su propia pantalla (almacen/actions.cancelarPedido).
export async function cancelarPedidoComoAprobador(id: string, motivo: string) {
  await requerirAccion("cancelar_pedidos")
  if (!motivo.trim()) throw new Error("El motivo de cancelación es obligatorio.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("cancelar_pedido", {
    p_pedido_id: id,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}

export type PermisosPedidos = { aprobar: boolean; desaprobar: boolean; cancelar: boolean }

export async function obtenerPermisosPedidos(): Promise<PermisosPedidos> {
  const permisos = await obtenerPermisosRol()
  if (!permisos) return { aprobar: false, desaprobar: false, cancelar: false }
  const puede = (a: string) => permisos.esAdministrador || permisos.acciones.includes(a)
  return {
    aprobar: puede("aprobar_pedidos"),
    desaprobar: puede("desaprobar_pedidos"),
    cancelar: puede("cancelar_pedidos"),
  }
}
