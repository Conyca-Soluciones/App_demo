"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requerirAlgunaPestana, requerirPestana } from "@/lib/permisos"
import { puedeBuscar } from "@/lib/busqueda"
import { PESTANAS_VER_OTROSI } from "@/lib/otrosi"
import { hoyColombia } from "@/lib/fechas"
import {
  actaPolizaPorDefecto,
  limpiarActaPoliza,
  mapDatosActaPoliza,
  mezclarActaPoliza,
  validarActaPoliza,
  type ActaPoliza,
} from "@/lib/acta-poliza"
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

// Cambiar el archivo de una póliza que Jurídica todavía no revisa
// (20270101001700). El navegador ya subió el nuevo; devuelve la ruta del
// anterior para borrarlo.
export async function reemplazarPoliza(
  polizaId: string,
  archivo: { ruta: string; nombreArchivo: string; tamano: number; mime: string }
): Promise<string | null> {
  await requerirPestana("contratos.polizas")
  const problema = validarArchivoPoliza({ name: archivo.nombreArchivo, size: archivo.tamano, type: archivo.mime })
  if (problema) throw new Error(problema)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("reemplazar_poliza", {
    p_poliza_id: polizaId,
    p_ruta: archivo.ruta,
    p_nombre_archivo: archivo.nombreArchivo,
    p_tamano: archivo.tamano,
    p_mime: archivo.mime,
  })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

// Enlace temporal (2 minutos) para ver el archivo. Decide la RLS de
// contrato_polizas (la fila se lee con la sesión del usuario); el enlace se
// firma con el cliente de servicio, porque la firma con la sesión del usuario
// respondía 400 en Storage aunque la fila sí se leía (React #441 en pantalla).
export async function enlacePoliza(polizaId: string): Promise<string> {
  await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  const supabase = await createClient()
  const { data: p, error } = await supabase.from("contrato_polizas").select("ruta").eq("id", polizaId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!p) throw new Error("La póliza no existe o no tienes acceso.")
  const storage = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient().storage : supabase.storage
  const { data, error: errorUrl } = await storage.from("polizas").createSignedUrl(p.ruta, 120)
  if (errorUrl || !data) {
    console.error("enlacePoliza:", errorUrl?.message)
    throw new Error("No se pudo abrir la póliza.")
  }
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

// Aprobar lleva el acta de aprobación (la de pantalla); la base la exige.
export async function resolverPoliza(id: string, accion: "aprobar" | "devolver", motivo: string, acta?: ActaPoliza): Promise<void> {
  await requerirPestana("contratos.aprobar_polizas")
  if (accion === "devolver" && !motivo.trim()) throw new Error("Escribe el motivo de la devolución.")
  if (accion === "aprobar") {
    if (!acta) throw new Error("Llena el acta de aprobación de la póliza antes de aprobarla.")
    const problema = validarActaPoliza(acta)
    if (problema) throw new Error(problema)
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_poliza", {
    p_id: id,
    p_accion: accion,
    p_motivo: motivo.trim() || null,
    p_acta: accion === "aprobar" && acta ? limpiarActaPoliza(acta) : null,
  })
  if (error) throw new Error(error.message)
  // Desde 20270101001700 no se genera ni se firma el acta: los datos quedan
  // guardados con la póliza y la app avisa al ingeniero.
}

// ---------------------------------------------------------------- acta de aprobación
export type DocumentoActaPoliza = {
  acta: ActaPoliza // lo guardado sobre lo calculado
  porDefecto: ActaPoliza
  editable: boolean // la póliza está por revisar
  guardadaAt: string | null
  guardadaPorNombre: string | null
}

export async function obtenerActaPoliza(id: string): Promise<DocumentoActaPoliza> {
  await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("datos_acta_poliza", { p_id: id })
  if (error) throw new Error(error.message)
  const d = mapDatosActaPoliza((data ?? {}) as Record<string, unknown>)
  const porDefecto = actaPolizaPorDefecto(d, hoyColombia())
  return {
    acta: mezclarActaPoliza(porDefecto, d.actaDatos),
    porDefecto,
    editable: d.poliza.estado === "por_revisar",
    guardadaAt: d.actaActualizadaAt,
    guardadaPorNombre: d.actaActualizadaPorNombre,
  }
}

export async function guardarActaPoliza(id: string, acta: ActaPoliza): Promise<{ guardadaAt: string }> {
  await requerirPestana("contratos.aprobar_polizas")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("guardar_acta_poliza", { p_id: id, p_acta: limpiarActaPoliza(acta) })
  if (error) throw new Error(error.message)
  return { guardadaAt: String(data) }
}
