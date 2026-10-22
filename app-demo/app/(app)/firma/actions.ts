"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerUsuarioId } from "@/lib/permisos"
import { MAXIMO_CARACTERES_FIRMA, type PapelFirma } from "@/lib/firmas"

// ---------------------------------------------------------------------------
// Mi firma (cualquier usuario con sesión, desde el menú de su nombre) y
// Verificar documento. La base valida todo (20261129000000_firmas.sql).
// ---------------------------------------------------------------------------

async function sesion() {
  const uid = await obtenerUsuarioId()
  if (!uid) throw new Error("Inicia sesión otra vez.")
  return uid
}

export type MiFirma = { imagen: string; actualizadaAt: string } | null

export async function obtenerMiFirma(): Promise<MiFirma> {
  const uid = await sesion()
  const supabase = await createClient()
  const { data, error } = await supabase.from("firmas_usuario").select("imagen, actualizada_at").eq("perfil_id", uid).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? { imagen: data.imagen, actualizadaAt: data.actualizada_at } : null
}

export async function guardarMiFirma(imagen: string): Promise<string> {
  await sesion()
  if (!imagen.startsWith("data:image/png;base64,")) throw new Error("La firma no es válida.")
  if (imagen.length > MAXIMO_CARACTERES_FIRMA) throw new Error("La firma pesa demasiado: recórtala o usa una foto más pequeña.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("guardar_mi_firma", { p_imagen: imagen })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function borrarMiFirma(): Promise<void> {
  await sesion()
  const supabase = await createClient()
  const { error } = await supabase.rpc("borrar_mi_firma")
  if (error) throw new Error(error.message)
}

export type ResultadoVerificacion = {
  titulo: string
  archivoOriginal: boolean // la huella del archivo coincide con el PDF congelado
  congeladoAt: string | null
  firmas: { papel: PapelFirma; nombre: string; cargo: string | null; codigo: string; firmadoAt: string; conImagen: boolean }[]
} | null

export async function verificarDocumento(entrada: { sha256?: string; codigo?: string }): Promise<ResultadoVerificacion> {
  await sesion()
  const sha256 = entrada.sha256?.trim().toLowerCase()
  const codigo = entrada.codigo?.replace(/[^A-Za-z0-9]/g, "")
  if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Huella no válida.")
  if (!sha256 && (!codigo || codigo.length !== 12)) throw new Error("El código tiene 12 letras y números (XXXX-XXXX-XXXX).")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("verificar_documento", sha256 ? { p_sha256: sha256 } : { p_codigo: codigo })
  if (error) throw new Error(error.message)
  if (!data) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any
  return {
    titulo: String(d.titulo ?? "Documento"),
    archivoOriginal: Boolean(d.archivo_original),
    congeladoAt: d.congelado_at ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    firmas: (d.firmas ?? []).map((f: any) => ({
      papel: f.papel,
      nombre: f.nombre,
      cargo: f.cargo ?? null,
      codigo: f.codigo,
      firmadoAt: f.firmado_at,
      conImagen: Boolean(f.con_imagen),
    })),
  }
}
