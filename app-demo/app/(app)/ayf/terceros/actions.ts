"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, requerirAccion, requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { COMODIN_LISTAR, puedeBuscar } from "@/lib/busqueda"
import {
  soloDigitos,
  validarContacto,
  validarCuenta,
  validarTercero,
  type ContactoTercero,
  type Banco,
  type CuentaPorVerificar,
  type CuentaTercero,
  type DatosCuenta,
  type DatosTercero,
  type FiltrosTerceros,
  type Tercero,
  type TerceroBasico,
} from "@/lib/terceros"
import { calcularDvNit } from "@/lib/contratistas"

const PESTANA = "ayf.terceros"

// Las cuentas van embebidas: son pocas por tercero y la página tiene como
// máximo 50 terceros, así que es UNA consulta sin importar cuántas cuentas haya.
const CAMPOS_CUENTA = `
  id, banco_id, tipo_cuenta, numero_cuenta, etiqueta, estado, verificada_en,
  verificada_por, observaciones, banco:bancos(nombre)
`
const CAMPOS_TERCERO = `
  id, tipo_documento, numero_documento, dv, razon_social, nombres, apellidos,
  primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
  correo, telefono, direccion, ciudad, observaciones, rut_nombre
`

function mapCuenta(c: any): CuentaTercero {
  return {
    id: c.id,
    bancoId: c.banco_id,
    bancoNombre: c.banco?.nombre ?? "",
    tipoCuenta: c.tipo_cuenta,
    numeroCuenta: c.numero_cuenta,
    etiqueta: c.etiqueta,
    estado: c.estado,
    verificadaEn: c.verificada_en,
    verificadaPor: c.verificada_por,
    observaciones: c.observaciones,
  }
}

function contactoDe(t: any): ContactoTercero {
  return { correo: t.correo ?? "", telefono: t.telefono ?? "", direccion: t.direccion ?? "", ciudad: t.ciudad ?? "" }
}

function mapTercero(t: any): Tercero {
  const cuentas = ((t.cuentas ?? []) as any[]).map(mapCuenta)
  // Orden estable y barato (pocas cuentas por tercero): pendientes primero.
  const peso = { PENDIENTE: 0, ACTIVO: 1, INACTIVO: 2 } as const
  cuentas.sort((a, b) => peso[a.estado] - peso[b.estado] || a.bancoNombre.localeCompare(b.bancoNombre))
  return {
    id: t.id,
    tipoDocumento: t.tipo_documento,
    numeroDocumento: t.numero_documento,
    dv: t.dv,
    razonSocial: t.razon_social,
    primerNombre: t.primer_nombre ?? null,
    segundoNombre: t.segundo_nombre ?? null,
    primerApellido: t.primer_apellido ?? null,
    segundoApellido: t.segundo_apellido ?? null,
    nombres: t.nombres,
    apellidos: t.apellidos,
    contacto: contactoDe(t),
    observaciones: t.observaciones,
    rutNombre: t.rut_nombre ?? null,
    cuentas,
  }
}

function mensajeError(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Ya existe un registro con esos datos (documento o cuenta repetida)."
  return error.message
}

// Abierta a cualquier usuario con sesión (la tabla bancos se lee sin
// restricción): la usa el formulario "Nuevo tercero" desde otras pantallas.
export async function listarBancos(): Promise<Banco[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("bancos")
    .select("id, nombre")
    .eq("activo", true)
    .order("nombre", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((b: any) => ({ id: b.id, nombre: b.nombre }))
}

// Una página de terceros (50). Ningún filtro es obligatorio. Los filtros de
// cuenta (banco, estado) se resuelven con un join !inner en la misma consulta
// -- no se traen ids para mandarlos en un IN (falla con mucho volumen).
export async function listarTerceros(
  filtros: FiltrosTerceros = {},
  pagina = 0
): Promise<{ terceros: Tercero[]; hayMas: boolean }> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()

  const nombre = filtros.nombre?.trim() ?? ""
  if (nombre && !puedeBuscar(nombre)) throw new Error("Escribe al menos 2 letras para buscar por nombre.")
  const documento = soloDigitos(filtros.documento ?? "")
  const filtraCuenta = Boolean(filtros.bancoId || filtros.estadoCuenta)

  // Dos formas del select (literales, para que el cliente infiera bien): con
  // el join !inner solo cuando se filtra por algo de la cuenta. El alias
  // `filtro` es aparte de `cuentas`, así la lista muestra TODAS las cuentas
  // del tercero aunque se haya filtrado por una.
  let query: any = filtraCuenta
    ? supabase
        .from("terceros")
        .select(`${CAMPOS_TERCERO}, cuentas:terceros_cuentas(${CAMPOS_CUENTA}), filtro:terceros_cuentas!inner(id)`)
    : supabase.from("terceros").select(`${CAMPOS_TERCERO}, cuentas:terceros_cuentas(${CAMPOS_CUENTA})`)

  query = query.order("razon_social", { ascending: true }).order("id", { ascending: true })

  if (documento) query = query.like("numero_documento", `${documento}%`)
  if (nombre && nombre !== COMODIN_LISTAR) query = query.ilike("razon_social", `%${nombre}%`)
  if (filtros.bancoId) query = query.eq("filtro.banco_id", filtros.bancoId)
  if (filtros.estadoCuenta) query = query.eq("filtro.estado", filtros.estadoCuenta)

  const { data, error } = await query.range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return { terceros: filas.map(mapTercero), hayMas }
}

export async function obtenerTercero(id: string): Promise<Tercero> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("terceros")
    .select(`${CAMPOS_TERCERO}, cuentas:terceros_cuentas(${CAMPOS_CUENTA})`)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("El tercero no existe o no tienes acceso.")
  return mapTercero(data)
}

const mapBasico = (t: any): TerceroBasico => ({
  id: String(t.id),
  razonSocial: String(t.razon_social),
  tipoDocumento: String(t.tipo_documento),
  numeroDocumento: String(t.numero_documento),
  dv: t.dv ?? null,
  contacto: contactoDe(t),
})

// Tercero con ese documento exacto (cédula o NIT; "901.097.443-4" vale), o null.
// Se busca por documento y no por nombre para no crear el mismo dos veces.
// Cualquier usuario con sesión (tercero_por_documento).
export async function buscarTerceroPorDocumento(documento: string): Promise<TerceroBasico | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("tercero_por_documento", { p_documento: documento })
  if (error) throw new Error(error.message)
  return data ? mapBasico(data) : null
}

// Crear un tercero lo puede cualquier usuario con sesión, desde A&F o desde su
// propia pantalla (Contratistas...); editarlo y verificar sus cuentas sigue
// siendo de A&F (20261221000000). crear_tercero crea el tercero y su cuenta
// (PENDIENTE) en una transacción y vuelve a validar todo.
type ArchivoSubido = { ruta: string; nombre: string; mime: string }

export async function crearTercero(
  crudo: DatosTercero,
  // null = "No tiene cuenta bancaria" (20270101001100): sin cuenta ni certificación.
  cuentaCruda: DatosCuenta | null,
  // Ya subidos a `terceros/nuevo/<uid>/`: la certificación de la cuenta
  // (20261231200000) y el RUT (20270101000300, siempre obligatorio).
  certificacion: ArchivoSubido | null,
  rut: ArchivoSubido
): Promise<TerceroBasico> {
  const r = validarTercero(crudo)
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa los datos del tercero.")
  const d = r.datos

  let cuenta = null
  if (cuentaCruda) {
    const rc = validarCuenta(cuentaCruda)
    if (!rc.ok) throw new Error(Object.values(rc.errores)[0] ?? "Revisa los datos de la cuenta.")
    cuenta = rc.datos
    if (!certificacion?.ruta) throw new Error("Adjunta la certificación bancaria.")
  }
  if (!rut?.ruta) throw new Error("Adjunta el RUT.")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("crear_tercero", {
    p_datos: {
      tipo_documento: d.tipoDocumento,
      numero_documento: d.numeroDocumento,
      dv: d.dv ?? "",
      razon_social: d.razonSocial,
      primer_nombre: d.primerNombre ?? "",
      segundo_nombre: d.segundoNombre ?? "",
      primer_apellido: d.primerApellido ?? "",
      segundo_apellido: d.segundoApellido ?? "",
      correo: d.contacto.correo,
      telefono: d.contacto.telefono,
      direccion: d.contacto.direccion,
      ciudad: d.contacto.ciudad,
      observaciones: d.observaciones ?? "",
      rut,
      sin_cuenta: cuenta === null,
    },
    p_cuenta: cuenta
      ? {
          banco_id: cuenta.bancoId,
          tipo_cuenta: cuenta.tipoCuenta,
          numero_cuenta: cuenta.numeroCuenta,
          etiqueta: cuenta.etiqueta ?? "",
          observaciones: cuenta.observaciones ?? "",
          certificacion,
        }
      : null,
  })
  if (error) throw new Error(error.message)
  return mapBasico(data)
}

// El documento (tipo, número y DV) no se edita: identifica al tercero en todos
// los pagos. Un error de digitación en el documento se corrige creando el
// tercero correcto.
// Financiera (editar_terceros) y el Administrador cambian TODO el tercero, también tipo,
// número y DV (decisión del usuario, 2026-11-24). Si cambia el documento (o el nombre o el
// contacto), sus proveedores y contratistas toman el dato nuevo y quedan en revisión
// (20270101006100). Un pago apunta al tercero: ve el documento nuevo.
export async function actualizarTercero(id: string, crudo: DatosTercero): Promise<Tercero> {
  await requerirAccion("editar_terceros")
  const supabase = await createClient()
  const { data: actual, error: errActual } = await supabase
    .from("terceros")
    .select("tipo_documento, numero_documento, dv")
    .eq("id", id)
    .maybeSingle()
  if (errActual) throw new Error(errActual.message)
  if (!actual) throw new Error("El tercero ya no existe.")

  const tipo = (crudo.tipoDocumento || actual.tipo_documento).trim().toUpperCase()
  const numero = soloDigitos(crudo.numeroDocumento || actual.numero_documento || "")
  const persona = tipo !== "NIT"
  const eraPersona = actual.tipo_documento !== "NIT"
  // El contacto es obligatorio salvo en un tercero viejo que aún no lo tiene (todo vacío).
  const sinContacto = !crudo.correo.trim() && !crudo.telefono.trim() && !crudo.direccion.trim() && !crudo.ciudad.trim()
  // Persona vieja sin casillas: se puede guardar sin llenarlas (conserva su nombre),
  // salvo que pase de NIT a persona (ahí el nombre hay que escribirlo).
  const sinCasillas = persona && eraPersona && !crudo.primerNombre.trim() && !crudo.primerApellido.trim()
  const r = validarTercero(
    {
      ...crudo,
      tipoDocumento: tipo,
      numeroDocumento: numero,
      // El DV del NIT se calcula: no se escribe a mano.
      dv: persona || !numero ? "" : String(calcularDvNit(numero)),
      razonSocial: crudo.razonSocial || "X",
      ...(sinCasillas ? { primerNombre: "X", primerApellido: "X" } : {}),
    },
    { contacto: !sinContacto }
  )
  if (!r.ok) {
    const primero = Object.values(r.errores)[0]
    throw new Error(primero ?? "Revisa los datos del tercero.")
  }
  const d = r.datos

  const cambio: Record<string, unknown> = { observaciones: crudo.observaciones.trim() || null }
  if (d.tipoDocumento !== actual.tipo_documento) cambio.tipo_documento = d.tipoDocumento
  if (d.numeroDocumento !== actual.numero_documento) cambio.numero_documento = d.numeroDocumento
  if ((d.dv ?? null) !== (actual.dv ?? null)) cambio.dv = d.dv
  if (persona && !sinCasillas) {
    // La base arma la razón social, los nombres y el nombre para el banco.
    cambio.primer_nombre = d.primerNombre
    cambio.segundo_nombre = d.segundoNombre
    cambio.primer_apellido = d.primerApellido
    cambio.segundo_apellido = d.segundoApellido
  } else if (!persona) {
    cambio.razon_social = d.razonSocial
    if (eraPersona) {
      // Pasa a NIT: las casillas de persona ya no aplican.
      cambio.primer_nombre = null
      cambio.segundo_nombre = null
      cambio.primer_apellido = null
      cambio.segundo_apellido = null
    }
  }
  if (!sinContacto) {
    cambio.correo = d.contacto.correo
    cambio.telefono = d.contacto.telefono
    cambio.direccion = d.contacto.direccion
    cambio.ciudad = d.contacto.ciudad
  }

  const { data, error } = await supabase.from("terceros").update(cambio).eq("id", id).select("id")
  if (error) {
    if (error.code === "23505") {
      const { data: otro } = await supabase
        .from("terceros")
        .select("razon_social")
        .eq("numero_documento", d.numeroDocumento)
        .neq("id", id)
        .limit(1)
        .maybeSingle()
      throw new Error(`Ya existe otro tercero con el documento ${d.numeroDocumento}${otro ? `: ${otro.razon_social}` : ""}.`)
    }
    throw new Error(mensajeError(error))
  }
  if (!data || data.length === 0) throw new Error("No se pudo actualizar el tercero (¿tienes permiso?).")
  return await obtenerTercero(id)
}

// Eliminar un tercero (20270101006200): Financiera y el Administrador, solo si no se usa en
// nada; si se usa, la base dice dónde. Queda en la Auditoría.
export async function eliminarTercero(id: string): Promise<void> {
  await requerirAccion("editar_terceros")
  const supabase = await createClient()
  const { error } = await supabase.rpc("eliminar_tercero", { p_id: id })
  if (error) throw new Error(error.message)
}

// Correo, teléfono, dirección y ciudad del tercero desde Contratistas o Proveedores
// (20270101004300): se guardan en el tercero y la base los copia a su contratista y
// su proveedor. A&F, Compras (editar_proveedores) o quien gestiona contratistas.
export async function actualizarContactoTercero(terceroId: string, contacto: Partial<ContactoTercero>): Promise<ContactoTercero> {
  const permisos = await obtenerPermisosRol()
  const puede =
    permisos?.esAdministrador ||
    ["editar_terceros", "editar_proveedores", "gestionar_contratistas"].some((a) => permisos?.acciones.includes(a))
  if (!puede) throw new Error("No tienes permiso para cambiar el contacto del tercero.")
  // Solo los datos que llegan (uno o varios); los demás se rellenan para validar.
  const claves = (Object.keys(contacto) as (keyof ContactoTercero)[]).filter((k) => contacto[k] !== undefined)
  if (claves.length === 0) throw new Error("No hay datos de contacto para guardar.")
  const v = validarContacto({ correo: "a@b.co", telefono: "1234567", direccion: "x", ciudad: "x", ...contacto })
  if (!v.ok) throw new Error(Object.values(v.errores)[0] ?? "Revisa el contacto.")
  const envio = Object.fromEntries(claves.map((k) => [k, v.datos[k]]))
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("actualizar_contacto_tercero", { p_tercero_id: terceroId, p_contacto: envio })
  if (error) throw new Error(error.message)
  const c = (data ?? {}) as Partial<ContactoTercero>
  return { correo: c.correo ?? "", telefono: c.telefono ?? "", direccion: c.direccion ?? "", ciudad: c.ciudad ?? "" }
}

export async function agregarCuenta(terceroId: string, cruda: DatosCuenta): Promise<Tercero> {
  await requerirAccion("editar_terceros")
  const r = validarCuenta(cruda)
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa los datos de la cuenta.")
  const d = r.datos

  const supabase = await createClient()
  const { error } = await supabase.from("terceros_cuentas").insert({
    tercero_id: terceroId,
    banco_id: d.bancoId,
    tipo_cuenta: d.tipoCuenta,
    numero_cuenta: d.numeroCuenta,
    etiqueta: d.etiqueta,
    observaciones: d.observaciones,
  })
  if (error) {
    if (error.code === "23505") throw new Error("Este tercero ya tiene esa cuenta en ese banco.")
    throw new Error(error.message)
  }
  return await obtenerTercero(terceroId)
}

// Si la cuenta estaba verificada y cambia el banco, el tipo o el número, la
// base la devuelve a PENDIENTE, salvo que la cambie quien puede verificar (se
// queda ACTIVA, verificada por él). En los dos casos, los pagos en curso con esa
// cuenta quedan marcados con una novedad y el cambio en su historial
// (20261206000000; se limpia al confirmar la cuenta del pago).
export async function actualizarCuenta(
  terceroId: string,
  cuentaId: string,
  cruda: DatosCuenta
): Promise<Tercero> {
  await requerirAccion("editar_terceros")
  const r = validarCuenta(cruda)
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa los datos de la cuenta.")
  const d = r.datos

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("terceros_cuentas")
    .update({
      banco_id: d.bancoId,
      tipo_cuenta: d.tipoCuenta,
      numero_cuenta: d.numeroCuenta,
      etiqueta: d.etiqueta,
      observaciones: d.observaciones,
    })
    .eq("id", cuentaId)
    .eq("tercero_id", terceroId)
    .select("id")
  if (error) {
    if (error.code === "23505") throw new Error("Este tercero ya tiene esa cuenta en ese banco.")
    throw new Error(error.message)
  }
  // RLS no da error al bloquear un UPDATE: simplemente no toca filas.
  if (!data || data.length === 0) throw new Error("No se pudo actualizar la cuenta (¿tienes permiso?).")
  return await obtenerTercero(terceroId)
}

// PENDIENTE -> ACTIVO. Solo quien tiene `verificar_terceros`; la base guarda
// quién y cuándo (no se puede escribir a mano).
export async function verificarCuenta(terceroId: string, cuentaId: string): Promise<Tercero> {
  await requerirAccion("verificar_terceros")
  return await cambiarEstado(terceroId, cuentaId, "ACTIVO")
}

// Certificación bancaria del contratista con el documento de este tercero, para
// verificar la cuenta con el documento a la vista. Solo quien tiene
// `verificar_terceros` (lo revisa también la base y la política del bucket).
// Devuelve un enlace firmado de 2 minutos que descarga el archivo, o null si
// el tercero no viene de un contratista con certificación.
export async function enlaceCertificacionTercero(
  terceroId: string
): Promise<{ url: string; nombreArchivo: string; contratista: string; subidoAt: string } | null> {
  await requerirAccion("verificar_terceros")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("certificacion_bancaria_tercero", { p_tercero_id: terceroId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const doc = data as { ruta: string; nombre_archivo: string; contratista: string; subido_at: string }
  const { data: firmado, error: errorUrl } = await supabase.storage
    .from("contratistas")
    .createSignedUrl(doc.ruta, 120, { download: doc.nombre_archivo })
  if (errorUrl || !firmado) throw new Error(errorUrl?.message ?? "No se pudo abrir la certificación.")
  return { url: firmado.signedUrl, nombreArchivo: doc.nombre_archivo, contratista: doc.contratista, subidoAt: doc.subido_at }
}

// Inactivar una cuenta, o reactivarla (vuelve a PENDIENTE: hay que verificarla).
export async function inactivarCuenta(terceroId: string, cuentaId: string): Promise<Tercero> {
  await requerirAccion("editar_terceros")
  return await cambiarEstado(terceroId, cuentaId, "INACTIVO")
}

export async function reactivarCuenta(terceroId: string, cuentaId: string): Promise<Tercero> {
  await requerirAccion("editar_terceros")
  return await cambiarEstado(terceroId, cuentaId, "PENDIENTE")
}

async function cambiarEstado(
  terceroId: string,
  cuentaId: string,
  estado: "ACTIVO" | "PENDIENTE" | "INACTIVO"
): Promise<Tercero> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("terceros_cuentas")
    .update({ estado })
    .eq("id", cuentaId)
    .eq("tercero_id", terceroId)
    .select("id")
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error("No se pudo cambiar el estado de la cuenta (¿tienes permiso?).")
  return await obtenerTercero(terceroId)
}

// ------------------------------------------------- cuentas por verificar

// Todas las cuentas PENDIENTES (pocas: se verifican a diario), las que tienen
// pagos esperando primero. 20261231200000.
export async function listarCuentasPorVerificar(): Promise<CuentaPorVerificar[]> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("cuentas_por_verificar")
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((f) => ({
    cuentaId: f.cuenta_id,
    terceroId: f.tercero_id,
    razonSocial: f.razon_social,
    tipoDocumento: f.tipo_documento,
    numeroDocumento: f.numero_documento,
    dv: f.dv ?? null,
    banco: f.banco ?? "",
    tipoCuenta: f.tipo_cuenta,
    numeroCuenta: f.numero_cuenta,
    etiqueta: f.etiqueta ?? null,
    observaciones: f.observaciones ?? null,
    creadoEn: f.creado_en ?? null,
    creadoPor: f.creado_por ?? null,
    certificacion: f.certificacion ?? null,
    pagos: Number(f.pagos ?? 0),
  }))
}

// Enlace firmado de 2 minutos para VER la certificación (sin descarga), o null.
export async function urlCertificacionCuenta(cuentaId: string): Promise<{ url: string; nombre: string; mime: string } | null> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("url_certificacion_cuenta", { p_cuenta_id: cuentaId })
  if (error) throw new Error(error.message)
  if (!data) return null
  const d = data as { bucket: string; ruta: string; nombre: string; mime: string }
  const { data: firmado, error: e } = await supabase.storage.from(d.bucket).createSignedUrl(d.ruta, 120)
  if (e || !firmado) throw new Error(e?.message ?? "No se pudo abrir la certificación.")
  return { url: firmado.signedUrl, nombre: d.nombre, mime: d.mime }
}

// Registra la certificación que el navegador ya subió al bucket `terceros`.
export async function guardarCertificacionCuenta(cuentaId: string, ruta: string, nombre: string, mime: string): Promise<void> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const { error } = await supabase.rpc("guardar_certificacion_cuenta", {
    p_cuenta_id: cuentaId,
    p_ruta: ruta,
    p_nombre: nombre,
    p_mime: mime,
  })
  if (error) throw new Error(error.message)
}

// Verificar varias a la vez (la base guarda quién y cuándo; solo las PENDIENTES).
export async function verificarCuentas(ids: string[]): Promise<number> {
  await requerirAccion("verificar_terceros")
  if (ids.length === 0) return 0
  const supabase = await createClient()
  let n = 0
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("terceros_cuentas")
      .update({ estado: "ACTIVO" })
      .in("id", ids.slice(i, i + 100))
      .eq("estado", "PENDIENTE")
      .select("id")
    if (error) throw new Error(error.message)
    n += data?.length ?? 0
  }
  return n
}
