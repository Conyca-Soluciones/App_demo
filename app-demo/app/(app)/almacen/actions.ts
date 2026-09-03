"use server"

// app/(app)/almacen/actions.ts

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosUsuario } from "@/lib/permisos"
import type { InsumoAgrupado, PresupuestoActivo } from "./types"

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

export type NuevoPedidoInput = {
  insumoId: string
  items: ItemDePedido[]
  fechaRequerida: string
  urgente: boolean
  observaciones: string | null
  soporteUrl: string | null
}

// Revalida en el servidor antes de insertar -- dos cosas:
//
//  1. Tope de cantidad: ahora usa disponible_insumo_item, una consulta
//     PUNTUAL (un insumo, un ítem) en vez de buscar_insumos_presupuesto
//     con p_limite:1000 -- ya no trae ni descarta cientos de filas
//     irrelevantes solo para revalidar una. Resuelve el punto 5
//     (crearPedido no debía volver a llamar la búsqueda completa).
//
//  2. Duplicado exacto: si YA existe un pedido PENDIENTE para el mismo
//     insumo + mismo ítem + misma cantidad + misma fecha_requerida, se
//     bloquea -- evita que un doble clic o un refresh accidental cree
//     el mismo pedido dos veces. Solo compara contra pendientes (un
//     pedido ya aprobado o rechazado no cuenta como "el mismo pedido
//     en curso").
export async function crearPedido(input: NuevoPedidoInput) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("No autenticado.")
  }

  if (input.items.length === 0) {
    throw new Error("Selecciona al menos un ítem del presupuesto para este pedido.")
  }

  for (const item of input.items) {
    // -- 1. Tope de cantidad (consulta puntual) --
    const { data: disponible, error: errorDisponible } = await supabase.rpc(
      "disponible_insumo_item",
      {
        p_presupuesto_item_id: item.presupuestoItemId,
        p_insumo_id: input.insumoId,
      }
    )
    if (errorDisponible) throw new Error(errorDisponible.message)

    if (item.cantidad > (disponible ?? 0)) {
      throw new Error(
        `Una de las cantidades pedidas supera lo disponible del presupuesto (máximo ${disponible ?? 0}).`
      )
    }

    // -- 2. Duplicado exacto contra pendientes --
    const { data: duplicado, error: errorDuplicado } = await supabase
      .from("pedidos_insumos")
      .select("id")
      .eq("presupuesto_item_id", item.presupuestoItemId)
      .eq("insumo_id", input.insumoId)
      .eq("cantidad", item.cantidad)
      .eq("fecha_requerida", input.fechaRequerida)
      .eq("estado", "pendiente")
      .limit(1)
      .maybeSingle()

    if (errorDuplicado) throw new Error(errorDuplicado.message)

    if (duplicado) {
      throw new Error(
        "Ya existe un pedido pendiente idéntico (mismo insumo, ítem, cantidad y fecha requerida). " +
          "Revisa el registro de pedidos antes de crear uno nuevo."
      )
    }
  }

  const grupoPedidoId = crypto.randomUUID()

  const filas = input.items.map((it) => ({
    grupo_pedido_id: grupoPedidoId,
    presupuesto_item_id: it.presupuestoItemId,
    item_apu_id: it.itemApuId,
    insumo_id: input.insumoId,
    cantidad: it.cantidad,
    fecha_requerida: input.fechaRequerida,
    urgente: input.urgente,
    observaciones: input.observaciones,
    soporte_url: input.soporteUrl,
    solicitado_por: user.id,
  }))

  const { error } = await supabase.from("pedidos_insumos").insert(filas)
  if (error) throw new Error(error.message)

  return { grupoPedidoId, filasCreadas: filas.length }
}

// ---------------------------------------------------------------------------
// Cancelar pedido -- el ingeniero solo puede cancelar SU PROPIO pedido,
// y solo mientras siga 'pendiente' (una vez aprobado/rechazado, ya no
// se puede cancelar -- eso queda como registro histórico). La RLS
// (ver 04_rls_cancelar.sql) refuerza esto mismo del lado de la base de
// datos, no solo acá.
// ---------------------------------------------------------------------------

export async function cancelarPedido(id: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("No autenticado.")
  }

  const { data: pedido, error: errorLectura } = await supabase
    .from("pedidos_insumos")
    .select("id, estado, solicitado_por")
    .eq("id", id)
    .single()

  if (errorLectura) throw new Error(errorLectura.message)

  if (pedido.solicitado_por !== user.id) {
    throw new Error("Solo puedes cancelar pedidos que tú mismo hayas creado.")
  }

  if (pedido.estado !== "pendiente") {
    throw new Error("Este pedido ya fue resuelto y no se puede cancelar.")
  }

  const { error } = await supabase.from("pedidos_insumos").delete().eq("id", id)
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
  estado: "pendiente" | "aprobado" | "rechazado"
  solicitanteId: string | null
  solicitanteNombre: string | null
  comentarioResolucion: string | null
  resueltoAt: string | null
}

export async function verPedidosDeProyecto(
  proyectoId: string,
  estado?: "pendiente" | "aprobado" | "rechazado"
): Promise<PedidoRegistro[]> {
  const supabase = await createClient()

  let query = supabase
    .from("pedidos_insumos")
    .select(`
      id, grupo_pedido_id, cantidad, created_at, fecha_requerida,
      urgente, observaciones, estado, comentario_resolucion, resuelto_at,
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
  }))
}