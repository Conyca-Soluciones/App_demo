import type { createClient } from "@/lib/supabase/server"

// Líneas de requisiciones (cada una = un insumo en un ítem del presupuesto).
// Va FUERA de actions.ts porque lo usan dos pantallas (detalle y aprobación) y
// un archivo "use server" solo puede exportar funciones asíncronas que el
// cliente puede invocar -- esto es solo ayuda interna del servidor.

export type EstadoRequisicion = "pendiente" | "aprobada" | "rechazada" | "cancelada"
export type EstadoCompra = "completa" | "pendiente" | "rechazada_compras" | null

export type RequisicionResumen = {
  id: string
  numero: number
  proyectoId: string | null
  proyectoCodigo: string | null
  proyectoNombre: string | null
  solicitanteId: string | null
  solicitanteNombre: string | null
  fechaRequerida: string | null
  urgente: boolean
  observaciones: string | null
  soporteUrl: string | null
  createdAt: string
  nLineas: number
  estado: EstadoRequisicion
  estadoCompra: EstadoCompra
}

export type LineaRequisicion = {
  id: string
  insumoId: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  presupuestoItemId: string
  presupuestoId: string | null
  itemCodigo: string
  itemDescripcion: string
  cantidad: number
  comprado: number
  estado: "pendiente" | "aprobado" | "rechazado" | "cancelado"
  rechazadaPorCompras: boolean
  motivoRechazoCompras: string | null
}

export type LineaConResolucion = LineaRequisicion & {
  _resolutor: string | null
  _resueltoAt: string | null
  _comentario: string | null
  _motivoCancelacion: string | null
}

// Líneas de varias requisiciones (con cuánto de cada una ya está en órdenes de
// compra vigentes). Compartido por el detalle y por la pantalla de aprobación.
export async function cargarLineas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
): Promise<Map<string, LineaConResolucion[]>> {
  const porRequisicion = new Map<string, any[]>()
  if (ids.length === 0) return porRequisicion

  const { data, error } = await supabase
    .from("pedidos_insumos")
    .select(`
      id, grupo_pedido_id, cantidad, estado, resuelto_at, comentario_resolucion, motivo_cancelacion,
      rechazado_compras_at, observaciones_compras, presupuesto_item_id,
      insumo:maestro_insumos(id, codigo, descripcion, u_m),
      presupuesto_item:presupuesto_items(codigo, descripcion, presupuesto_id),
      resolutor:perfiles!pedidos_insumos_resuelto_por_fkey(nombre)
    `)
    .in("grupo_pedido_id", ids)
    .order("created_at", { ascending: true })
  if (error) throw new Error(error.message)

  const lineas = (data ?? []) as any[]
  const { data: comprados, error: errorComprados } = await supabase.rpc("comprado_pedidos", {
    p_ids: lineas.map((l) => l.id),
  })
  if (errorComprados) throw new Error(errorComprados.message)
  const compradoPorId = new Map(
    ((comprados ?? []) as { pedido_id: string; comprado: number }[]).map((c) => [c.pedido_id, Number(c.comprado)])
  )

  for (const l of lineas) {
    const arr = porRequisicion.get(l.grupo_pedido_id) ?? []
    arr.push({
      id: l.id,
      insumoId: l.insumo?.id,
      insumoCodigo: l.insumo?.codigo,
      insumoDescripcion: l.insumo?.descripcion ?? "(insumo eliminado)",
      insumoUm: l.insumo?.u_m ?? null,
      presupuestoItemId: l.presupuesto_item_id,
      presupuestoId: l.presupuesto_item?.presupuesto_id ?? null,
      itemCodigo: l.presupuesto_item?.codigo ?? "",
      itemDescripcion: l.presupuesto_item?.descripcion ?? "",
      cantidad: Number(l.cantidad),
      comprado: compradoPorId.get(l.id) ?? 0,
      estado: l.estado,
      rechazadaPorCompras: l.rechazado_compras_at !== null,
      motivoRechazoCompras: l.observaciones_compras ?? null,
      _resolutor: l.resolutor?.nombre ?? null,
      _resueltoAt: l.resuelto_at,
      _comentario: l.comentario_resolucion,
      _motivoCancelacion: l.motivo_cancelacion,
    })
    porRequisicion.set(l.grupo_pedido_id, arr)
  }
  return porRequisicion
}

export function mapResumen(r: any): RequisicionResumen {
  return {
    id: r.id,
    numero: Number(r.numero),
    proyectoId: r.proyecto_id,
    proyectoCodigo: r.proyecto_codigo,
    proyectoNombre: r.proyecto_nombre,
    solicitanteId: r.solicitado_por,
    solicitanteNombre: r.solicitante_nombre,
    fechaRequerida: r.fecha_requerida,
    urgente: r.urgente,
    observaciones: r.observaciones,
    soporteUrl: r.soporte_url,
    createdAt: r.created_at,
    nLineas: r.n_lineas,
    estado: r.estado,
    estadoCompra: r.estado_compra,
  }
}

