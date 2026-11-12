"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerUsuarioId } from "@/lib/permisos"

// RUT del tercero (20270101000300). Lo ve A&F (Terceros, consolidados,
// Aprobación de pagos); lo sube o lo cambia quien edita o verifica terceros o
// gestiona pagos (Preparación del Consolidado). La base decide en las dos cosas.

async function cliente() {
  if (!(await obtenerUsuarioId())) throw new Error("Inicia sesión.")
  return createClient()
}

/** Enlace firmado (2 min) al RUT del tercero. */
export async function enlaceRutTercero(terceroId: string): Promise<string> {
  const supabase = await cliente()
  const { data, error } = await supabase.from("terceros").select("rut_ruta").eq("id", terceroId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.rut_ruta) throw new Error("Este tercero no tiene RUT.")
  const { data: firmado, error: e } = await supabase.storage.from("terceros").createSignedUrl(data.rut_ruta, 120)
  if (e || !firmado) throw new Error("No tienes acceso al RUT de este tercero.")
  return firmado.signedUrl
}

/** Después de subir el archivo a terceros/rut/<tercero>/...: lo deja como el RUT del tercero. */
export async function guardarRutTercero(terceroId: string, archivo: { ruta: string; nombre: string; mime: string }): Promise<void> {
  const supabase = await cliente()
  const { error } = await supabase.rpc("guardar_rut_tercero", {
    p_tercero_id: terceroId,
    p_ruta: archivo.ruta,
    p_nombre: archivo.nombre,
    p_mime: archivo.mime,
  })
  if (error) throw new Error(error.message)
}
