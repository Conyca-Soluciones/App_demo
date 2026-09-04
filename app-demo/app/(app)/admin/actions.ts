"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requerirAdmin } from "@/lib/permisos"

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

export type Proyecto = {
  id: string
  codigo: string | null
  nombre: string
  cliente: string | null
}

export async function listarProyectosAdmin(): Promise<Proyecto[]> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proyectos")
    .select("id, codigo, nombre, cliente")
    .order("codigo", { ascending: false, nullsFirst: false })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export type CrearProyectoInput = {
  codigo?: string | null
  nombre: string
  cliente?: string | null
}

export async function crearProyecto(input: CrearProyectoInput): Promise<Proyecto> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proyectos")
    .insert({
      codigo: input.codigo?.trim() || null,
      nombre: input.nombre,
      cliente: input.cliente?.trim() || null,
    })
    .select("id, codigo, nombre, cliente")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export type EditarProyectoInput = {
  codigo?: string | null
  nombre?: string
  cliente?: string | null
}

export async function editarProyecto(proyectoId: string, cambios: EditarProyectoInput) {
  await requerirAdmin()
  const supabase = await createClient()

  const patch: Record<string, string | null> = {}
  if (cambios.codigo !== undefined) patch.codigo = cambios.codigo?.trim() || null
  if (cambios.nombre !== undefined) patch.nombre = cambios.nombre
  if (cambios.cliente !== undefined) patch.cliente = cambios.cliente?.trim() || null

  const { error } = await supabase.from("proyectos").update(patch).eq("id", proyectoId)

  if (error) {
    throw new Error(error.message)
  }
}

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------

export type Grupo = {
  id: string
  nombre: string
  veTodosProyectos: boolean
  puedeEditarTodos: boolean
}

export async function listarGrupos(): Promise<Grupo[]> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("grupos")
    .select("id, nombre, ve_todos_proyectos, puede_editar_todos")
    .order("nombre")

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((g) => ({
    id: g.id,
    nombre: g.nombre,
    veTodosProyectos: g.ve_todos_proyectos,
    puedeEditarTodos: g.puede_editar_todos,
  }))
}

export async function crearGrupo(nombre: string): Promise<Grupo> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("grupos")
    .insert({ nombre })
    .select("id, nombre, ve_todos_proyectos, puede_editar_todos")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return {
    id: data.id,
    nombre: data.nombre,
    veTodosProyectos: data.ve_todos_proyectos,
    puedeEditarTodos: data.puede_editar_todos,
  }
}

export async function actualizarGrupo(
  grupoId: string,
  cambios: { veTodosProyectos?: boolean; puedeEditarTodos?: boolean }
) {
  await requerirAdmin()
  const supabase = await createClient()

  const patch: Record<string, boolean> = {}
  if (cambios.veTodosProyectos !== undefined) patch.ve_todos_proyectos = cambios.veTodosProyectos
  if (cambios.puedeEditarTodos !== undefined) patch.puede_editar_todos = cambios.puedeEditarTodos

  const { error } = await supabase.from("grupos").update(patch).eq("id", grupoId)

  if (error) {
    throw new Error(error.message)
  }
}

// ---------------------------------------------------------------------------
// Asignaciones de proyecto -- grupo o usuario.
//
// ANTES: listarProyectosParaGrupo/Usuario traían la lista COMPLETA de
// proyectos (con nombre) cada vez, mezclada con las asignaciones -- cada
// clic para abrir un grupo o una persona distinta repetía esa traída
// completa, aunque la lista de proyectos en sí casi nunca cambia entre
// un clic y el siguiente.
//
// AHORA: estas funciones solo devuelven la asignación (proyecto_id +
// puede_editar), sin el nombre -- mucho más liviano. El nombre se saca
// del lado del cliente, cruzando con la lista de proyectos que
// AdminPage ya cargó una sola vez al entrar al panel (mismo patrón que
// ya usamos con listarGrupos). El "merge" (combinarConProyectos) vive en
// page.tsx.
// ---------------------------------------------------------------------------

export type AsignacionProyecto = {
  proyectoId: string
  puedeEditar: boolean
}

export async function listarAsignacionesDeGrupo(grupoId: string): Promise<AsignacionProyecto[]> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("grupo_proyectos")
    .select("proyecto_id, puede_editar")
    .eq("grupo_id", grupoId)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((a) => ({ proyectoId: a.proyecto_id, puedeEditar: a.puede_editar }))
}

export async function actualizarProyectoDeGrupo(
  grupoId: string,
  proyectoId: string,
  asignado: boolean,
  puedeEditar: boolean
) {
  await requerirAdmin()
  const supabase = await createClient()

  if (!asignado) {
    const { error } = await supabase
      .from("grupo_proyectos")
      .delete()
      .eq("grupo_id", grupoId)
      .eq("proyecto_id", proyectoId)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await supabase
    .from("grupo_proyectos")
    .upsert({ grupo_id: grupoId, proyecto_id: proyectoId, puede_editar: puedeEditar })

  if (error) {
    throw new Error(error.message)
  }
}

export async function listarAsignacionesDeUsuario(usuarioId: string): Promise<AsignacionProyecto[]> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("usuario_proyectos")
    .select("proyecto_id, puede_editar")
    .eq("usuario_id", usuarioId)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((a) => ({ proyectoId: a.proyecto_id, puedeEditar: a.puede_editar }))
}

export async function actualizarProyectoDeUsuario(
  usuarioId: string,
  proyectoId: string,
  asignado: boolean,
  puedeEditar: boolean
) {
  await requerirAdmin()
  const supabase = await createClient()

  if (!asignado) {
    const { error } = await supabase
      .from("usuario_proyectos")
      .delete()
      .eq("usuario_id", usuarioId)
      .eq("proyecto_id", proyectoId)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await supabase
    .from("usuario_proyectos")
    .upsert({ usuario_id: usuarioId, proyecto_id: proyectoId, puede_editar: puedeEditar })

  if (error) {
    throw new Error(error.message)
  }
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

export type UsuarioConGrupos = {
  id: string
  nombre: string
  email: string
  esAdmin: boolean
  grupoIds: string[]
}

// admin.auth.admin.listUsers() SIN parámetros trae solo 50 usuarios
// (página 1) -- con 50 o menos cuentas no se nota nada, pero en cuanto
// la organización pase de 50, los usuarios de ahí en adelante quedaban
// con el email en blanco en el panel (el perfil sí aparecía, el cruce
// con su email no). Esto recorre todas las páginas hasta agotarlas.
async function listarTodosLosAuthUsers(admin: ReturnType<typeof createAdminClient>) {
  const todos: { id: string; email?: string | null }[] = []
  let page = 1
  const perPage = 200

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) {
      throw new Error(error.message)
    }
    todos.push(...data.users)
    if (data.users.length < perPage) break
    page += 1
  }

  return todos
}

export async function listarUsuarios(): Promise<UsuarioConGrupos[]> {
  await requerirAdmin()
  const supabase = await createClient()
  const admin = createAdminClient()

  const [
    { data: perfiles, error: errorPerfiles },
    { data: gruposDe, error: errorGrupos },
    authUsers,
  ] = await Promise.all([
    supabase.from("perfiles").select("id, nombre, es_admin"),
    supabase.from("usuario_grupos").select("usuario_id, grupo_id"),
    listarTodosLosAuthUsers(admin),
  ])

  if (errorPerfiles) throw new Error(errorPerfiles.message)
  if (errorGrupos) throw new Error(errorGrupos.message)

  const emailPorId = new Map(authUsers.map((u) => [u.id, u.email ?? ""]))
  const gruposPorUsuario = new Map<string, string[]>()
  for (const g of gruposDe ?? []) {
    const lista = gruposPorUsuario.get(g.usuario_id) ?? []
    lista.push(g.grupo_id)
    gruposPorUsuario.set(g.usuario_id, lista)
  }

  return (perfiles ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    email: emailPorId.get(p.id) ?? "",
    esAdmin: p.es_admin,
    grupoIds: gruposPorUsuario.get(p.id) ?? [],
  }))
}

export type CrearUsuarioInput = {
  nombre: string
  email: string
  password: string
  esAdmin: boolean
  grupoIds: string[]
}

export async function crearUsuario(input: CrearUsuarioInput): Promise<{ id: string }> {
  await requerirAdmin()
  const admin = createAdminClient()
  const supabase = await createClient()

  const { data: creado, error: errorCreacion } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true, // el admin ya "verificó" a la persona en persona
  })

  if (errorCreacion) {
    throw new Error(errorCreacion.message)
  }

  const usuarioId = creado.user.id

  const { error: errorPerfil } = await supabase.from("perfiles").insert({
    id: usuarioId,
    nombre: input.nombre,
    es_admin: input.esAdmin,
  })

  if (errorPerfil) {
    // no dejar un usuario de auth huérfano sin perfil si esto falla
    await admin.auth.admin.deleteUser(usuarioId)
    throw new Error(errorPerfil.message)
  }

  if (input.grupoIds.length > 0) {
    const { error: errorGrupos } = await supabase
      .from("usuario_grupos")
      .insert(input.grupoIds.map((grupoId) => ({ usuario_id: usuarioId, grupo_id: grupoId })))

    if (errorGrupos) {
      throw new Error(errorGrupos.message)
    }
  }

  return { id: usuarioId }
}

export async function actualizarGruposDeUsuario(usuarioId: string, grupoIds: string[]) {
  await requerirAdmin()
  const supabase = await createClient()

  const { error: errorBorrar } = await supabase
    .from("usuario_grupos")
    .delete()
    .eq("usuario_id", usuarioId)

  if (errorBorrar) {
    throw new Error(errorBorrar.message)
  }

  if (grupoIds.length > 0) {
    const { error: errorInsertar } = await supabase
      .from("usuario_grupos")
      .insert(grupoIds.map((grupoId) => ({ usuario_id: usuarioId, grupo_id: grupoId })))

    if (errorInsertar) {
      throw new Error(errorInsertar.message)
    }
  }
}

// Cambia la contraseña de un usuario ya existente -- para el caso de
// "esta cuenta ahora la va a usar otra persona" (o alguien perdió la
// suya). Usa el cliente admin (service role) porque cambiar la
// contraseña de OTRA persona no es algo que la propia cuenta pueda
// hacer sobre sí misma vía el flujo normal -- necesita el mismo
// privilegio elevado que crearUsuario.
export async function cambiarPasswordUsuario(usuarioId: string, nuevaPassword: string) {
  await requerirAdmin()

  if (nuevaPassword.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.")
  }

  const admin = createAdminClient()

  const { error } = await admin.auth.admin.updateUserById(usuarioId, {
    password: nuevaPassword,
  })

  if (error) {
    throw new Error(error.message)
  }
}
