"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requerirAdmin } from "@/lib/permisos"

// ---------------------------------------------------------------------------
// Empresas -- consorcios/razones sociales bajo las cuales CONYCA ejecuta
// proyectos. Cada proyecto se enlaza a una (empresa_id), y el PDF de OC saca
// de ahí el nombre y NIT que antes venían del texto libre proyectos.cliente.
// Solo se expone nit+razonSocial acá -- banco/cuenta/representante existen
// en la tabla (referencia interna) pero no hace falta traerlos para elegir
// la empresa de un proyecto ni para el PDF.
// ---------------------------------------------------------------------------

export type Empresa = {
  id: string
  nit: string
  razonSocial: string
}

export async function listarEmpresas(): Promise<Empresa[]> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("empresas")
    .select("id, nit, razon_social")
    .order("razon_social")

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((e) => ({ id: e.id, nit: e.nit, razonSocial: e.razon_social }))
}

// Mensaje legible para los errores típicos de la base (NIT repetido, filas
// que dependen de la empresa...).
function mensajeErrorEmpresa(error: { code?: string; message: string }, accion: string): string {
  if (error.code === "23505") return "Ya existe una empresa con ese NIT."
  if (error.code === "23503") {
    return `No se puede ${accion}: la empresa tiene datos asociados (proyectos o cuentas bancarias).`
  }
  return error.message
}

export async function crearEmpresa(input: { nit: string; razonSocial: string }): Promise<Empresa> {
  await requerirAdmin()
  const nit = input.nit.trim()
  const razonSocial = input.razonSocial.trim()
  if (!nit) throw new Error("El NIT es obligatorio.")
  if (!razonSocial) throw new Error("La razón social es obligatoria.")

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("empresas")
    .insert({ nit, razon_social: razonSocial })
    .select("id, nit, razon_social")
    .single()

  if (error) throw new Error(mensajeErrorEmpresa(error, "crear la empresa"))
  return { id: data.id, nit: data.nit, razonSocial: data.razon_social }
}

export async function editarEmpresa(
  empresaId: string,
  cambios: { nit: string; razonSocial: string }
) {
  await requerirAdmin()
  const nit = cambios.nit.trim()
  const razonSocial = cambios.razonSocial.trim()
  if (!nit) throw new Error("El NIT es obligatorio.")
  if (!razonSocial) throw new Error("La razón social es obligatoria.")

  const supabase = await createClient()
  const { error } = await supabase
    .from("empresas")
    .update({ nit, razon_social: razonSocial })
    .eq("id", empresaId)

  if (error) throw new Error(mensajeErrorEmpresa(error, "editar la empresa"))
}

// No se elimina una empresa que todavía tiene proyectos: primero hay que
// cambiarles la empresa (un proyecto sin empresa deja vacío el encabezado de
// sus órdenes de compra).
export async function eliminarEmpresa(empresaId: string) {
  await requerirAdmin()
  const supabase = await createClient()

  const { count, error: errorConteo } = await supabase
    .from("proyectos")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
  if (errorConteo) throw new Error(errorConteo.message)

  if ((count ?? 0) > 0) {
    throw new Error(
      `No se puede eliminar: ${count} ${count === 1 ? "proyecto usa" : "proyectos usan"} esta empresa. ` +
        "Cámbiales la empresa primero."
    )
  }

  const { error } = await supabase.from("empresas").delete().eq("id", empresaId)
  if (error) throw new Error(mensajeErrorEmpresa(error, "eliminar la empresa"))
}


// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

export type Proyecto = {
  id: string
  codigo: string | null
  nombre: string
  ciudad: string | null
  empresaId: string | null
  empresaNombre: string | null
  empresaNit: string | null
}

export async function listarProyectosAdmin(): Promise<Proyecto[]> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proyectos")
    .select("id, codigo, nombre, ciudad, empresa_id, empresa:empresas(nit, razon_social)")
    .order("codigo", { ascending: false, nullsFirst: false })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((p: any) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    ciudad: p.ciudad,
    empresaId: p.empresa_id,
    empresaNombre: p.empresa?.razon_social ?? null,
    empresaNit: p.empresa?.nit ?? null,
  }))
}

export type CrearProyectoInput = {
  codigo?: string | null
  nombre: string
  ciudad?: string | null
  empresaId?: string | null
}

export async function crearProyecto(input: CrearProyectoInput): Promise<Proyecto> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proyectos")
    .insert({
      codigo: input.codigo?.trim() || null,
      nombre: input.nombre,
      ciudad: input.ciudad?.trim() || null,
      empresa_id: input.empresaId || null,
    })
    .select("id, codigo, nombre, ciudad, empresa_id, empresa:empresas(nit, razon_social)")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  const p = data as any
  return {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    ciudad: p.ciudad,
    empresaId: p.empresa_id,
    empresaNombre: p.empresa?.razon_social ?? null,
    empresaNit: p.empresa?.nit ?? null,
  }
}

export type EditarProyectoInput = {
  codigo?: string | null
  nombre?: string
  ciudad?: string | null
  empresaId?: string | null
}

export async function editarProyecto(proyectoId: string, cambios: EditarProyectoInput) {
  await requerirAdmin()
  const supabase = await createClient()

  const patch: Record<string, string | null> = {}
  if (cambios.codigo !== undefined) patch.codigo = cambios.codigo?.trim() || null
  if (cambios.nombre !== undefined) patch.nombre = cambios.nombre
  if (cambios.ciudad !== undefined) patch.ciudad = cambios.ciudad?.trim() || null
  if (cambios.empresaId !== undefined) patch.empresa_id = cambios.empresaId || null

  const { error } = await supabase.from("proyectos").update(patch).eq("id", proyectoId)

  if (error) {
    throw new Error(error.message)
  }
}

// ---------------------------------------------------------------------------
// Usuarios -- crear la cuenta y cambiar contraseñas. El rol y los proyectos se
// asignan en "Usuarios y accesos" (accesos/actions.ts). Sigue sin haber
// auto-registro: el Administrador crea la cuenta y le entrega las credenciales.
// ---------------------------------------------------------------------------

export type CrearUsuarioInput = {
  nombre: string
  email: string
  password: string
  // Rol general con el que queda el usuario (null = sin rol: mientras tanto
  // no ve nada de lo que requiere rol; ver Roles y permisos).
  rolId?: string | null
}

export async function crearUsuario(input: CrearUsuarioInput): Promise<{ id: string }> {
  await requerirAdmin()

  const nombre = input.nombre.trim()
  const email = input.email.trim()
  if (!nombre || !email) throw new Error("Nombre y correo son obligatorios.")
  if (input.password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.")

  const admin = createAdminClient()
  const supabase = await createClient()

  const { data: creado, error: errorCreacion } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true, // el admin ya "verificó" a la persona en persona
  })

  if (errorCreacion) {
    throw new Error(errorCreacion.message)
  }

  const usuarioId = creado.user.id

  const { error: errorPerfil } = await supabase
    .from("perfiles")
    .insert({ id: usuarioId, nombre, email })

  if (errorPerfil) {
    // no dejar un usuario de auth huérfano sin perfil si esto falla
    await admin.auth.admin.deleteUser(usuarioId)
    throw new Error(errorPerfil.message)
  }

  if (input.rolId) {
    const { error: errorRol } = await supabase.rpc("asignar_rol_usuario", {
      p_usuario_id: usuarioId,
      p_rol_id: input.rolId,
    })
    if (errorRol) {
      throw new Error(
        `La cuenta se creó, pero no se pudo asignar el rol: ${errorRol.message}. Asígnalo desde la lista.`
      )
    }
  }

  return { id: usuarioId }
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