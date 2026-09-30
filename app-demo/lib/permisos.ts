import { createClient } from "@/lib/supabase/server"
import { headers } from "next/headers"
import { permisosDesdeBanderas, type PermisosRol } from "@/lib/pestanas"

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

// ---------------------------------------------------------------------------
// Permisos del usuario actual (rol, pestañas, acciones).
//
// El middleware calcula esto UNA vez por request (RPC permisos_rol_usuario) y
// lo deja en el header x-permisos del request que sigue hacia el handler; acá
// se lee sin volver a golpear Supabase. SEGURIDAD: el middleware borra
// SIEMPRE estos headers si vienen del cliente antes de escribir los suyos --
// antes se copiaban tal cual y solo se sobrescribían en algunas rutas, así que
// un usuario con sesión podía mandar "x-es-admin: true" a una Server Action y
// pasar requerirAdmin (que además usa la llave de servicio).
//
// Si el header no está (llamada que no pasó por el middleware) se consulta la
// base. Si la migración de roles todavía no se corrió (la función no existe),
// se cae a las banderas anteriores de perfiles: nada se rompe al desplegar el
// código antes que el SQL.
// ---------------------------------------------------------------------------

async function permisosDesdePerfil(userId: string): Promise<PermisosRol> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("perfiles")
    .select("es_admin, admin_insumos, admin_proyectos, admin_mano_obra, rol_compras")
    .eq("id", userId)
    .single()

  return permisosDesdeBanderas(data)
}

export async function obtenerUsuarioId(): Promise<string | null> {
  const desdeMiddleware = (await headers()).get("x-user-id")
  if (desdeMiddleware) return desdeMiddleware

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function obtenerPermisosRol(): Promise<PermisosRol | null> {
  const headersList = await headers()
  const crudo = headersList.get("x-permisos")
  if (crudo) {
    try {
      return JSON.parse(decodeURIComponent(crudo)) as PermisosRol
    } catch {
      // header corrupto: se recalcula abajo
    }
  }

  const userId = await obtenerUsuarioId()
  if (!userId) return null

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("permisos_rol_usuario", { p_usuario_id: userId })
  if (error || !data) {
    return await permisosDesdePerfil(userId)
  }
  return data as PermisosRol
}

// Lanza un error si quien está autenticado ahora mismo no es Administrador --
// para usar al inicio de cada acción del panel de admin.
export async function requerirAdmin() {
  const permisos = await obtenerPermisosRol()
  const userId = permisos ? await obtenerUsuarioId() : null

  if (!permisos || !userId) {
    throw new Error("No autenticado.")
  }
  if (!permisos.esAdministrador) {
    throw new Error("Esta acción requiere permisos de administrador.")
  }
  return { id: userId }
}

// Exige una ACCIÓN del rol (ver ACCIONES en lib/pestanas.ts). El
// Administrador puede todo. La base vuelve a validar la acción por dentro
// (tiene_accion) en las funciones y políticas que la usan.
export async function requerirAccion(accion: string) {
  const permisos = await obtenerPermisosRol()
  const userId = permisos ? await obtenerUsuarioId() : null

  if (!permisos || !userId) {
    throw new Error("No autenticado.")
  }
  if (!permisos.esAdministrador && !permisos.acciones.includes(accion)) {
    throw new Error("No tienes permiso para esta acción.")
  }
  return { id: userId }
}

// Exige tener una PESTAÑA (para acciones que no son de una acción concreta,
// ej. la visualización de proyectos). Un usuario sin rol solo pasa si es
// Administrador.
export async function requerirPestana(clave: string) {
  const permisos = await obtenerPermisosRol()
  const userId = permisos ? await obtenerUsuarioId() : null

  if (!permisos || !userId) {
    throw new Error("No autenticado.")
  }
  if (!permisos.esAdministrador && (permisos.sinRol || !permisos.pestanas.includes(clave))) {
    throw new Error("No tienes permiso para esta acción.")
  }
  return { id: userId }
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
// Scopes anteriores -> acción equivalente. Se conservan para las llamadas
// existentes a requerirScope("..."); el código nuevo usa requerirAccion.
export type ScopeAdmin = "admin_insumos" | "admin_proyectos" | "admin_usuarios" | "admin_mano_obra" | "rol_compras"

const ACCION_DE_SCOPE: Record<Exclude<ScopeAdmin, "admin_usuarios">, string> = {
  admin_insumos: "aprobar_insumos",
  admin_proyectos: "aprobar_pedidos",
  admin_mano_obra: "aprobar_mano_obra",
  rol_compras: "comprar",
}

export async function requerirScope(scope: ScopeAdmin) {
  if (scope === "admin_usuarios") return await requerirAdmin()
  return await requerirAccion(ACCION_DE_SCOPE[scope])
}
