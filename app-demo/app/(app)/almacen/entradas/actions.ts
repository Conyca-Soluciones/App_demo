"use server"

import { esCantidadEnteraPositiva } from "@/lib/numeros"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion } from "@/lib/permisos"

// ---------------------------------------------------------------------------
// ENTRADAS de almacén -- recepción de material contra órdenes de compra.
// Las OC aprobadas aparecen mientras su estado_entrega sea sin_entregar o
// entrega_parcial; al completarse todas las líneas pasan a 'entregada' y
// dejan de listarse. Toda la lógica (tope por línea, cambio de estado) vive
// en las funciones SQL de 20260930000000_entradas_almacen.sql, que además
// validan el permiso (es_admin / admin_insumos).
// ---------------------------------------------------------------------------

export type EstadoEntrega = "sin_entregar" | "entrega_parcial" | "entregada"

export type OrdenParaEntrada = {
  id: string
  numero: number
  estadoEntrega: EstadoEntrega
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  fechaEntrega: string | null
  totalLineas: number
  cantidadOrdenada: number
  cantidadRecibida: number
}

// incluirEntregadas = true también trae las OC ya entregadas, para poder
// abrirlas y corregir una entrada.
// proyectoId = solo las órdenes de ese proyecto (la base valida el acceso).
export async function listarOrdenesParaEntrada(
  incluirEntregadas = false,
  proyectoId: string | null = null
): Promise<OrdenParaEntrada[]> {
  await requerirAccion("gestionar_almacen")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_ordenes_para_entrada", {
    p_incluir_entregadas: incluirEntregadas,
    p_proyecto_id: proyectoId,
  })
  if (error) throw new Error(error.message)

  return (data ?? []).map((o: any) => ({
    id: o.id,
    numero: o.numero,
    estadoEntrega: o.estado_entrega,
    proyectoCodigo: o.proyecto_codigo,
    proyectoNombre: o.proyecto_nombre,
    proveedorNombre: o.proveedor_nombre ?? "(proveedor eliminado)",
    fechaEntrega: o.fecha_entrega,
    totalLineas: Number(o.total_lineas),
    cantidadOrdenada: Number(o.cantidad_ordenada),
    cantidadRecibida: Number(o.cantidad_recibida),
  }))
}

// ---------------------------------------------------------------------------
// Lista de Entradas con filtros (panel de la izquierda). Una fila por orden de
// compra, con la ÚLTIMA entrada vigente (quién la hizo y cuándo). Si hay
// filtro por usuario o por fecha, esa "última entrada" es la última que
// cumple el filtro, y solo salen las órdenes que tienen alguna.
// ---------------------------------------------------------------------------

export type FiltrosEntradas = {
  proyectoId: string // proyecto actual (selector del encabezado)
  numero?: number // N° de la orden de compra
  proveedor?: string // parte del nombre
  usuarioId?: string // quien hizo la entrada
  // undefined = todos los estados; "por_recibir" = pendiente o parcial.
  estado?: EstadoEntrega | "por_recibir"
  desde?: string // YYYY-MM-DD, fecha de la entrada
  hasta?: string // YYYY-MM-DD, inclusive
}

export type OrdenEntradaFila = OrdenParaEntrada & {
  entradaFecha: string | null
  entradaPersona: string | null
}

export async function listarOrdenesEntradas(filtros: FiltrosEntradas): Promise<OrdenEntradaFila[]> {
  await requerirAccion("gestionar_almacen")

  // Las órdenes ya entregadas solo se piden si el filtro las puede incluir.
  const incluirEntregadas = filtros.estado === undefined || filtros.estado === "entregada"
  let ordenes = await listarOrdenesParaEntrada(incluirEntregadas, filtros.proyectoId)

  if (filtros.numero !== undefined) ordenes = ordenes.filter((o) => o.numero === filtros.numero)
  const proveedor = filtros.proveedor?.trim().toLowerCase()
  if (proveedor) ordenes = ordenes.filter((o) => o.proveedorNombre.toLowerCase().includes(proveedor))
  if (filtros.estado === "por_recibir") {
    ordenes = ordenes.filter((o) => o.estadoEntrega !== "entregada")
  } else if (filtros.estado) {
    ordenes = ordenes.filter((o) => o.estadoEntrega === filtros.estado)
  }
  if (ordenes.length === 0) return []

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("entradas_por_orden", {
    p_orden_ids: ordenes.map((o) => o.id),
  })
  if (error) throw new Error(error.message)

  // Colombia es UTC-5 todo el año: así "hasta" incluye el día completo.
  const desde = filtros.desde ? new Date(`${filtros.desde}T00:00:00-05:00`).getTime() : null
  const hasta = filtros.hasta ? new Date(`${filtros.hasta}T23:59:59.999-05:00`).getTime() : null

  const ultimaPorOrden = new Map<string, { fecha: string; persona: string | null }>()
  for (const e of (data ?? []) as any[]) {
    const t = new Date(e.created_at).getTime()
    if (filtros.usuarioId && e.recibido_por !== filtros.usuarioId) continue
    if (desde !== null && t < desde) continue
    if (hasta !== null && t > hasta) continue
    // Vienen ordenadas de la más antigua a la más reciente: la última pisa.
    ultimaPorOrden.set(e.orden_id, { fecha: e.created_at, persona: e.recibido_por_nombre ?? null })
  }

  const filtraPorEntrada = Boolean(filtros.usuarioId || filtros.desde || filtros.hasta)
  return ordenes
    .filter((o) => !filtraPorEntrada || ultimaPorOrden.has(o.id))
    .map((o) => ({
      ...o,
      entradaFecha: ultimaPorOrden.get(o.id)?.fecha ?? null,
      entradaPersona: ultimaPorOrden.get(o.id)?.persona ?? null,
    }))
}

export type LineaEntrada = {
  id: string // ordenes_compra_items.id
  insumoCodigo: number
  insumoDescripcion: string
  um: string | null
  cantidadOrdenada: number
  cantidadRecibida: number
  cantidadPendiente: number
}

export type LineaEntradaRegistrada = {
  id: string // entradas_almacen_items.id
  ordenCompraItemId: string
  insumoDescripcion: string
  um: string | null
  cantidad: number
  cantidadOriginal: number | null // solo si la cantidad fue editada
}

export type EntradaRegistrada = {
  id: string
  numero: number
  remision: string | null
  observaciones: string | null
  recibidoPor: string | null
  createdAt: string
  anuladaAt: string | null
  motivoAnulacion: string | null
  editadaAt: string | null
  lineas: LineaEntradaRegistrada[]
}

export type DetalleOrdenEntrada = {
  id: string
  numero: number
  estadoEntrega: EstadoEntrega
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  lineas: LineaEntrada[]
  entradas: EntradaRegistrada[]
}

export async function obtenerDetalleOrdenParaEntrada(
  ordenId: string
): Promise<DetalleOrdenEntrada> {
  await requerirAccion("gestionar_almacen")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("detalle_orden_para_entrada", {
    p_orden_id: ordenId,
  })
  if (error) throw new Error(error.message)

  const d = data as any
  return {
    id: d.id,
    numero: d.numero,
    estadoEntrega: d.estado_entrega,
    proyectoCodigo: d.proyecto_codigo,
    proyectoNombre: d.proyecto_nombre,
    proveedorNombre: d.proveedor_nombre ?? "(proveedor eliminado)",
    lineas: (d.lineas ?? []).map((l: any) => ({
      id: l.id,
      insumoCodigo: l.insumo_codigo,
      insumoDescripcion: l.insumo_descripcion,
      um: l.um,
      cantidadOrdenada: Number(l.cantidad_ordenada),
      cantidadRecibida: Number(l.cantidad_recibida),
      cantidadPendiente: Number(l.cantidad_pendiente),
    })),
    entradas: (d.entradas ?? []).map((e: any) => ({
      id: e.id,
      numero: e.numero,
      remision: e.remision,
      observaciones: e.observaciones,
      recibidoPor: e.recibido_por,
      createdAt: e.created_at,
      anuladaAt: e.anulada_at,
      motivoAnulacion: e.motivo_anulacion,
      editadaAt: e.editada_at,
      lineas: (e.lineas ?? []).map((l: any) => ({
        id: l.id,
        ordenCompraItemId: l.orden_compra_item_id,
        insumoDescripcion: l.insumo_descripcion,
        um: l.um,
        cantidad: Number(l.cantidad),
        cantidadOriginal: l.cantidad_original === null ? null : Number(l.cantidad_original),
      })),
    })),
  }
}

export type DatosEntrada = {
  ordenId: string
  remision?: string | null
  observaciones?: string | null
  lineas: { ordenCompraItemId: string; cantidad: number }[]
}

// Devuelve el estado_entrega en el que quedó la OC tras registrar la entrada.
export async function registrarEntrada(datos: DatosEntrada): Promise<EstadoEntrega> {
  await requerirAccion("gestionar_almacen")

  const lineas = datos.lineas.filter((l) => l.cantidad > 0)
  if (lineas.length === 0) {
    throw new Error("Ingresa la cantidad recibida de al menos un insumo.")
  }
  // Solo enteros (decisión del usuario; la pantalla ya lo valida).
  if (!lineas.every((l) => esCantidadEnteraPositiva(l.cantidad))) throw new Error("Las cantidades deben ser números enteros mayores que cero.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("registrar_entrada_almacen", {
    p_orden_id: datos.ordenId,
    p_remision: datos.remision ?? null,
    p_observaciones: datos.observaciones ?? null,
    p_lineas: lineas.map((l) => ({
      orden_compra_item_id: l.ordenCompraItemId,
      cantidad: l.cantidad,
    })),
  })
  if (error) throw new Error(error.message)

  const detalle = await obtenerDetalleOrdenParaEntrada(datos.ordenId)
  return detalle.estadoEntrega
}

export type DatosEdicionEntrada = {
  entradaId: string
  remision?: string | null
  observaciones?: string | null
  lineas: { id: string; cantidad: number }[] // id = LineaEntradaRegistrada.id
}

// Corrige cantidades / remisión / observaciones de una entrada. Devuelve el
// estado_entrega en que queda la OC (puede volver de entregada a parcial).
export async function editarEntrada(datos: DatosEdicionEntrada): Promise<EstadoEntrega> {
  await requerirAccion("gestionar_almacen")
  if (!datos.lineas.every((l) => esCantidadEnteraPositiva(l.cantidad))) throw new Error("Las cantidades deben ser números enteros mayores que cero.")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("editar_entrada_almacen", {
    p_entrada_id: datos.entradaId,
    p_remision: datos.remision ?? null,
    p_observaciones: datos.observaciones ?? null,
    p_lineas: datos.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad })),
  })
  if (error) throw new Error(error.message)
  return data as EstadoEntrega
}

// Anula la entrada completa (queda registrada). No se puede si el material
// ya salió de bodega y el inventario quedaría negativo.
export async function anularEntrada(entradaId: string, motivo: string): Promise<EstadoEntrega> {
  await requerirAccion("gestionar_almacen")
  if (!motivo.trim()) throw new Error("El motivo de anulación es obligatorio.")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("anular_entrada_almacen", {
    p_entrada_id: entradaId,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
  return data as EstadoEntrega
}
