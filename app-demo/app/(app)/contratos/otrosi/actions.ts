"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirAlgunaPestana, requerirPestana } from "@/lib/permisos"
import { hoyColombia } from "@/lib/fechas"
import {
  PESTANAS_VER_OTROSI,
  limpiarMinutaOtrosi,
  mapActividadesParaOtrosi,
  mapContratoParaOtrosi,
  mapOtrosiDeContrato,
  mapOtrosiDetalle,
  mapOtrosiFila,
  mezclarMinutaOtrosi,
  minutaOtrosiPorDefecto,
  validarSolicitudOtrosi,
  type ActividadOtrosiEnvio,
  type ActividadesParaOtrosi,
  type ContratoParaOtrosi,
  type EstadoOtrosi,
  type MinutaOtrosi,
  type ModificacionOtrosi,
  type OtrosiDeContrato,
  type OtrosiDetalle,
  type OtrosiFila,
} from "@/lib/otrosi"

// ---------------------------------------------------------------------------
// Otrosí: Solicitud de otrosí (pestaña contratos.solicitar_otrosi, acción
// solicitar_contratos) y Aprobación de otrosí (contratos.aprobar_otrosi;
// Jurídica = aprobar_contratos, Subgerencia = aprobar_minutas). Todo pasa por
// funciones de la base que validan permiso, proyecto, estado y que el plazo
// del contrato no haya terminado (20261119000000_otrosis.sql).
// ---------------------------------------------------------------------------

const PESTANAS_OTROSI = ["contratos.solicitar_otrosi", "contratos.aprobar_otrosi"]

export async function contratosParaOtrosi(): Promise<ContratoParaOtrosi[]> {
  await requerirPestana("contratos.solicitar_otrosi")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("contratos_para_otrosi")
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(mapContratoParaOtrosi)
}

// Actividades del contrato y del presupuesto para agregar en el otrosí
// (20261124000000_tope_mano_obra_y_actividades_otrosi.sql).
export async function actividadesParaOtrosi(contratoId: string): Promise<ActividadesParaOtrosi> {
  await requerirPestana("contratos.solicitar_otrosi")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("actividades_para_otrosi", { p_contrato_id: contratoId })
  if (error) throw new Error(error.message)
  return mapActividadesParaOtrosi((data ?? {}) as Record<string, unknown>)
}

// nuevaFechaFin: prórroga opcional (la base revisa que amplíe el plazo vigente).
// nuevoValor: nuevo valor total opcional (la base revisa que no baje de lo cobrado).
// actividades: adiciones y actividades nuevas (con ellas el valor lo pone la
// base: vigente + lo que suman).
export async function crearOtrosi(contratoId: string, modificaciones: ModificacionOtrosi[], justificacion: string, nuevaFechaFin: string | null = null, nuevoValor: number | null = null, actividades: ActividadOtrosiEnvio[] = []): Promise<string> {
  await requerirAccion("solicitar_contratos")
  const problema = validarSolicitudOtrosi({ contratoId, modificaciones, justificacion })
  if (problema) throw new Error(problema)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("crear_otrosi", {
    p_contrato_id: contratoId,
    p_modificaciones: modificaciones,
    p_justificacion: justificacion,
    p_nueva_fecha_fin: nuevaFechaFin || null,
    p_nuevo_valor: nuevoValor,
    p_actividades: actividades,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function reenviarOtrosi(id: string, modificaciones: ModificacionOtrosi[], justificacion: string, nuevaFechaFin: string | null = null, nuevoValor: number | null = null, actividades: ActividadOtrosiEnvio[] = []): Promise<void> {
  await requerirAccion("solicitar_contratos")
  const problema = validarSolicitudOtrosi({ contratoId: id, modificaciones, justificacion })
  if (problema) throw new Error(problema)
  const supabase = await createClient()
  const { error } = await supabase.rpc("reenviar_otrosi", {
    p_id: id,
    p_modificaciones: modificaciones,
    p_justificacion: justificacion,
    p_nueva_fecha_fin: nuevaFechaFin || null,
    p_nuevo_valor: nuevoValor,
    p_actividades: actividades,
  })
  if (error) throw new Error(error.message)
}

export type FiltrosOtrosi = { estados?: EstadoOtrosi[]; proyectoId?: string; soloEnviados?: boolean }

export async function listarOtrosis(filtros: FiltrosOtrosi): Promise<OtrosiFila[]> {
  await requerirAlgunaPestana(PESTANAS_OTROSI)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_otrosis", {
    p_estados: filtros.estados && filtros.estados.length > 0 ? filtros.estados : null,
    p_proyecto_id: filtros.proyectoId ?? null,
    p_solo_enviados: filtros.soloEnviados ?? false,
  })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(mapOtrosiFila)
}

async function cargarOtrosi(id: string): Promise<OtrosiDetalle> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("detalle_otrosi", { p_id: id })
  if (error) throw new Error(error.message)
  return mapOtrosiDetalle(data as Record<string, unknown>)
}

export async function obtenerOtrosi(id: string): Promise<OtrosiDetalle> {
  await requerirAlgunaPestana(PESTANAS_OTROSI)
  return cargarOtrosi(id)
}

export type DocumentoOtrosi = {
  minuta: MinutaOtrosi
  porDefecto: MinutaOtrosi
  numero: number
  guardadaAt: string | null
  guardadaPorNombre: string | null
}

// El documento: lo calculado (contrato, partes y lo que pidió el ingeniero) y
// encima lo que Jurídica guardó. Una vez enviado a Subgerencia, lo guardado es
// el documento completo.
export async function obtenerDocumentoOtrosi(id: string): Promise<DocumentoOtrosi> {
  await requerirAlgunaPestana(PESTANAS_OTROSI)
  const d = await cargarOtrosi(id)
  const defecto = minutaOtrosiPorDefecto(d, hoyColombia())
  return {
    minuta: mezclarMinutaOtrosi(defecto, d.minutaDatos),
    porDefecto: defecto,
    numero: d.numero ?? d.numeroProvisional,
    guardadaAt: d.minutaActualizadaAt,
    guardadaPorNombre: d.minutaActualizadaPorNombre,
  }
}

export async function guardarDocumentoOtrosi(id: string, minuta: MinutaOtrosi): Promise<{ guardadaAt: string }> {
  await requerirAccion("aprobar_contratos")
  const supabase = await createClient()
  const { error } = await supabase.rpc("guardar_minuta_otrosi", { p_id: id, p_datos: limpiarMinutaOtrosi(minuta) })
  if (error) throw new Error(error.message)
  return { guardadaAt: new Date().toISOString() }
}

export type AccionJuridicaOtrosi = "enviar" | "devolver" | "rechazar"
export type AccionSubgerenciaOtrosi = "aprobar" | "devolver_juridica"

// Jurídica: enviar a Subgerencia (con el documento GUARDADO completo, como las
// minutas: lo que aprueba Subgerencia no cambia aunque cambien los datos del
// contratista), devolver al ingeniero o rechazar.
export async function resolverOtrosiJuridica(id: string, accion: AccionJuridicaOtrosi, motivo?: string): Promise<void> {
  await requerirAccion("aprobar_contratos")
  if (accion !== "enviar" && !motivo?.trim()) throw new Error("Escribe el motivo.")
  const supabase = await createClient()
  let minuta: MinutaOtrosi | null = null
  if (accion === "enviar") {
    const d = await cargarOtrosi(id)
    minuta = limpiarMinutaOtrosi(mezclarMinutaOtrosi(minutaOtrosiPorDefecto(d, hoyColombia()), d.minutaDatos))
    if (minuta.modificaciones.length === 0) throw new Error("El otrosí no tiene cláusulas: revisa el documento.")
  }
  const { error } = await supabase.rpc("resolver_otrosi", {
    p_id: id,
    p_accion: accion,
    p_motivo: motivo?.trim() || null,
    p_minuta: minuta,
  })
  if (error) throw new Error(error.message)
}

export async function resolverOtrosiSubgerencia(id: string, accion: AccionSubgerenciaOtrosi, motivo?: string): Promise<void> {
  await requerirAccion("aprobar_minutas")
  if (accion === "devolver_juridica" && !motivo?.trim()) throw new Error("Escribe el motivo.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_otrosi", { p_id: id, p_accion: accion, p_motivo: motivo?.trim() || null, p_minuta: null })
  if (error) throw new Error(error.message)
}

// Los otrosí de un contrato, para verlos desde el contrato (detalle del
// contrato, Actas). Puede llamarla quien ve contratos (otrosis_de_contrato).
export async function otrosisDeContrato(contratoId: string): Promise<OtrosiDeContrato[]> {
  await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("otrosis_de_contrato", { p_contrato_id: contratoId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(mapOtrosiDeContrato)
}
