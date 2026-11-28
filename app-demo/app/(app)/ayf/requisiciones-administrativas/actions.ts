"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { TAMANO_PAGINA, cortarPagina } from "@/lib/paginacion"
import { hoyColombia } from "@/lib/fechas"
import { normalizarDireccion, validarDireccion } from "@/lib/direccion-entrega"
import type { ResultadoAccion } from "@/lib/caja-menor"
import {
  lineasParaGuardar,
  mapDetalleReqAdministrativa,
  mapReqAdministrativaEspera,
  nuevosParaGuardar,
  mapFilaReqAdministrativa,
  mapProyectoReqAdministrativa,
  validarReqAdministrativa,
  type LineaFormReqAdministrativa,
  type NuevoInsumoFormReqAdministrativa,
  type ProyectoReqAdministrativa,
  type ReqAdministrativaEspera,
  type ReqAdministrativaDetalle,
  type ReqAdministrativaFila,
} from "@/lib/requisiciones-administrativas"

// Requisiciones administrativas (FUNCIONAMIENTO o un proyecto, 20261231900000): las hace
// cualquier usuario con sesión y las aprueba Subgerencia (20261231999400); todo
// pasa por funciones de la base, que vuelven a validar y exigen la sesión.

// Pestaña ayf.requisiciones_administrativas de la matriz de Roles (20270101001400).
async function clienteConSesion() {
  await requerirPestana("ayf.requisiciones_administrativas")
  return createClient()
}

// FUNCIONAMIENTO primero y luego los proyectos que la persona ve con presupuesto.
export async function listarProyectosReqAdministrativa(): Promise<ProyectoReqAdministrativa[]> {
  const supabase = await clienteConSesion()
  const { data, error } = await supabase.rpc("proyectos_requisicion_administrativa")
  if (error) throw new Error(error.message)
  return ((data as unknown[]) ?? []).map(mapProyectoReqAdministrativa)
}

export async function crearRequisicionAdministrativa(datos: {
  proyectoId: string
  lineas: LineaFormReqAdministrativa[]
  fechaRequerida: string
  urgente: boolean
  observaciones: string
  direccionEntrega: string
}): Promise<{ id: string; numero: number }> {
  const error =
    validarReqAdministrativa(datos.lineas, datos.fechaRequerida, hoyColombia(), datos.proyectoId) ??
    validarDireccion(datos.direccionEntrega)
  if (error) throw new Error(error)
  const supabase = await clienteConSesion()
  const { data, error: e } = await supabase.rpc("crear_requisicion_administrativa_con_direccion", {
    p_proyecto_id: datos.proyectoId,
    p_lineas: lineasParaGuardar(datos.lineas),
    p_fecha_requerida: datos.fechaRequerida,
    p_urgente: datos.urgente,
    p_observaciones: datos.observaciones.trim() || null,
    p_direccion_entrega: normalizarDireccion(datos.direccionEntrega),
  })
  if (e) throw new Error(e.message)
  const r = data as { id: string; numero: number }
  return { id: r.id, numero: Number(r.numero) }
}

export async function listarMisRequisicionesAdministrativas(
  pagina = 0
): Promise<{ filas: ReqAdministrativaFila[]; hayMas: boolean }> {
  const supabase = await clienteConSesion()
  const { data, error } = await supabase.rpc("listar_requisiciones_administrativas", {
    p_offset: pagina * TAMANO_PAGINA,
    p_limite: TAMANO_PAGINA + 1,
  })
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina(((data as unknown[]) ?? []).map(mapFilaReqAdministrativa))
  return { filas, hayMas }
}

export async function obtenerRequisicionAdministrativa(id: string): Promise<ReqAdministrativaDetalle> {
  const supabase = await clienteConSesion()
  const { data, error } = await supabase.rpc("detalle_requisicion_administrativa", { p_id: id })
  if (error) throw new Error(error.message)
  return mapDetalleReqAdministrativa(data)
}

export async function cancelarRequisicionAdministrativa(id: string, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error("El motivo es obligatorio.")
  const supabase = await clienteConSesion()
  const { error } = await supabase.rpc("cancelar_requisicion_administrativa", { p_id: id, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

// Con insumos que no están en el maestro (20270101005000): la requisición queda
// en espera; cuando aprueban el último insumo nuevo, la base la crea y pasa a
// Subgerencia.
export async function crearRequisicionAdministrativaEnEspera(datos: {
  proyectoId: string
  lineas: LineaFormReqAdministrativa[]
  nuevos: NuevoInsumoFormReqAdministrativa[]
  fechaRequerida: string
  urgente: boolean
  observaciones: string
  direccionEntrega: string
}): Promise<{ id: string }> {
  if (datos.nuevos.length === 0) throw new Error("No hay insumos nuevos: envía la requisición normal.")
  const error =
    validarReqAdministrativa(datos.lineas, datos.fechaRequerida, hoyColombia(), datos.proyectoId, datos.nuevos) ??
    validarDireccion(datos.direccionEntrega)
  if (error) throw new Error(error)
  const supabase = await clienteConSesion()
  const { data, error: e } = await supabase.rpc("crear_requisicion_administrativa_en_espera", {
    p_proyecto_id: datos.proyectoId,
    p_lineas: lineasParaGuardar(datos.lineas),
    p_nuevos: nuevosParaGuardar(datos.nuevos),
    p_fecha_requerida: datos.fechaRequerida,
    p_urgente: datos.urgente,
    p_observaciones: datos.observaciones.trim() || null,
    p_direccion_entrega: normalizarDireccion(datos.direccionEntrega),
  })
  if (e) throw new Error(e.message)
  return { id: String((data as { id: string }).id) }
}

export async function listarMisRequisicionesEnEspera(): Promise<ReqAdministrativaEspera[]> {
  const supabase = await clienteConSesion()
  const { data, error } = await supabase.rpc("mis_requisiciones_en_espera")
  if (error) throw new Error(error.message)
  return ((data as unknown[]) ?? []).map(mapReqAdministrativaEspera)
}

// Insumo nuevo rechazado: cambiarlo por uno del maestro (insumoId) o quitarlo (null).
export async function resolverInsumoRechazadoEspera(nuevoId: string, insumoId: string | null): Promise<void> {
  const supabase = await clienteConSesion()
  const { error } = await supabase.rpc("resolver_insumo_rechazado_espera", { p_nuevo: nuevoId, p_insumo: insumoId })
  if (error) throw new Error(error.message)
}

export async function reintentarRequisicionEspera(id: string): Promise<void> {
  const supabase = await clienteConSesion()
  const { error } = await supabase.rpc("reintentar_requisicion_espera", { p_id: id })
  if (error) throw new Error(error.message)
}

export async function cancelarRequisicionEspera(id: string, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error("El motivo es obligatorio.")
  const supabase = await clienteConSesion()
  const { error } = await supabase.rpc("cancelar_requisicion_espera", { p_id: id, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

// Quien la hizo, mientras Subgerencia no la haya resuelto (20270101005100):
// insumos del maestro, cantidades, proyecto, fecha requerida, urgente,
// observaciones y dirección. Si cambia el proyecto, recibe el número RQ del
// proyecto nuevo.
export async function modificarRequisicionAdministrativa(
  id: string,
  datos: {
    proyectoId: string
    lineas: LineaFormReqAdministrativa[]
    fechaRequerida: string
    fechaOriginal: string | null
    urgente: boolean
    observaciones: string
    direccionEntrega: string
  }
): Promise<ResultadoAccion<void>> {
  // Devuelve el motivo en vez de lanzarlo: en producción Next.js esconde el
  // mensaje de un error lanzado (pasó al modificar una rechazada, 2026-11-28).
  // Si no cambió la fecha, puede quedar en el pasado (la base hace lo mismo).
  const hoy = hoyColombia()
  const minimo = datos.fechaRequerida === datos.fechaOriginal ? "0000-01-01" : hoy
  const error =
    validarReqAdministrativa(datos.lineas, datos.fechaRequerida, minimo, datos.proyectoId) ??
    validarDireccion(datos.direccionEntrega)
  if (error) return { ok: false, error }
  const supabase = await clienteConSesion()
  const { error: e } = await supabase.rpc("modificar_requisicion_administrativa", {
    p_id: id,
    p_proyecto_id: datos.proyectoId,
    p_lineas: lineasParaGuardar(datos.lineas),
    p_fecha_requerida: datos.fechaRequerida,
    p_urgente: datos.urgente,
    p_observaciones: datos.observaciones.trim() || null,
    p_direccion_entrega: normalizarDireccion(datos.direccionEntrega),
  })
  if (e) return { ok: false, error: e.message }
  return { ok: true, valor: undefined }
}
