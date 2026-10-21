"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAlgunaPestana, requerirPestana } from "@/lib/permisos"
import { puedeBuscar } from "@/lib/busqueda"
import { PESTANAS_VER_OTROSI } from "@/lib/otrosi"
import {
  mapContratoPoliza,
  mapPoliza,
  mapPolizaConContrato,
  validarArchivoPoliza,
  type ContratoPoliza,
  type EstadoPoliza,
  type Poliza,
  type PolizaConContrato,
} from "@/lib/polizas"

// ---------------------------------------------------------------------------
// Pólizas (pestaña contratos.polizas) y Aprobación de pólizas
// (contratos.aprobar_polizas; aprobar o devolver exige además la acción
// aprobar_contratos). Todo pasa por funciones de la base
// (20261126000000_polizas.sql); el archivo lo sube el navegador al bucket
// privado "polizas" antes de llamar subirPoliza.
// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>

export type ContratistaParaPoliza = { id: string; nombre: string; documento: string; contratos: number }

export async function buscarContratistasParaPoliza(texto: string): Promise<ContratistaParaPoliza[]> {
  await requerirPestana("contratos.polizas")
  const t = texto.trim()
  if (!puedeBuscar(t)) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("buscar_contratistas_para_poliza", { p_texto: t })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Fila[]).map((k) => ({
    id: String(k.contratista_id),
    nombre: String(k.nombre ?? ""),
    documento: String(k.documento ?? ""),
    contratos: Number(k.contratos ?? 0),
  }))
}

export async function buscarContratosParaPoliza(texto: string): Promise<ContratoPoliza[]> {
  await requerirPestana("contratos.polizas")
  const t = texto.trim()
  if (!puedeBuscar(t)) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("buscar_contratos_para_poliza", { p_texto: t })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Fila[]).map(mapContratoPoliza)
}

export async function contratosDeContratistaParaPoliza(contratistaId: string): Promise<ContratoPoliza[]> {
  await requerirPestana("contratos.polizas")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("buscar_contratos_para_poliza", { p_texto: null, p_contratista_id: contratistaId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Fila[]).map(mapContratoPoliza)
}

export async function polizasDeContrato(contratoId: string): Promise<{ contrato: ContratoPoliza; polizas: Poliza[] }> {
  await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("polizas_de_contrato", { p_contrato_id: contratoId })
  if (error) throw new Error(error.message)
  const x = (data ?? {}) as Fila
  return {
    contrato: mapContratoPoliza((x.contrato ?? {}) as Fila),
    polizas: (Array.isArray(x.polizas) ? (x.polizas as Fila[]) : []).map(mapPoliza),
  }
}

export async function subirPoliza(
  contratoId: string,
  archivo: { ruta: string; nombreArchivo: string; tamano: number; mime: string }
): Promise<string> {
  await requerirPestana("contratos.polizas")
  const problema = validarArchivoPoliza({ name: archivo.nombreArchivo, size: archivo.tamano, type: archivo.mime })
  if (problema) throw new Error(problema)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("subir_poliza", {
    p_contrato_id: contratoId,
    p_ruta: archivo.ruta,
    p_nombre_archivo: archivo.nombreArchivo,
    p_tamano: archivo.tamano,
    p_mime: archivo.mime,
  })
  if (error) throw new Error(error.message)
  return data as string
}

// Enlace temporal (2 minutos) para ver el archivo. La RLS de contrato_polizas
// (y la del bucket) deciden si se puede.
export async function enlacePoliza(polizaId: string): Promise<string> {
  await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  const supabase = await createClient()
  const { data: p, error } = await supabase.from("contrato_polizas").select("ruta").eq("id", polizaId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!p) throw new Error("La póliza no existe o no tienes acceso.")
  const { data, error: errorUrl } = await supabase.storage.from("polizas").createSignedUrl(p.ruta, 120)
  if (errorUrl || !data) throw new Error(errorUrl?.message ?? "No se pudo abrir la póliza.")
  return data.signedUrl
}

// ---------------------------------------------------------------- aprobación
export async function listarPolizasAprobacion(estados?: EstadoPoliza[]): Promise<PolizaConContrato[]> {
  await requerirPestana("contratos.aprobar_polizas")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_polizas_aprobacion", { p_estados: estados && estados.length > 0 ? estados : null })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Fila[]).map(mapPolizaConContrato)
}

export async function obtenerPoliza(id: string): Promise<PolizaConContrato> {
  await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("detalle_poliza", { p_id: id })
  if (error) throw new Error(error.message)
  return mapPolizaConContrato((data ?? {}) as Fila)
}

// La póliza por revisar de un contrato (la campanita lleva al contrato).
export async function polizaPorRevisarDeContrato(contratoId: string): Promise<string | null> {
  const { polizas } = await polizasDeContrato(contratoId)
  return polizas.find((p) => p.estado === "por_revisar")?.id ?? polizas[0]?.id ?? null
}

export async function resolverPoliza(id: string, accion: "aprobar" | "devolver", motivo: string): Promise<void> {
  await requerirPestana("contratos.aprobar_polizas")
  if (accion === "devolver" && !motivo.trim()) throw new Error("Escribe el motivo de la devolución.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_poliza", { p_id: id, p_accion: accion, p_motivo: motivo.trim() || null })
  if (error) throw new Error(error.message)
}
