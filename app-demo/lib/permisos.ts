import { createClient } from "@/lib/supabase/server"
import { headers } from "next/headers"

// ---------------------------------------------------------------------------
// Permisos efectivos de un usuario sobre los proyectos = unión de todo lo
// que le dan sus grupos + lo que se le asignó a él directamente. Si
// CUALQUIERA de esas fuentes dice "puede editar" un proyecto, puede
// editarlo (no hace falta que todas coincidan). Un admin, o alguien en un
// grupo con ve_todos_proyectos=true (ej. Gerencia), ve cualquier
// proyecto que exista -- viejo o nuevo -- sin necesidad de tenerlo
// listado en ningún lado.
// ---------------------------------------------------------------------------
// lib/permisos.ts -- reemplaza obtenerPermisosUsuario() completa.
// La versión "no testing" comentada se puede borrar; esta es la que
// queda como definitiva.

export type PermisosUsuario = {
  esAdmin: boolean
  veTodosProyectos: boolean
  puedeEditarTodos: boolean
  proyectos: Map<string, boolean> // proyecto_id -> puede_editar
}

// Llama a la funcion en supabase que trae los permisos del usuario
export async function obtenerPermisosUsuario(
  usuarioId: string
): Promise<PermisosUsuario> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("obtener_permisos_usuario", {
    p_usuario_id: usuarioId,
  })

  if (error) {
    throw new Error(error.message)
  }


  const proyectos = new Map<string, boolean>(
    Object.entries((data?.proyectos ?? {}) as Record<string, boolean>)
  )

  return {
    esAdmin: Boolean(data?.esAdmin),
    veTodosProyectos: Boolean(data?.veTodosProyectos),
    puedeEditarTodos: Boolean(data?.puedeEditarTodos),
    proyectos,
  }
}
//   return { esAdmin: false, veTodosProyectos: false, puedeEditarTodos: false, proyectos }
// }

// Lanza un error si quien está autenticado ahora mismo no es admin --
// para usar al inicio de cada acción del panel de admin.

// Antes: SIEMPRE llamaba auth.getUser() + SELECT perfiles.es_admin,
// aunque el middleware YA hubiera hecho exactamente esa verificación
// unos milisegundos antes, en la misma petición HTTP (toda ruta bajo
// /admin pasa primero por el middleware, que ya confirma es_admin=true
// antes de dejar pasar la request -- ver middleware.ts). Ahora lee esa
// verificación ya hecha desde los headers x-user-id / x-es-admin que el
// middleware inyecta -- solo vuelve a golpear Supabase si por algún
// motivo esos headers no vinieran (ej. la función se invoca en un
// contexto que no pasó por este middleware, como un test o una llamada
// directa fuera de Next.js).
export async function requerirAdmin() {
  const headersList = await headers()
  const userIdDesdeMiddleware = headersList.get("x-user-id")
  const esAdminDesdeMiddleware = headersList.get("x-es-admin")
 
  if (userIdDesdeMiddleware && esAdminDesdeMiddleware === "true") {
    return { id: userIdDesdeMiddleware } as { id: string }
  }
 
  // Fallback: el middleware no confirmó nada (o esta llamada no pasó
  // por él) -- se verifica desde cero, como antes.
  const supabase = await createClient()
 
  const {
    data: { user },
  } = await supabase.auth.getUser()
 
  if (!user) {
    throw new Error("No autenticado.")
  }
 
  const { data: perfil, error } = await supabase
    .from("perfiles")
    .select("es_admin")
    .eq("id", user.id)
    .single()
 
  if (error || !perfil?.es_admin) {
    throw new Error("Esta acción requiere permisos de administrador.")
  }
 
  return user
}
 

// ---------------------------------------------------------------------------
// AGREGAR esto al final de lib/permisos.ts -- no reemplaza nada de lo que
// ya existe (obtenerPermisosUsuario y requerirAdmin quedan intactos,
// requerirAdmin sigue siendo "puede todo" para /admin en general).
// ---------------------------------------------------------------------------

// Scopes de admin granulares -- cada uno da acceso a UN área nada más.
// es_admin=true en perfiles sigue dando todos los scopes automáticamente
// (ver columnas admin_insumos/admin_proyectos/admin_usuarios en
// perfiles, y las funciones SQL equivalentes admin_insumos(uuid) etc.
// que ya validan es_admin OR el flag puntual -- esto solo replica esa
// misma regla del lado de TS, para las Server Actions).
export type ScopeAdmin = "admin_insumos" | "admin_proyectos" | "admin_usuarios" | "admin_mano_obra"

// Lanza un error si quien está autenticado ahora mismo no tiene el scope
// pedido (ni tampoco es_admin general) -- para usar al inicio de cada
// acción de un panel de admin específico (ej. /admin-insumos).



 
export async function requerirScope(scope: ScopeAdmin) {
  const headersList = await headers()
  const userIdDesdeMiddleware = headersList.get("x-user-id")
  const tieneScopeDesdeMiddleware =
    headersList.get(`x-scope-${scope}`) === "true" || headersList.get("x-es-admin") === "true"
 
  if (userIdDesdeMiddleware && tieneScopeDesdeMiddleware) {
    return { id: userIdDesdeMiddleware } as { id: string }
  }
 
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
 
  if (!user) {
    throw new Error("No autenticado.")
  }
 
  // select FIJO (mismo motivo que en middleware.ts): un .select() con
  // template string dinámico (`es_admin, ${scope}`) rompe la inferencia
  // de tipos de Supabase con un ParserError -- se piden siempre las 4
  // columnas y se elige cuál mirar en JS, no en la query.
  const { data: perfil, error } = await supabase
    .from("perfiles")
    .select("es_admin, admin_insumos, admin_proyectos, admin_usuarios")
    .eq("id", user.id)
    .single()
 
  if (error || !perfil) {
    throw new Error("Esta acción requiere permisos de administrador.")
  }
 
  const tienePermiso = perfil.es_admin || perfil[scope]
 
  if (!tienePermiso) {
    throw new Error("No tienes permiso para esta acción.")
  }
 
  return user
}
 