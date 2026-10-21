"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAdmin } from "@/lib/permisos"

// ---------------------------------------------------------------------------
// Bancos (solo Administrador): la lista que usan Contratistas y Terceros. Las
// reglas (nombre en mayúsculas y único, código de 3 números, al renombrar se
// actualizan los contratistas) viven en guardar_banco
// (20261118700000_contratistas_a_terceros.sql).
// ---------------------------------------------------------------------------

export type BancoAdmin = {
  id: string
  nombre: string
  codigo: string | null
  activo: boolean
  cuentas: number // cuentas de terceros con este banco
  contratistas: number
}

export async function listarBancosAdmin(): Promise<BancoAdmin[]> {
  await requerirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_bancos_admin")
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((b) => ({
    id: String(b.id),
    nombre: String(b.nombre),
    codigo: (b.codigo as string | null) ?? null,
    activo: Boolean(b.activo),
    cuentas: Number(b.cuentas ?? 0),
    contratistas: Number(b.contratistas ?? 0),
  }))
}

// id null = banco nuevo.
export async function guardarBanco(datos: {
  id: string | null
  nombre: string
  codigo: string
  activo: boolean
}): Promise<void> {
  await requerirAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc("guardar_banco", {
    p_id: datos.id,
    p_nombre: datos.nombre,
    p_codigo: datos.codigo,
    p_activo: datos.activo,
  })
  if (error) throw new Error(error.message)
}
