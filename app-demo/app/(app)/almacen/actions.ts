"use server"

import { esCantidadEnteraPositiva } from "@/lib/numeros"

// app/(app)/almacen/actions.ts

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, obtenerPermisosUsuario, obtenerUsuarioId } from "@/lib/permisos"
import { hoyColombia } from "@/lib/fechas"
import { normalizarDireccion, validarDireccion } from "@/lib/direccion-entrega"
import { cookies } from "next/headers"
import { COOKIE_PROYECTO } from "@/lib/proyecto-actual"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { limiteBusqueda, puedeBuscar } from "@/lib/busqueda"
import { traerTodo } from "@/lib/supabase/traer-todo"
import {
  cargarLineas,
  mapResumen,
  SELECT_REQUISICIONES,
  SELECT_REQUISICIONES_CON_INSUMO,
  type EstadoRequisicion,
  type LineaRequisicion,
  type RequisicionResumen,
} from "@/lib/requisiciones-lineas"
import { MAX_INSUMOS_POR_PEDIDO, type InsumoAgrupado, type PresupuestoActivo } from "./types"
import type { FilaExcelRequisicion } from "@/lib/exportar-requisiciones"

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

export async function verProyectos() {
  const supabase = await createClient()

  const userId = await obtenerUsuarioId()

  if (!userId) {
    throw new Error("No autenticado.")
  }

  const permisos = await obtenerPermisosUsuario(userId)

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
  direccionEntrega: string // obligatoria (Paquete A)
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

  const userId = await obtenerUsuarioId()

  if (!userId) {
    throw new Error("No autenticado.")
  }

  // -- 0. Forma del pedido --
  // La pantalla ya pone min=hoy, pero se valida acá también (y en hora de
  // Colombia, no UTC).
  if (!input.fechaRequerida || input.fechaRequerida < hoyColombia()) {
    throw new Error("La fecha requerida no puede ser anterior a hoy.")
  }
  const errorDireccion = validarDireccion(input.direccionEntrega)
  if (errorDireccion) throw new Error(errorDireccion)
  if (input.insumos.length === 0) {
    throw new Error("Agrega al menos un insumo a la requisición.")
  }
  if (input.insumos.length > MAX_INSUMOS_POR_PEDIDO) {
    throw new Error(`Una requisición puede tener máximo ${MAX_INSUMOS_POR_PEDIDO} insumos.`)
  }
  if (new Set(input.insumos.map((i) => i.insumoId)).size !== input.insumos.length) {
    throw new Error("Hay un insumo repetido en la requisición.")
  }
  for (const ins of input.insumos) {
    if (ins.items.length === 0) {
      throw new Error("Cada insumo de la requisición necesita al menos un ítem del presupuesto.")
    }
    if (new Set(ins.items.map((it) => it.presupuestoItemId)).size !== ins.items.length) {
      throw new Error("Un insumo tiene el mismo ítem del presupuesto repetido.")
    }
    for (const it of ins.items) {
      if (!esCantidadEnteraPositiva(it.cantidad)) {
        throw new Error("Todas las cantidades de la requisición deben ser números enteros mayores que cero.")
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

  // -- 1. Tope de cantidad: TODOS los pares (ítem, insumo) en un viaje --
  // (disponible_insumos_items reusa disponible_insumo_item por dentro;
  // antes era una llamada por par, hasta cientos por pedido).
  const pares = input.insumos.flatMap((ins) =>
    ins.items.map((it) => ({ insumoId: ins.insumoId, item: it }))
  )
  const { data: disponibles, error: errorTopes } = await supabase.rpc("disponible_insumos_items", {
    p_items: pares.map((p) => p.item.presupuestoItemId),
    p_insumos: pares.map((p) => p.insumoId),
  })
  if (errorTopes) throw new Error(errorTopes.message)
  const disponiblePorIdx = new Map(
    ((disponibles ?? []) as { idx: number; disponible: number | null }[]).map((d) => [d.idx, Number(d.disponible ?? 0)])
  )
  const topes = pares.map((p, i) => ({
    insumoId: p.insumoId,
    cantidad: p.item.cantidad,
    disponible: disponiblePorIdx.get(i + 1) ?? 0,
  }))
  const excedido = topes.find((t) => t.cantidad > t.disponible)
  if (excedido) {
    throw new Error(
      `La cantidad pedida de "${await nombreInsumo(excedido.insumoId)}" supera lo disponible del presupuesto (máximo ${excedido.disponible}).`
    )
  }

  // -- 2. Duplicado exacto contra pendientes: UNA consulta para todo el
  // pedido + un Set de claves insumo|ítem|cantidad -> O(n). Antes: una
  // consulta por insumo y una comparación anidada por cada fila.
  const clavePedido = (insumoId: string, itemId: string, cantidad: number) => `${insumoId}|${itemId}|${cantidad}`
  const clavesNuevas = new Set(pares.map((p) => clavePedido(p.insumoId, p.item.presupuestoItemId, p.item.cantidad)))
  const { data: pendientesMismaFecha, error: errorDuplicados } = await supabase
    .from("pedidos_insumos")
    .select("insumo_id, presupuesto_item_id, cantidad")
    .in("insumo_id", input.insumos.map((ins) => ins.insumoId))
    .in("presupuesto_item_id", Array.from(new Set(pares.map((p) => p.item.presupuestoItemId))))
    .eq("fecha_requerida", input.fechaRequerida)
    .eq("estado", "pendiente")
  if (errorDuplicados) throw new Error(errorDuplicados.message)
  const insumoDuplicado =
    (pendientesMismaFecha ?? []).find((f) =>
      clavesNuevas.has(clavePedido(f.insumo_id, f.presupuesto_item_id, Number(f.cantidad)))
    )?.insumo_id ?? null
  if (insumoDuplicado) {
    throw new Error(
      `Ya existe un pedido pendiente idéntico de "${await nombreInsumo(insumoDuplicado)}" ` +
        "(mismo ítem, cantidad y fecha requerida). Revisa el registro de pedidos antes de crear uno nuevo."
    )
  }

  const { data: creada, error } = await supabase.rpc("crear_requisicion_con_direccion", {
    p_lineas: input.insumos.flatMap((ins) =>
      ins.items.map((it) => ({
        presupuesto_item_id: it.presupuestoItemId,
        item_apu_id: it.itemApuId,
        insumo_id: ins.insumoId,
        cantidad: it.cantidad,
      }))
    ),
    p_fecha_requerida: input.fechaRequerida,
    p_urgente: input.urgente,
    p_observaciones: input.observaciones,
    p_soporte_url: input.soporteUrl,
    p_direccion_entrega: normalizarDireccion(input.direccionEntrega),
  })
  if (error) throw new Error(error.message)

  const r = creada as { id: string; numero: number; codigo?: string }
  return { requisicionId: r.id, numero: r.numero, codigo: r.codigo ?? `N° ${r.numero}`, insumosCreados: input.insumos.length }
}

// ---------------------------------------------------------------------------
// Requisiciones extraordinarias ("Solicitar requisición extraordinaria a
// Gerencia"): uno o varios insumos por encima de lo que contempla el
// presupuesto. Cada línea es un insumo en un ítem; el insumo puede no estar en
// el APU del ítem (se rompió algo y hay que comprar un material que el ítem no
// tenía). No revisan el cupo (se puede pedir por encima) pero sí lo descuentan
// como cualquier requisición, y las aprueba Gerencia
// (20261226000000_requisiciones_extraordinarias.sql).
// ---------------------------------------------------------------------------

// ¿Puede abrir Elaboración de presupuestos? (para ofrecer el enlace al ítem
// desde el detalle de una requisición).
export async function puedeVerPresupuestos(): Promise<boolean> {
  const p = await obtenerPermisosRol()
  return !!p && (p.esAdministrador || p.pestanas.includes("presupuestos.elaboracion"))
}

export type ItemParaExtraordinaria = { id: string; codigo: string; descripcion: string; unidad: string | null }
export type InsumoMaestro = { id: string; codigo: number; descripcion: string; um: string | null }
// Si el insumo está en el APU del ítem: lo presupuestado y lo que queda del cupo.
export type InsumoEnItem = { enApu: boolean; presupuestado: number; disponible: number }

// Quita lo que rompe el filtro .or() de PostgREST (comas y paréntesis) y los
// comodines de ilike que el usuario no quiso escribir.
const textoFiltro = (t: string) => t.trim().replace(/[,()%]/g, " ")

// Ítems de la versión vigente (no los capítulos) por código o descripción.
export async function buscarItemsPresupuesto(versionId: string, termino: string): Promise<ItemParaExtraordinaria[]> {
  if (!puedeBuscar(termino)) return []
  const supabase = await createClient()
  const t = textoFiltro(termino)
  const { data, error } = await supabase
    .from("presupuesto_items")
    .select("id, codigo, descripcion, unidad")
    .eq("version_id", versionId)
    .not("padre_id", "is", null)
    .or(`codigo.ilike.%${t}%,descripcion.ilike.%${t}%`)
    .order("codigo")
    .limit(limiteBusqueda(termino))
  if (error) throw new Error(error.message)
  return (data ?? []).map((f) => ({ id: f.id, codigo: f.codigo ?? "", descripcion: f.descripcion ?? "", unidad: f.unidad ?? null }))
}

// Cualquier insumo del maestro, por código o descripción.
export async function buscarInsumosMaestro(termino: string): Promise<InsumoMaestro[]> {
  if (!puedeBuscar(termino)) return []
  const supabase = await createClient()
  const t = textoFiltro(termino)
  let query = supabase.from("maestro_insumos").select("id, codigo, descripcion, u_m")
  query = /^\d+$/.test(t) ? query.or(`codigo.eq.${t},descripcion.ilike.%${t}%`) : query.ilike("descripcion", `%${t}%`)
  const { data, error } = await query.order("descripcion").limit(limiteBusqueda(termino))
  if (error) throw new Error(error.message)
  return (data ?? []).map((f) => ({ id: f.id, codigo: Number(f.codigo), descripcion: f.descripcion ?? "", um: f.u_m ?? null }))
}

// ¿Está el insumo en el APU del ítem? Con cuánto presupuestado y disponible.
export async function insumoEnItem(presupuestoItemId: string, insumoId: string): Promise<InsumoEnItem> {
  const supabase = await createClient()
  const { data: item, error } = await supabase
    .from("presupuesto_items")
    .select("apu_id, cantidad")
    .eq("id", presupuestoItemId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!item?.apu_id) return { enApu: false, presupuestado: 0, disponible: 0 }

  const [lineas, disponible] = await Promise.all([
    supabase.from("item_apu").select("cantidad").eq("apu_id", item.apu_id).eq("insumo_id", insumoId),
    supabase.rpc("disponible_insumo_item", { p_presupuesto_item_id: presupuestoItemId, p_insumo_id: insumoId }),
  ])
  if (lineas.error) throw new Error(lineas.error.message)
  if (disponible.error) throw new Error(disponible.error.message)
  const filas = lineas.data ?? []
  if (filas.length === 0) return { enApu: false, presupuestado: 0, disponible: 0 }
  const porUnidad = filas.reduce((s, f) => s + Number(f.cantidad ?? 0), 0)
  return { enApu: true, presupuestado: porUnidad * Number(item.cantidad ?? 0), disponible: Number(disponible.data ?? 0) }
}

export type NuevaRequisicionExtraordinaria = {
  lineas: { presupuestoItemId: string; insumoId: string; cantidad: number }[]
  fechaRequerida: string
  urgente: boolean
  justificacion: string
  direccionEntrega: string
}

export async function crearRequisicionExtraordinaria(input: NuevaRequisicionExtraordinaria) {
  if (!input.justificacion.trim()) throw new Error("Escribe por qué se necesita más de lo presupuestado.")
  const errorDireccion = validarDireccion(input.direccionEntrega)
  if (errorDireccion) throw new Error(errorDireccion)
  if (input.lineas.length === 0) throw new Error("Agrega al menos un insumo a la requisición.")
  if (input.lineas.length > MAX_INSUMOS_POR_PEDIDO) {
    throw new Error(`Una requisición puede tener máximo ${MAX_INSUMOS_POR_PEDIDO} insumos.`)
  }
  if (new Set(input.lineas.map((l) => `${l.insumoId}|${l.presupuestoItemId}`)).size !== input.lineas.length) {
    throw new Error("Hay un insumo repetido para el mismo ítem del presupuesto.")
  }
  if (!input.lineas.every((l) => esCantidadEnteraPositiva(l.cantidad))) {
    throw new Error("Todas las cantidades deben ser números enteros mayores que cero.")
  }
  if (!input.fechaRequerida || input.fechaRequerida < hoyColombia()) {
    throw new Error("La fecha requerida no puede ser anterior a hoy.")
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("crear_requisicion_extraordinaria_con_direccion", {
    p_lineas: input.lineas.map((l) => ({
      presupuesto_item_id: l.presupuestoItemId,
      insumo_id: l.insumoId,
      cantidad: l.cantidad,
    })),
    p_fecha_requerida: input.fechaRequerida,
    p_urgente: input.urgente,
    p_justificacion: input.justificacion.trim(),
    p_direccion_entrega: normalizarDireccion(input.direccionEntrega),
  })
  if (error) throw new Error(error.message)
  const r = data as { id: string; numero: number; codigo?: string }
  return { requisicionId: r.id, numero: Number(r.numero), codigo: r.codigo ?? `N° ${r.numero}` }
}

// ---------------------------------------------------------------------------
// Requisiciones agrupadas (cabecera con número + insumos). Ver
// supabase/migrations/20261008000000_requisiciones.sql: el estado de la
// requisición se deriva de sus líneas (vista requisiciones_vista) y cancelar,
// modificar, aprobar... actúan sobre la requisición entera. El cupo del
// presupuesto sigue saliendo de las líneas (pendiente o aprobada = comprometida).
// ---------------------------------------------------------------------------

export type RequisicionDetalle = RequisicionResumen & {
  lineas: LineaRequisicion[]
  motivoRechazo: string | null
  motivoCancelacion: string | null
  resueltoPorNombre: string | null
  resueltoAt: string | null
  // Última vez que quien la hizo la modificó (evento "modificada" del
  // historial); null si nunca se modificó. La fecha de la requisición
  // (createdAt) no cambia al modificarla.
  modificadaAt: string | null
}

export type FiltrosRequisiciones = {
  numero?: number
  proyectoId?: string
  insumoId?: string
  estado?: EstadoRequisicion
  solicitadoPorId?: string
  // Normales o extraordinarias (por encima del presupuesto); sin esto, todas.
  tipo?: "normal" | "extraordinaria"
  desde?: string // YYYY-MM-DD, por fecha de la requisición
  hasta?: string // YYYY-MM-DD, inclusive
}

// Requisiciones de los proyectos a los que el usuario tiene acceso (no solo el
// proyecto actual), con filtros. El filtro de acceso se aplica acá en el
// servidor, nunca depende de lo que mande el cliente.
// Consulta de requisiciones_vista con los filtros y el acceso del usuario
// (compartida por la lista paginada y la descarga a Excel). null = el usuario
// no puede ver nada con esos filtros.
async function consultaRequisiciones(filtros: FiltrosRequisiciones) {
  const supabase = await createClient()
  const userId = await obtenerUsuarioId()
  if (!userId) throw new Error("No autenticado.")

  const permisos = await obtenerPermisosUsuario(userId)
  const idsPermitidos = Array.from(permisos.proyectos.keys())
  if (!permisos.veTodosProyectos && idsPermitidos.length === 0) return null
  // Un proyecto pedido a mano solo vale si el usuario tiene acceso a él.
  if (filtros.proyectoId && !permisos.veTodosProyectos && !idsPermitidos.includes(filtros.proyectoId)) return null

  // Se arma de nuevo en cada llamada: el resultado de supabase-js es una
  // promesa que solo se puede consumir una vez (traerTodo pide varias páginas).
  return () => {
    let query = supabase
      .from("requisiciones_vista")
      .select(filtros.insumoId ? SELECT_REQUISICIONES_CON_INSUMO : SELECT_REQUISICIONES)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })

    if (filtros.proyectoId) query = query.eq("proyecto_id", filtros.proyectoId)
    else if (!permisos.veTodosProyectos) query = query.in("proyecto_id", idsPermitidos)

    if (filtros.numero !== undefined) query = query.eq("numero", filtros.numero)
    if (filtros.estado) query = query.eq("estado", filtros.estado)
    if (filtros.solicitadoPorId) query = query.eq("solicitado_por", filtros.solicitadoPorId)
    if (filtros.tipo) query = query.eq("extraordinaria", filtros.tipo === "extraordinaria")
    // Colombia es UTC-5 todo el año: así "hasta" incluye el día completo.
    if (filtros.desde) query = query.gte("created_at", `${filtros.desde}T00:00:00-05:00`)
    if (filtros.hasta) query = query.lte("created_at", `${filtros.hasta}T23:59:59.999-05:00`)

    // Por insumo: las requisiciones que tienen ese insumo en alguna línea.
    if (filtros.insumoId) query = query.eq("filtro_insumo.insumo_id", filtros.insumoId)
    return query
  }
}

export async function listarRequisiciones(
  filtros: FiltrosRequisiciones,
  pagina = 0
): Promise<{ filas: RequisicionResumen[]; hayMas: boolean }> {
  const consulta = await consultaRequisiciones(filtros)
  if (!consulta) return { filas: [], hayMas: false }

  const { data, error } = await consulta().range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)

  const { filas, hayMas } = cortarPagina(data ?? [])
  return { filas: filas.map(mapResumen), hayMas }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- filas crudas de Supabase */
// Descarga a Excel del registro: TODAS las requisiciones que cumplen los
// filtros (no solo la página en pantalla), una fila por insumo. Con filtro de
// insumo, solo las líneas de ese insumo.
export async function exportarRequisiciones(filtros: FiltrosRequisiciones): Promise<FilaExcelRequisicion[]> {
  const consulta = await consultaRequisiciones(filtros)
  if (!consulta) return []

  const requisiciones = (
    await traerTodo<any>((desde, hasta) => consulta().order("id", { ascending: true }).range(desde, hasta))
  ).map(mapResumen)
  if (requisiciones.length === 0) return []

  // Líneas por tandas de ids (van en la URL) y paginadas dentro de cada tanda.
  const supabase = await createClient()
  const ids = requisiciones.map((r) => r.id)
  const tandas: string[][] = []
  for (let i = 0; i < ids.length; i += 100) tandas.push(ids.slice(i, i + 100))
  const lineas = (
    await Promise.all(
      tandas.map((tanda) =>
        traerTodo<any>((desde, hasta) => {
          let q = supabase
            .from("pedidos_insumos")
            .select("id, grupo_pedido_id, cantidad, unidad, insumo:maestro_insumos(codigo, descripcion, u_m)")
            .in("grupo_pedido_id", tanda)
          if (filtros.insumoId) q = q.eq("insumo_id", filtros.insumoId)
          return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(desde, hasta)
        })
      )
    )
  ).flat()

  const lineasPorRequisicion = new Map<string, any[]>()
  for (const l of lineas) {
    const arr = lineasPorRequisicion.get(l.grupo_pedido_id) ?? []
    arr.push(l)
    lineasPorRequisicion.set(l.grupo_pedido_id, arr)
  }

  const filas: FilaExcelRequisicion[] = []
  for (const r of requisiciones) {
    for (const l of lineasPorRequisicion.get(r.id) ?? []) {
      filas.push({
        codigo: r.codigo,
        proyecto: [r.proyectoCodigo, r.proyectoNombre].filter(Boolean).join(" — "),
        solicitadoPor: r.solicitanteNombre ?? "",
        insumoCodigo: l.insumo?.codigo ?? null,
        insumo: l.insumo?.descripcion ?? "(insumo eliminado)",
        unidad: l.unidad ?? l.insumo?.u_m ?? "",
        cantidad: Number(l.cantidad),
        fechaRequisicion: r.createdAt,
        fechaRequerida: r.fechaRequerida,
        fechaEstimada: r.fechaEstimada,
        estado: r.estado,
        estadoCompra: r.estadoCompra,
        extraordinaria: r.extraordinaria,
      })
    }
  }
  return filas
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function obtenerRequisicion(id: string): Promise<RequisicionDetalle> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("requisiciones_vista")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("La requisición no existe o no tienes acceso a ella.")

  const [lineasPorReq, historial] = await Promise.all([
    cargarLineas(supabase, [id]),
    supabase.rpc("historial_entidad", { p_tipo: "requisicion", p_id: id }),
  ])
  const lineas = lineasPorReq.get(id) ?? []
  const resumen = mapResumen(data)
  // El historial ya viene validado por la base (solo quien ve la requisición).
  let modificadaAt: string | null = null
  for (const e of ((historial.data ?? []) as { evento: string; created_at: string }[])) {
    if (e.evento === "modificada" && (!modificadaAt || e.created_at > modificadaAt)) modificadaAt = e.created_at
  }
  const resuelta = lineas.find((l) => l._resueltoAt)
  return {
    ...resumen,
    lineas: lineas.map(({ _resolutor, _resueltoAt, _comentario, _motivoCancelacion, ...l }) => l),
    motivoRechazo:
      resumen.estado === "rechazada" ? lineas.find((l) => l._comentario)?._comentario ?? null : null,
    motivoCancelacion:
      resumen.estado === "cancelada" ? lineas.find((l) => l._motivoCancelacion)?._motivoCancelacion ?? null : null,
    resueltoPorNombre: resuelta?._resolutor ?? null,
    resueltoAt: resuelta?._resueltoAt ?? null,
    modificadaAt,
  }
}

// Solo quien la hizo, y solo mientras no esté en una orden de compra vigente
// (lo valida la base). El cupo de todas sus líneas vuelve al presupuesto.
export async function cancelarRequisicion(id: string, motivo: string) {
  if (!motivo.trim()) throw new Error("El motivo de cancelación es obligatorio.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancelar_requisicion", { p_id: id, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

// Datos para editar una requisición pendiente: sus líneas actuales marcadas, y
// por cada insumo TODOS los ítems del presupuesto donde aparece. El cupo de
// cada ítem incluye lo que esta misma requisición ya tiene reservado (si no,
// no podría ni conservar su propia cantidad).
export type EdicionRequisicion = {
  requisicionId: string
  numero: number
  codigo: string
  creadaAt: string // fecha de la requisición: no se modifica
  modificadaAt: string | null
  versionId: string
  fechaRequerida: string
  urgente: boolean
  observaciones: string | null
  direccionEntrega: string | null
  insumos: {
    insumo: InsumoAgrupado
    marcados: Record<string, number> // presupuestoItemId -> cantidad actual
  }[]
}

export async function cargarRequisicionParaEditar(id: string): Promise<EdicionRequisicion> {
  const supabase = await createClient()
  const userId = await obtenerUsuarioId()
  if (!userId) throw new Error("No autenticado.")

  const detalle = await obtenerRequisicion(id)
  if (detalle.solicitanteId !== userId) throw new Error("Solo quien hizo la requisición puede modificarla.")
  if (detalle.estado !== "pendiente") throw new Error("Solo se puede modificar una requisición pendiente de aprobación.")

  const lineas = detalle.lineas.filter((l) => l.estado === "pendiente")
  if (lineas.length === 0) throw new Error("La requisición no tiene insumos pendientes.")

  // Versión del presupuesto a la que pertenecen los ítems de la requisición.
  const { data: item, error: errorItem } = await supabase
    .from("presupuesto_items")
    .select("version_id")
    .eq("id", lineas[0].presupuestoItemId)
    .maybeSingle()
  if (errorItem) throw new Error(errorItem.message)
  if (!item?.version_id) throw new Error("No se encontró la versión del presupuesto de esta requisición.")
  const versionId = item.version_id as string

  const propias = new Map(lineas.map((l) => [`${l.insumoId}|${l.presupuestoItemId}`, l.cantidad]))
  // Líneas agrupadas por insumo en una sola pasada (marcados = ítem -> cantidad).
  const marcadosPorInsumo = new Map<string, { linea: (typeof lineas)[number]; marcados: Record<string, number> }>()
  for (const l of lineas) {
    const g = marcadosPorInsumo.get(l.insumoId) ?? { linea: l, marcados: {} }
    g.marcados[l.presupuestoItemId] = l.cantidad
    marcadosPorInsumo.set(l.insumoId, g)
  }
  const insumosUnicos = Array.from(marcadosPorInsumo.values()).map((g) => g.linea)

  // UNA llamada para todos los insumos, por id exacto (ver
  // 20261010100000_rendimiento_requisiciones.sql). Antes era una llamada por
  // insumo buscando su código como texto con límite de 200 filas, que podía
  // dejar por fuera los ítems del insumo en un presupuesto grande.
  const { data, error } = await supabase.rpc("insumos_presupuesto_por_ids", {
    p_version_id: versionId,
    p_insumo_ids: insumosUnicos.map((l) => l.insumoId),
  })
  if (error) throw new Error(error.message)
  const filasPorInsumo = new Map<string, any[]>()
  for (const f of (data ?? []) as any[]) {
    const arr = filasPorInsumo.get(f.insumo_id) ?? []
    arr.push(f)
    filasPorInsumo.set(f.insumo_id, arr)
  }
  const grupos = insumosUnicos.map((l) => {
    const agrupado: InsumoAgrupado = {
      insumoId: l.insumoId,
      insumoCodigo: l.insumoCodigo,
      insumoDescripcion: l.insumoDescripcion,
      insumoUm: l.insumoUm,
      items: (filasPorInsumo.get(l.insumoId) ?? []).map((f) => ({
        presupuestoItemId: f.presupuesto_item_id,
        itemCodigo: f.item_codigo,
        itemDescripcion: f.item_descripcion,
        itemApuId: f.item_apu_id,
        cantidadDisponible:
          Number(f.cantidad_disponible) + (propias.get(`${l.insumoId}|${f.presupuesto_item_id}`) ?? 0),
      })),
    }
    return { insumo: agrupado, marcados: marcadosPorInsumo.get(l.insumoId)?.marcados ?? {} }
  })

  return {
    requisicionId: id,
    numero: detalle.numero,
    codigo: detalle.codigo,
    creadaAt: detalle.createdAt,
    modificadaAt: detalle.modificadaAt,
    versionId,
    fechaRequerida: detalle.fechaRequerida ?? "",
    urgente: detalle.urgente,
    observaciones: detalle.observaciones,
    direccionEntrega: detalle.direccionEntrega,
    insumos: grupos,
  }
}

export async function modificarRequisicion(
  id: string,
  input: Omit<NuevoPedidoInput, "soporteUrl">
) {
  if (!input.fechaRequerida) throw new Error("La fecha requerida es obligatoria.")
  const errorDireccion = validarDireccion(input.direccionEntrega)
  if (errorDireccion) throw new Error(errorDireccion)
  if (input.insumos.length === 0) throw new Error("La requisición debe tener al menos un insumo.")
  if (input.insumos.length > MAX_INSUMOS_POR_PEDIDO) {
    throw new Error(`Una requisición puede tener máximo ${MAX_INSUMOS_POR_PEDIDO} insumos.`)
  }
  for (const ins of input.insumos) {
    if (ins.items.length === 0) throw new Error("Cada insumo necesita al menos un ítem del presupuesto.")
    for (const it of ins.items) {
      if (!esCantidadEnteraPositiva(it.cantidad)) {
        throw new Error("Todas las cantidades deben ser números enteros mayores que cero.")
      }
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("modificar_requisicion_con_direccion", {
    p_id: id,
    p_lineas: input.insumos.flatMap((ins) =>
      ins.items.map((it) => ({
        presupuesto_item_id: it.presupuestoItemId,
        item_apu_id: it.itemApuId,
        insumo_id: ins.insumoId,
        cantidad: it.cantidad,
      }))
    ),
    p_fecha_requerida: input.fechaRequerida,
    p_urgente: input.urgente,
    p_observaciones: input.observaciones,
    p_direccion_entrega: normalizarDireccion(input.direccionEntrega),
  })
  if (error) throw new Error(error.message)
}

// La última dirección de entrega que se usó en el proyecto (para no escribirla
// cada vez). Sin proyecto, el proyecto actual. null si no hay o no se ve.
export async function ultimaDireccionEntrega(proyectoId?: string | null): Promise<string | null> {
  const id = proyectoId ?? (await cookies()).get(COOKIE_PROYECTO)?.value ?? null
  if (!id) return null
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("requisiciones_vista")
    .select("direccion_entrega")
    .eq("proyecto_id", id)
    .not("direccion_entrega", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return (data as { direccion_entrega: string | null } | null)?.direccion_entrega ?? null
}
