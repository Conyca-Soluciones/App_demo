"use server"

import { esCantidadEnteraPositiva } from "@/lib/numeros"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion } from "@/lib/permisos"
import { cortarPagina, TAMANO_PAGINA } from "@/lib/paginacion"

// ---------------------------------------------------------------------------
// SALIDAS de bodega hacia obra. Limitadas por el inventario disponible
// (entradas - salidas no anuladas). El tope, el permiso y el bloqueo de
// concurrencia viven en las funciones SQL de
// 20260930200000_salidas_almacen.sql; la tabla ya no acepta inserts directos.
// El stock disponible por insumo sale de obtenerInventarioProyecto
// (almacen/inventario/actions.ts).
// ---------------------------------------------------------------------------

export type SalidaRegistrada = {
  id: string
  fecha: string
  createdAt: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  cantidad: number
  cantidadOriginal: number | null // solo si la cantidad fue editada
  retira: string | null
  observaciones: string | null
  registradoPorNombre: string | null
  editadaAt: string | null
  editadaPorNombre: string | null
  anuladaAt: string | null
  anuladaPorNombre: string | null
  motivoAnulacion: string | null
}

export type FiltrosSalidas = {
  insumo?: string // código exacto o parte de la descripción
  desde?: string // YYYY-MM-DD, fecha de la salida
  hasta?: string
  incluirAnuladas?: boolean
}

// Una página (50) de las salidas del proyecto, la más reciente primero. Todo
// se filtra en la base (listar_salidas_registradas, que valida el acceso al
// proyecto): el costo no crece con el historial.
export async function listarSalidasRegistradas(
  proyectoId: string,
  filtros: FiltrosSalidas = {},
  pagina = 0
): Promise<{ salidas: SalidaRegistrada[]; hayMas: boolean }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_salidas_registradas", {
    p_proyecto_id: proyectoId,
    p_insumo: filtros.insumo?.trim() || null,
    p_desde: filtros.desde || null,
    p_hasta: filtros.hasta || null,
    p_incluir_anuladas: filtros.incluirAnuladas ?? true,
    p_limite: TAMANO_PAGINA + 1,
    p_offset: pagina * TAMANO_PAGINA,
  })
  if (error) throw new Error(error.message)

  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return {
    hayMas,
    salidas: filas.map((s) => ({
      id: s.id,
      fecha: s.fecha,
      createdAt: s.created_at,
      insumoCodigo: s.insumo_codigo,
      insumoDescripcion: s.insumo_descripcion,
      insumoUm: s.insumo_um,
      cantidad: Number(s.cantidad),
      cantidadOriginal: s.cantidad_original === null ? null : Number(s.cantidad_original),
      retira: s.retira,
      observaciones: s.observaciones,
      registradoPorNombre: s.registrado_por_nombre,
      editadaAt: s.editada_at,
      editadaPorNombre: s.editada_por_nombre,
      anuladaAt: s.anulada_at,
      anuladaPorNombre: s.anulada_por_nombre,
      motivoAnulacion: s.motivo_anulacion,
    })),
  }
}

export type DatosSalida = {
  proyectoId: string
  retira?: string | null
  observaciones?: string | null
  lineas: { insumoId: string; cantidad: number }[]
}

// Devuelve cuántas líneas se registraron.
export async function registrarSalida(datos: DatosSalida): Promise<number> {
  await requerirAccion("gestionar_almacen")

  const lineas = datos.lineas.filter((l) => l.cantidad > 0)
  if (lineas.length === 0) {
    throw new Error("Ingresa la cantidad a sacar de al menos un insumo.")
  }
  // Solo enteros (decisión del usuario; la pantalla ya lo valida).
  if (!lineas.every((l) => esCantidadEnteraPositiva(l.cantidad))) throw new Error("Las cantidades deben ser números enteros mayores que cero.")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("registrar_salida_almacen", {
    p_proyecto_id: datos.proyectoId,
    p_lineas: lineas.map((l) => ({ insumo_id: l.insumoId, cantidad: l.cantidad })),
    p_retira: datos.retira ?? null,
    p_observaciones: datos.observaciones ?? null,
  })
  if (error) throw new Error(error.message)
  return data as number
}

export async function anularSalida(salidaId: string, motivo: string): Promise<void> {
  await requerirAccion("gestionar_almacen")
  if (!motivo.trim()) throw new Error("El motivo de anulación es obligatorio.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("anular_salida_almacen", {
    p_salida_id: salidaId,
    p_motivo: motivo.trim(),
  })
  if (error) throw new Error(error.message)
}

export type DatosEdicionSalida = {
  salidaId: string
  cantidad: number
  retira?: string | null
  observaciones?: string | null
}

// Corrige una salida. El tope es lo disponible más lo que esta misma salida
// ya tenía sacado. Para cambiar de insumo, anula y registra de nuevo.
export async function editarSalida(datos: DatosEdicionSalida): Promise<void> {
  await requerirAccion("gestionar_almacen")
  if (!esCantidadEnteraPositiva(datos.cantidad)) throw new Error("La cantidad debe ser un número entero mayor que cero.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("editar_salida_almacen", {
    p_salida_id: datos.salidaId,
    p_cantidad: datos.cantidad,
    p_retira: datos.retira ?? null,
    p_observaciones: datos.observaciones ?? null,
  })
  if (error) throw new Error(error.message)
}
