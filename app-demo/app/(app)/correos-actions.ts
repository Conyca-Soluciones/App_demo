"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerUsuarioId, requerirAdmin } from "@/lib/permisos"

// Correos de 360 (20270101002100 / 002200): a quién le llegan los avisos de la
// campanita por correo (al correo con el que inicia sesión). Cada persona
// cambia el suyo; el Administrador, el de cualquiera y el envío general.

export type PreferenciaCorreo = "inmediato" | "nunca"

// Avisos uno por uno y resúmenes (12:00 lunes a viernes: pagos y cuentas;
// lunes 8:00: los pendientes de la semana), de quien está conectado.
export async function misCorreos(): Promise<{ avisos: PreferenciaCorreo; resumen: boolean }> {
  if (!(await obtenerUsuarioId())) throw new Error("Inicia sesión.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("mis_correos")
  if (error) throw new Error(error.message)
  const j = (data ?? {}) as { avisos?: string; resumen?: boolean }
  return { avisos: j.avisos === "inmediato" ? "inmediato" : "nunca", resumen: j.resumen !== false }
}

export async function cambiarMiResumenCorreo(recibe: boolean): Promise<void> {
  const uid = await obtenerUsuarioId()
  if (!uid) throw new Error("Inicia sesión.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("fijar_correo_resumen", { p_usuario_id: uid, p_recibe: recibe })
  if (error) throw new Error(error.message)
}

export async function cambiarResumenCorreo(usuarioId: string, recibe: boolean): Promise<void> {
  await requerirAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc("fijar_correo_resumen", { p_usuario_id: usuarioId, p_recibe: recibe })
  if (error) throw new Error(error.message)
}

export async function miPreferenciaCorreo(): Promise<PreferenciaCorreo> {
  if (!(await obtenerUsuarioId())) throw new Error("Inicia sesión.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("mi_correo_avisos")
  if (error) throw new Error(error.message)
  return data === "inmediato" ? "inmediato" : "nunca"
}

export async function cambiarMiPreferenciaCorreo(valor: PreferenciaCorreo): Promise<void> {
  const uid = await obtenerUsuarioId()
  if (!uid) throw new Error("Inicia sesión.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("fijar_correo_avisos", { p_usuario_id: uid, p_valor: valor })
  if (error) throw new Error(error.message)
}

export type EstadoCorreos = { activo: boolean; usuarios: Record<string, PreferenciaCorreo>; resumen: Record<string, boolean> }

export async function estadoCorreos(): Promise<EstadoCorreos> {
  await requerirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("estado_correos")
  if (error) throw new Error(error.message)
  const j = (data ?? {}) as { activo?: boolean; usuarios?: Record<string, string>; resumen?: Record<string, boolean> }
  const usuarios: Record<string, PreferenciaCorreo> = {}
  for (const [id, v] of Object.entries(j.usuarios ?? {})) usuarios[id] = v === "inmediato" ? "inmediato" : "nunca"
  return { activo: Boolean(j.activo), usuarios, resumen: j.resumen ?? {} }
}

export async function cambiarPreferenciaCorreo(usuarioId: string, valor: PreferenciaCorreo): Promise<void> {
  await requerirAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc("fijar_correo_avisos", { p_usuario_id: usuarioId, p_valor: valor })
  if (error) throw new Error(error.message)
}

export async function cambiarEnvioCorreos(activo: boolean): Promise<void> {
  await requerirAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc("fijar_envio_correos", { p_activo: activo })
  if (error) throw new Error(error.message)
}
