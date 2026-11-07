"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerUsuarioId } from "@/lib/permisos"
import { TAMANO_PAGINA, cortarPagina } from "@/lib/paginacion"
import { hoyColombia } from "@/lib/fechas"
import {
  lineasParaGuardar,
  mapDetalleReqAdministrativa,
  mapFilaReqAdministrativa,
  mapProyectoReqAdministrativa,
  validarReqAdministrativa,
  type LineaFormReqAdministrativa,
  type ProyectoReqAdministrativa,
  type ReqAdministrativaDetalle,
  type ReqAdministrativaFila,
} from "@/lib/requisiciones-administrativas"

// Requisiciones administrativas (FUNCIONAMIENTO o un proyecto, 20261231900000): las hace
// cualquier usuario con sesión; todo pasa por funciones de la base, que vuelven
// a validar y exigen la sesión.

async function clienteConSesion() {
  if (!(await obtenerUsuarioId())) throw new Error("Inicia sesión.")
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
}): Promise<{ id: string; numero: number }> {
  const error = validarReqAdministrativa(datos.lineas, datos.fechaRequerida, hoyColombia(), datos.proyectoId)
  if (error) throw new Error(error)
  const supabase = await clienteConSesion()
  const { data, error: e } = await supabase.rpc("crear_requisicion_administrativa", {
    p_proyecto_id: datos.proyectoId,
    p_lineas: lineasParaGuardar(datos.lineas),
    p_fecha_requerida: datos.fechaRequerida,
    p_urgente: datos.urgente,
    p_observaciones: datos.observaciones.trim() || null,
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
