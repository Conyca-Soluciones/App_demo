"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { COMODIN_LISTAR, puedeBuscar } from "@/lib/busqueda"
import {
  soloDigitos,
  validarCuenta,
  validarTercero,
  type Banco,
  type CuentaTercero,
  type DatosCuenta,
  type DatosTercero,
  type FiltrosTerceros,
  type Tercero,
} from "@/lib/terceros"

const PESTANA = "ayf.terceros"

// Las cuentas van embebidas: son pocas por tercero y la página tiene como
// máximo 50 terceros, así que es UNA consulta sin importar cuántas cuentas haya.
const CAMPOS_CUENTA = `
  id, banco_id, tipo_cuenta, numero_cuenta, etiqueta, estado, verificada_en,
  verificada_por, observaciones, banco:bancos(nombre)
`
const CAMPOS_TERCERO = `
  id, tipo_documento, numero_documento, dv, razon_social, nombre_banco, nombres,
  apellidos, observaciones
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
    nombreBanco: t.nombre_banco,
    nombres: t.nombres,
    apellidos: t.apellidos,
    observaciones: t.observaciones,
    cuentas,
  }
}

function mensajeError(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Ya existe un registro con esos datos (documento o cuenta repetida)."
  return error.message
}

export async function listarBancos(): Promise<Banco[]> {
  await requerirPestana(PESTANA)
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

export async function crearTercero(
  crudo: DatosTercero,
  cuentaCruda: DatosCuenta | null
): Promise<Tercero> {
  await requerirAccion("editar_terceros")

  const r = validarTercero(crudo)
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa los datos del tercero.")
  const d = r.datos

  let cuenta = null
  if (cuentaCruda) {
    const rc = validarCuenta(cuentaCruda)
    if (!rc.ok) throw new Error(Object.values(rc.errores)[0] ?? "Revisa los datos de la cuenta.")
    cuenta = rc.datos
  }

  const supabase = await createClient()
  const { data: nuevo, error } = await supabase
    .from("terceros")
    .insert({
      tipo_documento: d.tipoDocumento,
      numero_documento: d.numeroDocumento,
      dv: d.dv,
      razon_social: d.razonSocial,
      nombre_banco: d.nombreBanco,
      nombres: d.nombres,
      apellidos: d.apellidos,
      observaciones: d.observaciones,
    })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23505") throw new Error(`Ya existe un tercero con el documento ${d.numeroDocumento}.`)
    throw new Error(error.message)
  }

  if (cuenta) {
    const { error: errorCuenta } = await supabase.from("terceros_cuentas").insert({
      tercero_id: nuevo.id,
      banco_id: cuenta.bancoId,
      tipo_cuenta: cuenta.tipoCuenta,
      numero_cuenta: cuenta.numeroCuenta,
      etiqueta: cuenta.etiqueta,
      observaciones: cuenta.observaciones,
    })
    if (errorCuenta) {
      throw new Error(
        `El tercero se creó, pero la cuenta no se pudo guardar: ${mensajeError(errorCuenta)} ` +
          `Ábrelo y agrégala de nuevo.`
      )
    }
  }
  return await obtenerTercero(nuevo.id)
}

// El documento (tipo, número y DV) no se edita: identifica al tercero en todos
// los pagos. Un error de digitación en el documento se corrige creando el
// tercero correcto.
export async function actualizarTercero(
  id: string,
  crudo: Pick<DatosTercero, "razonSocial" | "nombreBanco" | "nombres" | "apellidos" | "observaciones">
): Promise<Tercero> {
  await requerirAccion("editar_terceros")

  // Se valida con un documento de relleno válido: solo importan los campos de texto.
  const r = validarTercero({ ...crudo, tipoDocumento: "CC", numeroDocumento: "1", dv: "" })
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa los datos del tercero.")
  const d = r.datos

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("terceros")
    .update({
      razon_social: d.razonSocial,
      nombre_banco: d.nombreBanco,
      nombres: d.nombres,
      apellidos: d.apellidos,
      observaciones: d.observaciones,
    })
    .eq("id", id)
    .select("id")
  if (error) throw new Error(mensajeError(error))
  if (!data || data.length === 0) throw new Error("No se pudo actualizar el tercero (¿tienes permiso?).")
  return await obtenerTercero(id)
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
// base la devuelve a PENDIENTE (trigger): hay que verificarla otra vez.
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
