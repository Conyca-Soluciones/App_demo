"use server"

// app/(app)/almacen/actions.ts

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosUsuario } from "@/lib/permisos"
import { MAX_INSUMOS_POR_PEDIDO, type InsumoAgrupado, type PresupuestoActivo } from "./types"

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

export async function verProyectos() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("No autenticado.")
  }

  const permisos = await obtenerPermisosUsuario(user.id)

  if (permisos.veTodosProyectos) {
    const { data, error } = await supabase
      .from("proyectos")
      .select("id, codigo, nombre")
      .order("codigo", { ascending: false, nullsFirst: false })
    if (error) throw new Error(error.message)
    return data
  }

  const idsPermitidos = Array.from(permisos.proyectos.keys())
  if (idsPermitidos.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from("proyectos")
    .select("id, codigo, nombre")
    .in("id", idsPermitidos)
    .order("codigo", { ascending: false, nullsFirst: false })

  if (error) throw new Error(error.message)
  return data
}

// ---------------------------------------------------------------------------
// Presupuesto activo del proyecto (presupuesto + versión vigente). Un
// proyecto tiene, como mucho, un presupuesto (constraint
// presupuestos_proyecto_id_unique) -- ver CLAUDE.md "Presupuesto único
// por proyecto".
// ---------------------------------------------------------------------------

export async function buscarPresupuestoActivo(
  proyectoId: string
): Promise<PresupuestoActivo | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("presupuestos")
    .select("id, version_actual_id")
    .eq("proyecto_id", proyectoId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data || !data.version_actual_id) return null

  return {
    presupuestoId: data.id,
    versionActualId: data.version_actual_id,
  }
}



//Buscar insumos para pedidos. En la cuenta se cuentan APROBADOS y PENDIENTES 
//Para asegurarse que no se sobrepasen los topes de cantidad en el presupuestos
export async function buscarInsumos(
  versionId: string,
  query: string
): Promise<InsumoAgrupado[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("buscar_insumos_presupuesto", {
    p_version_id: versionId,
    p_query: query,
    p_limite: 50,
  })

  if (error) throw new Error(error.message)
  if (!data) return []

  const mapa = new Map<string, InsumoAgrupado>()
  for (const fila of data) {
    if (!mapa.has(fila.insumo_id)) {
      mapa.set(fila.insumo_id, {
        insumoId: fila.insumo_id,
        insumoCodigo: fila.insumo_codigo,
        insumoDescripcion: fila.insumo_descripcion,
        insumoUm: fila.insumo_um,
        items: [],
      })
    }
    mapa.get(fila.insumo_id)!.items.push({
      presupuestoItemId: fila.presupuesto_item_id,
      itemCodigo: fila.item_codigo,
      itemDescripcion: fila.item_descripcion,
      itemApuId: fila.item_apu_id,
      cantidadDisponible: fila.cantidad_disponible,
    })
  }

  return [...mapa.values()]
}

// ---------------------------------------------------------------------------
// Crear pedido
// ---------------------------------------------------------------------------

export type ItemDePedido = {
  presupuestoItemId: string
  itemApuId: string | null
  cantidad: number
}

export type InsumoDePedido = {
  insumoId: string
  items: ItemDePedido[]
}

// Un pedido reúne hasta MAX_INSUMOS_POR_PEDIDO insumos (ver types.ts); cada
// insumo puede repartirse entre varios ítems del presupuesto. Todas las
// filas comparten grupo_pedido_id, fecha, urgencia y observaciones.
export type NuevoPedidoInput = {
  insumos: InsumoDePedido[]
  fechaRequerida: string
  urgente: boolean
  observaciones: string | null
  soporteUrl: string | null
}

// Ejecuta fn sobre cada elemento en tandas paralelas (un pedido de 50
// insumos puede implicar cientos de consultas de validación).
async function enTandas<T, R>(xs: T[], tam: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < xs.length; i += tam) {
    out.push(...(await Promise.all(xs.slice(i, i + tam).map(fn))))
  }
  return out
}

// Revalida en el servidor antes de insertar -- tres cosas:
//
//  0. Forma: entre 1 y MAX_INSUMOS_POR_PEDIDO insumos distintos, cada uno
//     con al menos un ítem y cantidades positivas.
//
//  1. Tope de cantidad: disponible_insumo_item, una consulta PUNTUAL
//     (un insumo, un ítem), para cada combinación del pedido.
//
//  2. Duplicado exacto: si YA existe un pedido PENDIENTE para el mismo
//     insumo + mismo ítem + misma cantidad + misma fecha_requerida, se
//     bloquea -- evita que un doble clic o un refresh accidental cree
//     el mismo pedido dos veces. Solo compara contra pendientes.
//
// El insert final es UNO solo: o se crean todas las filas del pedido o
// ninguna.
export async function crearPedido(input: NuevoPedidoInput) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("No autenticado.")
  }

  // -- 0. Forma del pedido --
  if (input.insumos.length === 0) {
    throw new Error("Agrega al menos un insumo al pedido.")
  }
  if (input.insumos.length > MAX_INSUMOS_POR_PEDIDO) {
    throw new Error(`Un pedido puede tener máximo ${MAX_INSUMOS_POR_PEDIDO} insumos.`)
  }
  if (new Set(input.insumos.map((i) => i.insumoId)).size !== input.insumos.length) {
    throw new Error("Hay un insumo repetido en el pedido.")
  }
  for (const ins of input.insumos) {
    if (ins.items.length === 0) {
      throw new Error("Cada insumo del pedido necesita al menos un ítem del presupuesto.")
    }
    if (new Set(ins.items.map((it) => it.presupuestoItemId)).size !== ins.items.length) {
      throw new Error("Un insumo tiene el mismo ítem del presupuesto repetido.")
    }
    for (const it of ins.items) {
      if (!Number.isFinite(it.cantidad) || it.cantidad <= 0) {
        throw new Error("Todas las cantidades del pedido deben ser mayores que cero.")
      }
    }
  }

  const nombreInsumo = async (insumoId: string) => {
    const { data } = await supabase
      .from("maestro_insumos")
      .select("descripcion")
      .eq("id", insumoId)
      .maybeSingle()
    return data?.descripcion ?? "un insumo"
  }

  // -- 1. Tope de cantidad (consulta puntual por insumo + ítem) --
  const pares = input.insumos.flatMap((ins) =>
    ins.items.map((it) => ({ insumoId: ins.insumoId, item: it }))
  )
  const topes = await enTandas(pares, 10, async ({ insumoId, item }) => {
    const { data, error } = await supabase.rpc("disponible_insumo_item", {
      p_presupuesto_item_id: item.presupuestoItemId,
      p_insumo_id: insumoId,
    })
    if (error) throw new Error(error.message)
    return { insumoId, cantidad: item.cantidad, disponible: Number(data ?? 0) }
  })
  const excedido = topes.find((t) => t.cantidad > t.disponible)
  if (excedido) {
    throw new Error(
      `La cantidad pedida de "${await nombreInsumo(excedido.insumoId)}" supera lo disponible del presupuesto (máximo ${excedido.disponible}).`
    )
  }

  // -- 2. Duplicado exacto contra pendientes (una consulta por insumo) --
  const duplicados = await enTandas(input.insumos, 10, async (ins) => {
    const { data, error } = await supabase
      .from("pedidos_insumos")
      .select("presupuesto_item_id, cantidad")
      .eq("insumo_id", ins.insumoId)
      .eq("fecha_requerida", input.fechaRequerida)
      .eq("estado", "pendiente")
      .in("presupuesto_item_id", ins.items.map((it) => it.presupuestoItemId))
    if (error) throw new Error(error.message)

    const choca = (data ?? []).some((f: any) =>
      ins.items.some(
        (it) => it.presupuestoItemId === f.presupuesto_item_id && it.cantidad === Number(f.cantidad)
      )
    )
    return choca ? ins.insumoId : null
  })
  const insumoDuplicado = duplicados.find((d) => d !== null)
  if (insumoDuplicado) {
    throw new Error(
      `Ya existe un pedido pendiente idéntico de "${await nombreInsumo(insumoDuplicado)}" ` +
        "(mismo ítem, cantidad y fecha requerida). Revisa el registro de pedidos antes de crear uno nuevo."
    )
  }

  const grupoPedidoId = crypto.randomUUID()

  const filas = input.insumos.flatMap((ins) =>
    ins.items.map((it) => ({
      grupo_pedido_id: grupoPedidoId,
      presupuesto_item_id: it.presupuestoItemId,
      item_apu_id: it.itemApuId,
      insumo_id: ins.insumoId,
      cantidad: it.cantidad,
      fecha_requerida: input.fechaRequerida,
      urgente: input.urgente,
      observaciones: input.observaciones,
      soporte_url: input.soporteUrl,
      solicitado_por: user.id,
    }))
  )

  const { error } = await supabase.from("pedidos_insumos").insert(filas)
  if (error) throw new Error(error.message)

  return { grupoPedidoId, filasCreadas: filas.length, insumosCreados: input.insumos.length }
}

// ---------------------------------------------------------------------------
// Cancelar pedido -- el ingeniero solo puede cancelar SU PROPIO pedido,
// y solo mientras siga 'pendiente' (una vez aprobado/rechazado, ya no
// se puede cancelar -- eso queda como registro histórico). La RLS
// (ver 04_rls_cancelar.sql) refuerza esto mismo del lado de la base de
// datos, no solo acá.
// ---------------------------------------------------------------------------

export async function cancelarPedido(id: string, motivo: string) {
  if (!motivo.trim()) throw new Error("El motivo de cancelación es obligatorio.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("cancelar_pedido", {
    p_pedido_id: id,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}

// Modificar un pedido: solo quien lo hizo y solo mientras está pendiente de
// aprobación (lo valida la base). No cambia el insumo ni el ítem: para eso se
// cancela y se crea otro.
export type CambiosPedido = {
  cantidad: number
  fechaRequerida: string
  urgente: boolean
  observaciones: string | null
}

export async function modificarPedido(id: string, cambios: CambiosPedido) {
  if (!(cambios.cantidad > 0)) throw new Error("La cantidad debe ser mayor que cero.")
  if (!cambios.fechaRequerida) throw new Error("La fecha requerida es obligatoria.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("modificar_pedido", {
    p_pedido_id: id,
    p_cantidad: cambios.cantidad,
    p_fecha_requerida: cambios.fechaRequerida,
    p_urgente: cambios.urgente,
    p_observaciones: cambios.observaciones,
  })
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------------------
// Registro de pedidos del proyecto (todos los solicitantes, filtrable
// por estado) -- ver actions-verPedidosDeProyecto.ts de la respuesta
// anterior, se mantiene sin cambios; se incluye acá para que este
// archivo quede completo si se usa como reemplazo directo.
// ---------------------------------------------------------------------------

export type PedidoRegistro = {
  id: string
  grupoPedidoId: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  itemCodigo: string
  itemDescripcion: string
  cantidad: number
  fechaPedido: string
  fechaRequerida: string
  urgente: boolean
  observaciones: string | null
  estado: "pendiente" | "aprobado" | "rechazado" | "cancelado"
  solicitanteId: string | null
  solicitanteNombre: string | null
  comentarioResolucion: string | null
  resueltoAt: string | null
  motivoCancelacion: string | null
  // Para el diálogo de modificar: cuánto se puede pedir como máximo no se
  // conoce acá; lo valida la base al guardar.
}

export async function verPedidosDeProyecto(
  proyectoId: string,
  estado?: "pendiente" | "aprobado" | "rechazado" | "cancelado"
): Promise<PedidoRegistro[]> {
  const supabase = await createClient()

  let query = supabase
    .from("pedidos_insumos")
    .select(`
      id, grupo_pedido_id, cantidad, created_at, fecha_requerida,
      urgente, observaciones, estado, comentario_resolucion, resuelto_at, motivo_cancelacion,
      solicitado_por,
      insumo:maestro_insumos(codigo, descripcion, u_m),
      presupuesto_item:presupuesto_items!inner(
        codigo, descripcion,
        presupuesto:presupuestos!inner(proyecto_id)
      ),
      solicitante:perfiles!pedidos_insumos_solicitado_por_fkey(nombre)
    `)
    .eq("presupuesto_item.presupuesto.proyecto_id", proyectoId)
    .order("created_at", { ascending: false })

  if (estado) {
    query = query.eq("estado", estado)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }
  if (!data) return []

  return data.map((p: any) => ({
    id: p.id,
    grupoPedidoId: p.grupo_pedido_id,
    insumoCodigo: p.insumo?.codigo,
    insumoDescripcion: p.insumo?.descripcion,
    insumoUm: p.insumo?.u_m,
    itemCodigo: p.presupuesto_item?.codigo,
    itemDescripcion: p.presupuesto_item?.descripcion,
    cantidad: p.cantidad,
    fechaPedido: p.created_at,
    fechaRequerida: p.fecha_requerida,
    urgente: p.urgente,
    observaciones: p.observaciones,
    estado: p.estado,
    solicitanteId: p.solicitado_por,
    solicitanteNombre: p.solicitante?.nombre ?? null,
    comentarioResolucion: p.comentario_resolucion,
    resueltoAt: p.resuelto_at,
    motivoCancelacion: p.motivo_cancelacion,
  }))
}