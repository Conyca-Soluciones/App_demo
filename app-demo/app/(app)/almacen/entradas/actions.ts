"use server"

import { esCantidadEnteraPositiva } from "@/lib/numeros"
import { redondear } from "@/lib/presentacion-compra"

import { createClient } from "@/lib/supabase/server"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
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

export type OrdenEntradaFila = {
  id: string
  numero: number
  estadoEntrega: EstadoEntrega
  proyectoCodigo: string | null
  proyectoNombre: string | null
  proveedorNombre: string
  entradaFecha: string | null
  entradaPersona: string | null
}

// Una página de la lista de Entradas. El filtro, el orden y el corte de página
// los hace la función SQL listar_ordenes_entradas (20261012050000, con el proyecto en 20261014200000): no se trae todo
// el historial a la aplicación para filtrarlo acá.
export async function listarOrdenesEntradas(
  filtros: FiltrosEntradas,
  pagina = 0
): Promise<{ filas: OrdenEntradaFila[]; hayMas: boolean }> {
  await requerirAccion("gestionar_almacen")

  const supabase = await createClient()
  const [desdeFila, hastaFila] = rangoPagina(pagina)
  const { data, error } = await supabase.rpc("listar_ordenes_entradas", {
    // Proyecto actual (selector del encabezado); la base valida el acceso.
    p_proyecto_id: filtros.proyectoId,
    p_numero: filtros.numero ?? null,
    p_proveedor: filtros.proveedor?.trim() || null,
    p_usuario: filtros.usuarioId ?? null,
    p_estado: filtros.estado ?? null,
    // Colombia es UTC-5 todo el año: así "hasta" incluye el día completo.
    p_desde: filtros.desde ? `${filtros.desde}T00:00:00-05:00` : null,
    p_hasta: filtros.hasta ? `${filtros.hasta}T23:59:59.999-05:00` : null,
    p_limite: hastaFila - desdeFila + 1, // una fila de más: así se sabe si hay otra página
    p_offset: desdeFila,
  })
  if (error) throw new Error(error.message)

  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return {
    filas: filas.map((o) => ({
      id: o.id,
      numero: o.numero,
      estadoEntrega: o.estado_entrega,
      proyectoCodigo: o.proyecto_codigo,
      proyectoNombre: o.proyecto_nombre,
      proveedorNombre: o.proveedor_nombre ?? "(proveedor eliminado)",
      entradaFecha: o.entrada_at,
      entradaPersona: o.entrada_por,
    })),
    hayMas,
  }
}

export type LineaEntrada = {
  id: string // ordenes_compra_items.id
  insumoCodigo: number
  insumoDescripcion: string
  // Si la línea se compró en otra presentación (cajas), `um` es esa
  // presentación y las tres cantidades vienen en ella: el almacén recibe cajas
  // y la base convierte a la unidad del insumo.
  um: string | null
  enUnidadCompra?: boolean
  cantidadOrdenada: number
  cantidadRecibida: number
  cantidadPendiente: number
}

export type LineaEntradaRegistrada = {
  id: string // entradas_almacen_items.id
  ordenCompraItemId: string
  insumoDescripcion: string
  um: string | null
  enUnidadCompra?: boolean
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
    lineas: (d.lineas ?? []).map((l: any) => {
      // Presentación (cajas): las cantidades se muestran y se reciben en cajas.
      const porUm = l.um_compra && l.cantidad_por_um ? Number(l.cantidad_por_um) : null
      const aCajas = (n: number) => (porUm ? redondear(n / porUm, 6) : n)
      return {
        id: l.id,
        insumoCodigo: l.insumo_codigo,
        insumoDescripcion: l.insumo_descripcion,
        um: porUm ? l.um_compra : l.um,
        enUnidadCompra: porUm !== null,
        cantidadOrdenada: aCajas(Number(l.cantidad_ordenada)),
        cantidadRecibida: aCajas(Number(l.cantidad_recibida)),
        cantidadPendiente: aCajas(Number(l.cantidad_pendiente)),
      }
    }),
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
      lineas: (e.lineas ?? []).map((l: any) => {
        const porUm = l.um_compra && l.cantidad_por_um ? Number(l.cantidad_por_um) : null
        const aCajas = (n: number) => (porUm ? redondear(n / porUm, 6) : n)
        return {
          id: l.id,
          ordenCompraItemId: l.orden_compra_item_id,
          insumoDescripcion: l.insumo_descripcion,
          um: porUm ? l.um_compra : l.um,
          enUnidadCompra: porUm !== null,
          cantidad: aCajas(Number(l.cantidad)),
          cantidadOriginal: l.cantidad_original === null ? null : aCajas(Number(l.cantidad_original)),
        }
      }),
    })),
  }
}

export type DatosEntrada = {
  ordenId: string
  remision?: string | null
  observaciones?: string | null
  // enUnidadCompra: la cantidad viene en la presentación de la línea (cajas) y
  // la base la convierte a la unidad del insumo con decimales exactos.
  lineas: { ordenCompraItemId: string; cantidad: number; enUnidadCompra?: boolean }[]
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
    p_lineas: lineas.map((l) =>
      l.enUnidadCompra
        ? { orden_compra_item_id: l.ordenCompraItemId, cantidad_compra: l.cantidad }
        : { orden_compra_item_id: l.ordenCompraItemId, cantidad: l.cantidad }
    ),
  })
  if (error) throw new Error(error.message)

  const detalle = await obtenerDetalleOrdenParaEntrada(datos.ordenId)
  return detalle.estadoEntrega
}

export type DatosEdicionEntrada = {
  entradaId: string
  remision?: string | null
  observaciones?: string | null
  lineas: { id: string; cantidad: number; enUnidadCompra?: boolean }[] // id = LineaEntradaRegistrada.id
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
    p_lineas: datos.lineas.map((l) =>
      l.enUnidadCompra ? { id: l.id, cantidad_compra: l.cantidad } : { id: l.id, cantidad: l.cantidad }
    ),
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
