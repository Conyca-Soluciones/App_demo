"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requerirAdmin } from "@/lib/permisos"
import { emparejarEmpresa, type FilaProyectoSoloPagos, type ResultadoImportacionProyecto } from "@/lib/proyectos-solo-pagos"
import {
  mapEmpresasRepresentantes,
  representanteEnBlanco,
  soloDigitos,
  validarRepresentantesEmpresa,
  type DatosRepresentante,
  type EmpresaConRepresentantes,
} from "@/lib/representantes"

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
  logoUrl: string | null
  // Encabezado de las órdenes de compra (20270101000000).
  correo: string | null
  ciudad: string | null
  // A&F: consolidado de pagos al que pertenece (null = sin asignar todavía).
  consolidadoId: string | null
}

export type Consolidado = { id: string; nombre: string }

// Los 3 consolidados de pagos (A&F). Solo para elegir a cuál va cada empresa.
export async function listarConsolidados(): Promise<Consolidado[]> {
  await requerirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("consolidados")
    .select("id, nombre")
    .order("orden", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((c) => ({ id: c.id, nombre: c.nombre }))
}

// null deja la empresa sin consolidado.
export async function asignarConsolidadoEmpresa(empresaId: string, consolidadoId: string | null) {
  await requerirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("empresas")
    .update({ consolidado_id: consolidadoId })
    .eq("id", empresaId)
    .select("id")
  if (error) throw new Error(mensajeErrorEmpresa(error, "asignar el consolidado"))
  if (!data || data.length === 0) throw new Error("No se pudo asignar el consolidado.")
}

export async function listarEmpresas(): Promise<Empresa[]> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("empresas")
    .select("id, nit, razon_social, logo_url, correo, ciudad, consolidado_id")
    .order("razon_social")

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((e) => ({
    id: e.id,
    nit: e.nit,
    razonSocial: e.razon_social,
    logoUrl: e.logo_url,
    correo: e.correo ?? null,
    ciudad: e.ciudad ?? null,
    consolidadoId: e.consolidado_id,
  }))
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

// Tope del data URL del logo (el cliente ya lo reduce a 256 px; esto es solo
// una red de seguridad contra llamadas directas a la action).
const MAX_LOGO_CHARS = 400_000

function validarLogo(logoUrl: string | null | undefined) {
  if (!logoUrl) return null
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(logoUrl)) {
    throw new Error("El logo debe ser una imagen PNG, JPG o WebP.")
  }
  if (logoUrl.length > MAX_LOGO_CHARS) throw new Error("La imagen del logo es demasiado grande.")
  return logoUrl
}

export async function crearEmpresa(input: {
  nit: string
  razonSocial: string
  logoUrl?: string | null
}): Promise<Empresa> {
  await requerirAdmin()
  const nit = input.nit.trim()
  const razonSocial = input.razonSocial.trim()
  if (!nit) throw new Error("El NIT es obligatorio.")
  if (!razonSocial) throw new Error("La razón social es obligatoria.")
  const logoUrl = validarLogo(input.logoUrl)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("empresas")
    .insert({ nit, razon_social: razonSocial, logo_url: logoUrl })
    .select("id, nit, razon_social, logo_url, correo, ciudad, consolidado_id")
    .single()

  if (error) throw new Error(mensajeErrorEmpresa(error, "crear la empresa"))
  return {
    id: data.id,
    nit: data.nit,
    razonSocial: data.razon_social,
    logoUrl: data.logo_url,
    correo: data.correo ?? null,
    ciudad: data.ciudad ?? null,
    consolidadoId: data.consolidado_id,
  }
}

// null quita el logo.
export async function actualizarLogoEmpresa(empresaId: string, logoUrl: string | null) {
  await requerirAdmin()
  const logo = validarLogo(logoUrl)
  const supabase = await createClient()
  const { error } = await supabase.from("empresas").update({ logo_url: logo }).eq("id", empresaId)
  if (error) throw new Error(mensajeErrorEmpresa(error, "actualizar el logo"))
}

export async function editarEmpresa(
  empresaId: string,
  cambios: { nit: string; razonSocial: string; correo: string; ciudad: string }
) {
  await requerirAdmin()
  const nit = cambios.nit.trim()
  const razonSocial = cambios.razonSocial.trim()
  const correo = cambios.correo.trim() || null
  const ciudad = cambios.ciudad.trim() || null
  if (!nit) throw new Error("El NIT es obligatorio.")
  if (!razonSocial) throw new Error("La razón social es obligatoria.")
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error("El correo no es válido.")

  const supabase = await createClient()
  const { error } = await supabase
    .from("empresas")
    .update({ nit, razon_social: razonSocial, correo, ciudad })
    .eq("id", empresaId)

  if (error) throw new Error(mensajeErrorEmpresa(error, "editar la empresa"))
}

// Eliminar una empresa (20270101001000): la base revisa que nada la use
// (proyectos, pagos, OC, pagos administrativos, saldos a favor, cuentas a
// debitar usadas) y dice qué tiene; si no, borra también sus cuentas a debitar.
export async function eliminarEmpresa(empresaId: string) {
  await requerirAdmin()
  const supabase = await createClient()
  const { error } = await supabase.rpc("eliminar_empresa", { p_empresa_id: empresaId })
  if (error) throw new Error(error.message)
}


// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

export type Proyecto = {
  id: string
  // Número de 3 dígitos (001): va en los códigos OC-001-0001, CJ-001-0001 y
  // REF 001-00001 (20261230000000).
  numero: number
  codigo: string | null
  nombre: string
  ciudad: string | null
  empresaId: string | null
  empresaNombre: string | null
  empresaNit: string | null
  // Proyecto que solo existe para pagos (de Google, 20270101001300): no sale en AdPro.
  soloPagos: boolean
}

export async function listarProyectosAdmin(): Promise<Proyecto[]> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proyectos")
    .select("id, numero, codigo, nombre, ciudad, empresa_id, solo_pagos, empresa:empresas(nit, razon_social)")
    .order("numero", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((p: any) => ({
    id: p.id,
    numero: Number(p.numero),
    codigo: p.codigo,
    nombre: p.nombre,
    ciudad: p.ciudad,
    empresaId: p.empresa_id,
    empresaNombre: p.empresa?.razon_social ?? null,
    empresaNit: p.empresa?.nit ?? null,
    soloPagos: Boolean(p.solo_pagos),
  }))
}

export type CrearProyectoInput = {
  numero?: number | null // vacío = el siguiente libre; 0 = 000 (Funcionamiento)
  codigo?: string | null
  nombre: string
  ciudad?: string | null
  empresaId?: string | null
  soloPagos?: boolean
}

export async function crearProyecto(input: CrearProyectoInput): Promise<Proyecto> {
  await requerirAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("proyectos")
    .insert({
      ...(input.numero != null ? { numero: input.numero } : {}),
      codigo: input.codigo?.trim() || null,
      nombre: input.nombre,
      ciudad: input.ciudad?.trim() || null,
      empresa_id: input.empresaId || null,
      solo_pagos: Boolean(input.soloPagos),
    })
    .select("id, numero, codigo, nombre, ciudad, empresa_id, solo_pagos, empresa:empresas(nit, razon_social)")
    .single()

  if (error) {
    throw new Error(error.message)
  }

  const p = data as any
  return {
    id: p.id,
    numero: Number(p.numero),
    codigo: p.codigo,
    nombre: p.nombre,
    ciudad: p.ciudad,
    empresaId: p.empresa_id,
    empresaNombre: p.empresa?.razon_social ?? null,
    empresaNit: p.empresa?.nit ?? null,
    soloPagos: Boolean(p.solo_pagos),
  }
}

export type EditarProyectoInput = {
  numero?: number
  codigo?: string | null
  nombre?: string
  ciudad?: string | null
  empresaId?: string | null
  soloPagos?: boolean
}

export async function editarProyecto(proyectoId: string, cambios: EditarProyectoInput) {
  await requerirAdmin()
  const supabase = await createClient()

  const patch: Record<string, string | number | boolean | null> = {}
  if (cambios.soloPagos !== undefined) patch.solo_pagos = cambios.soloPagos
  if (cambios.numero !== undefined) patch.numero = cambios.numero
  if (cambios.codigo !== undefined) patch.codigo = cambios.codigo?.trim() || null
  if (cambios.nombre !== undefined) patch.nombre = cambios.nombre
  if (cambios.ciudad !== undefined) patch.ciudad = cambios.ciudad?.trim() || null
  if (cambios.empresaId !== undefined) patch.empresa_id = cambios.empresaId || null

  const { error } = await supabase.from("proyectos").update(patch).eq("id", proyectoId)

  if (error) {
    throw new Error(error.message)
  }
}

// Importar proyectos "solo pagos" desde Excel (20270101001300): se crean con el
// número siguiente libre; el que ya existe (mismo código) se salta. Fila por fila,
// para reportar cada una.
export async function importarProyectosSoloPagos(filas: FilaProyectoSoloPagos[]): Promise<ResultadoImportacionProyecto[]> {
  await requerirAdmin()
  if (filas.length > 300) throw new Error("Como mucho 300 proyectos por Excel.")
  const supabase = await createClient()
  const [{ data: empresas, error: e1 }, { data: existentes, error: e2 }] = await Promise.all([
    supabase.from("empresas").select("id, nit, razon_social"),
    supabase.from("proyectos").select("codigo"),
  ])
  if (e1) throw new Error(e1.message)
  if (e2) throw new Error(e2.message)
  const listaEmpresas = ((empresas ?? []) as any[]).map((e) => ({ id: e.id as string, nit: (e.nit ?? null) as string | null, razonSocial: String(e.razon_social ?? "") }))
  const codigos = new Set(((existentes ?? []) as any[]).map((p) => String(p.codigo ?? "").trim().toUpperCase()).filter(Boolean))

  const resultados: ResultadoImportacionProyecto[] = []
  for (const f of filas) {
    const codigo = f.codigo.trim()
    if (!codigo) {
      resultados.push({ fila: f.fila, codigo, resultado: "error", mensaje: "Falta el código." })
      continue
    }
    if (codigos.has(codigo.toUpperCase())) {
      resultados.push({ fila: f.fila, codigo, resultado: "ya_existe" })
      continue
    }
    const empresa = emparejarEmpresa(f.empresa, listaEmpresas)
    if (!empresa) {
      resultados.push({ fila: f.fila, codigo, resultado: "error", mensaje: `No se encontró la empresa "${f.empresa}" (escribe su razón social o NIT como está en Empresas).` })
      continue
    }
    const { error } = await supabase
      .from("proyectos")
      .insert({ codigo, nombre: (f.nombre || codigo).trim(), empresa_id: empresa.id, solo_pagos: true })
    if (error) {
      resultados.push({ fila: f.fila, codigo, resultado: "error", mensaje: error.message })
      continue
    }
    codigos.add(codigo.toUpperCase())
    resultados.push({ fila: f.fila, codigo, resultado: "creado" })
  }
  return resultados
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

  // perfiles.username es NOT NULL y UNIQUE en la base: se llena con la parte
  // del correo antes de la @ (como los perfiles que ya existen) y, si ya la
  // usa otro, se le agrega un número.
  const baseUsername = email.split("@")[0].toLowerCase()
  const { data: parecidos } = await admin
    .from("perfiles")
    .select("username")
    .like("username", `${baseUsername}%`)
  const usados = new Set((parecidos ?? []).map((p: { username: string }) => p.username))
  let username = baseUsername
  for (let n = 2; usados.has(username); n++) username = `${baseUsername}${n}`

  const { error: errorPerfil } = await supabase
    .from("perfiles")
    .insert({ id: usuarioId, nombre, email, username })

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
// ---------------------------------------------------------------------------
// Representantes legales de las empresas (20261201000000): el principal y el
// suplente se registran aquí con su firma (guardarFirmaRepresentante, en
// contratos/representantes/actions.ts; Gerencia también la adjunta desde
// Aprobación de contratos).
// ---------------------------------------------------------------------------

export async function listarRepresentantesEmpresas(): Promise<EmpresaConRepresentantes[]> {
  await requerirAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_representantes_legales")
  if (error) throw new Error(error.message)
  return mapEmpresasRepresentantes(data)
}

// Vacío (sin nombre ni documento) = la empresa queda sin él.
export async function guardarRepresentantesEmpresa(
  empresaId: string,
  principal: DatosRepresentante,
  suplente: DatosRepresentante
): Promise<void> {
  await requerirAdmin()
  const problema = validarRepresentantesEmpresa(principal, suplente)
  if (problema) throw new Error(problema)
  const aBase = (d: DatosRepresentante) =>
    representanteEnBlanco(d)
      ? null
      : { nombre: d.nombre.trim(), tipo_documento: d.tipoDocumento, numero_documento: soloDigitos(d.numeroDocumento), expedida_en: d.expedidaEn.trim() }
  const supabase = await createClient()
  const { error } = await supabase.rpc("guardar_representantes_empresa", {
    p_empresa_id: empresaId,
    p_principal: aBase(principal),
    p_suplente: aBase(suplente),
  })
  if (error) throw new Error(error.message)
}
