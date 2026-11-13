"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirAlgunaPestana, requerirPestana } from "@/lib/permisos"
import { hoyColombia } from "@/lib/fechas"
import {
  mapFirmaRepresentante,
  mapRepresentante,
  principalActivo,
  type FirmaRepresentanteContrato,
  type RepresentanteLegal,
} from "@/lib/representantes"
import { mapTitularCuenta, type TitularCuenta } from "@/lib/titular-cuenta"
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
// Jurídica = aprobar_contratos, Gerencia = aprobar_minutas). Todo pasa por
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
// titular: "Depositar a otro tercero" (20270101002900). Al aprobarse el otrosí,
// el contrato queda con ese tercero y esa cuenta; null = no cambia.
export async function crearOtrosi(contratoId: string, modificaciones: ModificacionOtrosi[], justificacion: string, nuevaFechaFin: string | null = null, nuevoValor: number | null = null, actividades: ActividadOtrosiEnvio[] = [], titular: { tercero_id: string; cuenta_id: string } | null = null): Promise<string> {
  await requerirAccion("solicitar_contratos")
  const problema = validarSolicitudOtrosi({ contratoId, modificaciones, justificacion })
  if (problema) throw new Error(problema)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("crear_otrosi_con_titular", {
    p_contrato_id: contratoId,
    p_modificaciones: modificaciones,
    p_justificacion: justificacion,
    p_nueva_fecha_fin: nuevaFechaFin || null,
    p_nuevo_valor: nuevoValor,
    p_actividades: actividades,
    p_titular: titular,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function reenviarOtrosi(id: string, modificaciones: ModificacionOtrosi[], justificacion: string, nuevaFechaFin: string | null = null, nuevoValor: number | null = null, actividades: ActividadOtrosiEnvio[] = [], titular: { tercero_id: string; cuenta_id: string } | null = null): Promise<void> {
  await requerirAccion("solicitar_contratos")
  const problema = validarSolicitudOtrosi({ contratoId: id, modificaciones, justificacion })
  if (problema) throw new Error(problema)
  const supabase = await createClient()
  const { error } = await supabase.rpc("reenviar_otrosi_con_titular", {
    p_id: id,
    p_modificaciones: modificaciones,
    p_justificacion: justificacion,
    p_nueva_fecha_fin: nuevaFechaFin || null,
    p_nuevo_valor: nuevoValor,
    p_actividades: actividades,
    p_titular: titular,
  })
  if (error) throw new Error(error.message)
}

// El tercero a donde se depositará si se aprueba el otrosí (null = no cambia).
export async function titularDeOtrosi(id: string): Promise<TitularCuenta | null> {
  await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("titular_de_otrosi", { p_otrosi_id: id })
  if (error) throw new Error(error.message)
  return mapTitularCuenta(data)
}

// Quién firmaría como representante legal si se aprueba el otrosí ahora.
export async function firmaRepresentanteOtrosi(id: string): Promise<FirmaRepresentanteContrato> {
  await requerirPestana("contratos.aprobar_otrosi")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("representante_que_firma_otrosi", { p_otrosi_id: id })
  if (error) throw new Error(error.message)
  return mapFirmaRepresentante(data)
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

// El otrosí con los representantes legales de la empresa del proyecto (para el
// documento: el principal es el que firma por omisión). Quien no lee los
// representantes (representantes_de_contrato) recibe la lista vacía.
async function cargarOtrosiConRepresentantes(id: string): Promise<{ detalle: OtrosiDetalle; representantes: RepresentanteLegal[] }> {
  const d = await cargarOtrosi(id)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("representantes_de_contrato", { p_contrato_id: d.contratoId })
  const representantes: RepresentanteLegal[] = !error && Array.isArray(data) ? data.map(mapRepresentante) : []
  const p = principalActivo(representantes)
  return {
    detalle: { ...d, empresaRepresentante: p ? { nombre: p.nombre, documento: p.numeroDocumento, expedidaEn: p.expedidaEn } : null },
    representantes,
  }
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
  representantes: RepresentanteLegal[] // de la empresa del proyecto (selector del documento)
}

// El documento: lo calculado (contrato, partes y lo que pidió el ingeniero) y
// encima lo que Jurídica guardó. Una vez enviado a Gerencia, lo guardado es
// el documento completo.
export async function obtenerDocumentoOtrosi(id: string): Promise<DocumentoOtrosi> {
  await requerirAlgunaPestana(PESTANAS_OTROSI)
  const { detalle: d, representantes } = await cargarOtrosiConRepresentantes(id)
  const defecto = minutaOtrosiPorDefecto(d, hoyColombia())
  return {
    minuta: mezclarMinutaOtrosi(defecto, d.minutaDatos),
    porDefecto: defecto,
    numero: d.numero ?? d.numeroProvisional,
    guardadaAt: d.minutaActualizadaAt,
    guardadaPorNombre: d.minutaActualizadaPorNombre,
    representantes,
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
export type AccionGerenciaOtrosi = "aprobar" | "devolver_juridica"

// Jurídica: enviar a Gerencia (con el documento GUARDADO completo, como las
// minutas: lo que aprueba Gerencia no cambia aunque cambien los datos del
// contratista), devolver al ingeniero o rechazar.
export async function resolverOtrosiJuridica(id: string, accion: AccionJuridicaOtrosi, motivo?: string): Promise<void> {
  await requerirAccion("aprobar_contratos")
  if (accion !== "enviar" && !motivo?.trim()) throw new Error("Escribe el motivo.")
  const supabase = await createClient()
  let minuta: MinutaOtrosi | null = null
  if (accion === "enviar") {
    const { detalle: d } = await cargarOtrosiConRepresentantes(id)
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

export async function resolverOtrosiGerencia(id: string, accion: AccionGerenciaOtrosi, motivo?: string): Promise<void> {
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
