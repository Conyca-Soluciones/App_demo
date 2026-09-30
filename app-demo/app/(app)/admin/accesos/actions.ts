"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAdmin } from "@/lib/permisos"

// ---------------------------------------------------------------------------
// Usuarios y accesos (solo Administrador): rol general de cada usuario y a
// qué proyectos accede (uno, varios o todos). Las reglas de seguridad (nadie
// se quita su propio Administrador, siempre queda al menos uno) viven en las
// funciones SQL asignar_rol_usuario / establecer_proyectos_usuario.
// ---------------------------------------------------------------------------

export type UsuarioAcceso = {
  id: string
  nombre: string
  email: string | null
  username: string | null
  rolId: string | null
  todosLosProyectos: boolean
  proyectoIds: string[]
  // Con qué permisos seguía trabajando si NO tiene rol.
  banderasAnteriores: string[]
}

const ETIQUETAS_BANDERAS: Record<string, string> = {
  es_admin: "Admin",
  rol_compras: "Compras",
  admin_insumos: "Insumos",
  admin_proyectos: "Proyectos",
  admin_mano_obra: "Mano de obra",
  admin_usuarios: "Usuarios",
}

export async function listarUsuariosAcceso(): Promise<UsuarioAcceso[]> {
  await requerirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_usuarios_accesos")
  if (error) throw new Error(error.message)

  return ((data ?? []) as any[]).map((u) => ({
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    username: u.username,
    rolId: u.rol_id,
    todosLosProyectos: u.todos_los_proyectos,
    proyectoIds: u.proyecto_ids ?? [],
    banderasAnteriores: Object.entries(u.banderas_anteriores ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => ETIQUETAS_BANDERAS[k] ?? k),
  }))
}

// rolId null = dejar al usuario sin rol (vuelve a sus permisos anteriores).
export async function asignarRolUsuario(usuarioId: string, rolId: string | null) {
  await requerirAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc("asignar_rol_usuario", {
    p_usuario_id: usuarioId,
    p_rol_id: rolId,
  })
  if (error) throw new Error(error.message)
}

export async function establecerProyectosUsuario(
  usuarioId: string,
  todos: boolean,
  proyectoIds: string[]
) {
  await requerirAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc("establecer_proyectos_usuario", {
    p_usuario_id: usuarioId,
    p_todos: todos,
    p_proyectos: proyectoIds,
  })
  if (error) throw new Error(error.message)
}
