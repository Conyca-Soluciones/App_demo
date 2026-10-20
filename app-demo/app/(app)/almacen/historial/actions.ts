"use server"

import { createClient } from "@/lib/supabase/server"

// ---------------------------------------------------------------------------
// Historial (registro de quién hizo qué y cuándo) de una orden de compra o de
// un pedido. Lo escriben disparadores de la base (ver
// 20261003000000_historial_y_pedidos.sql) y es inmutable. Ve el historial
// quien puede ver la orden o el pedido: la función SQL lo valida.
// ---------------------------------------------------------------------------

export type TipoHistorial = "orden_compra" | "pedido" | "requisicion" | "contrato" | "acta" | "otrosi"

export type EventoHistorial = {
  id: string
  evento: string
  usuarioNombre: string | null
  motivo: string | null
  datos: Record<string, any> | null
  createdAt: string
}

export async function obtenerHistorial(tipo: TipoHistorial, id: string): Promise<EventoHistorial[]> {
  const supabase = await createClient()
  // El otrosí tiene su propia función (20261119000000_otrosis.sql): el
  // ingeniero que lo pide puede no tener permiso para ver el contrato.
  // El contrato suma los eventos de sus otrosí (otrosi_creado,
  // otrosi_aprobado..., 20261122000000), ordenados por fecha con los suyos. Si
  // esa parte falla (migración sin correr, sin permiso) sale el del contrato solo.
  const [principal, deOtrosis] = await Promise.all([
    tipo === "otrosi"
      ? supabase.rpc("historial_otrosi", { p_id: id })
      : supabase.rpc("historial_entidad", { p_tipo: tipo, p_id: id }),
    tipo === "contrato" ? supabase.rpc("historial_otrosis_de_contrato", { p_contrato_id: id }) : null,
  ])
  if (principal.error) throw new Error(principal.error.message)
  const eventos = (principal.data ?? []) as any[]
  const otros = deOtrosis && !deOtrosis.error ? ((deOtrosis.data ?? []) as any[]) : []
  const todos =
    otros.length === 0
      ? eventos
      : [...eventos, ...otros].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))

  return todos.map((e) => ({
    id: e.id,
    evento: e.evento,
    usuarioNombre: e.usuario_nombre,
    motivo: e.motivo,
    datos: e.datos,
    createdAt: e.created_at,
  }))
}
