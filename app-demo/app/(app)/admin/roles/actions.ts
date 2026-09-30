"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAdmin } from "@/lib/permisos"
import { ACCIONES, PESTANAS, permisoAccion, permisoPestana } from "@/lib/pestanas"

// ---------------------------------------------------------------------------
// Roles y permisos (solo Administrador). La matriz guarda en rol_permisos
// 'tab.<clave>' / 'accion.<clave>'; las claves válidas salen de
// lib/pestanas.ts. El rol Administrador siempre tiene todo y no se edita.
// Las funciones SQL vuelven a validar que quien llama sea Administrador.
// ---------------------------------------------------------------------------

export type RolConPermisos = {
  id: string
  clave: string
  nombre: string
  esSistema: boolean
  permisos: string[]
  usuarios: number
}

export async function listarRolesConPermisos(): Promise<RolConPermisos[]> {
  await requerirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_roles_con_permisos")
  if (error) throw new Error(error.message)

  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    clave: r.clave,
    nombre: r.nombre,
    esSistema: r.es_sistema,
    permisos: r.permisos ?? [],
    usuarios: Number(r.usuarios),
  }))
}

const PERMISOS_VALIDOS = new Set([
  ...PESTANAS.map((p) => permisoPestana(p.clave)),
  ...ACCIONES.map((a) => permisoAccion(a.clave)),
])

export async function establecerPermisoRol(rolId: string, permiso: string, activo: boolean) {
  await requerirAdmin()
  if (!PERMISOS_VALIDOS.has(permiso)) throw new Error("Permiso desconocido.")

  const supabase = await createClient()
  const { error } = await supabase.rpc("establecer_permiso_rol", {
    p_rol_id: rolId,
    p_permiso: permiso,
    p_activo: activo,
  })
  if (error) throw new Error(error.message)
}

export async function crearRol(nombre: string): Promise<string> {
  await requerirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("crear_rol", { p_nombre: nombre })
  if (error) throw new Error(error.message)
  return data as string
}

export async function eliminarRol(rolId: string) {
  await requerirAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc("eliminar_rol", { p_rol_id: rolId })
  if (error) throw new Error(error.message)
}
