"use server"

import { createClient } from "@/lib/supabase/server"

// ---------------------------------------------------------------------------
// Historial (registro de quién hizo qué y cuándo) de una orden de compra o de
// un pedido. Lo escriben disparadores de la base (ver
// 20261003000000_historial_y_pedidos.sql) y es inmutable. Ve el historial
// quien puede ver la orden o el pedido: la función SQL lo valida.
// ---------------------------------------------------------------------------

export type TipoHistorial = "orden_compra" | "pedido" | "requisicion" | "contrato"

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
  const { data, error } = await supabase.rpc("historial_entidad", { p_tipo: tipo, p_id: id })
  if (error) throw new Error(error.message)

  return ((data ?? []) as any[]).map((e) => ({
    id: e.id,
    evento: e.evento,
    usuarioNombre: e.usuario_nombre,
    motivo: e.motivo,
    datos: e.datos,
    createdAt: e.created_at,
  }))
}
