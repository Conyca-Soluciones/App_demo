"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { COMODIN_LISTAR, limiteBusqueda, puedeBuscar } from "@/lib/busqueda"
import { CAMPOS_PAGO, CAMPOS_PAGO_TERCERO_INNER, mapPago } from "@/lib/pagos-db"
import { documentoFormateado, soloDigitos } from "@/lib/terceros"
import type { FiltrosConsolidado, Pago } from "@/lib/pagos"

const PESTANA = "ayf.consolidado"

export type ConsolidadoOpcion = { id: string; nombre: string }

export async function listarConsolidadosPago(): Promise<ConsolidadoOpcion[]> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const { data, error } = await supabase.from("consolidados").select("id, nombre").order("orden", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((c: any) => ({ id: c.id, nombre: c.nombre }))
}

// Una página (50) del consolidado de una semana. Todo se filtra en la base:
// el consolidado, el año y la semana usan el índice (consolidado, año, semana,
// estado); el nombre del tercero, un join !inner en la misma consulta.
export async function listarConsolidado(
  filtros: FiltrosConsolidado = {},
  pagina = 0
): Promise<{ pagos: Pago[]; hayMas: boolean }> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()

  const tercero = filtros.tercero?.trim()
  let query: any = supabase.from("pagos").select(tercero ? CAMPOS_PAGO_TERCERO_INNER : CAMPOS_PAGO)

  if (filtros.sinItem) {
    // Aprobados que no recibieron ITEM porque su empresa no tiene consolidado.
    query = query.is("item", null).eq("estado", "aprobado")
  } else {
    query = query.not("item", "is", null)
    if (filtros.anio !== undefined) query = query.eq("anio", filtros.anio)
    if (filtros.semana !== undefined) query = query.eq("semana", filtros.semana)
  }
  if (filtros.consolidadoId) query = query.eq("consolidado_id", filtros.consolidadoId)
  if (filtros.estado) query = query.eq("estado", filtros.estado)
  if (filtros.soloConNovedad) query = query.not("novedad", "is", null)
  if (tercero) query = query.ilike("tercero.razon_social", `%${tercero}%`)

  query = query
    .order("anio", { ascending: false, nullsFirst: false })
    .order("semana", { ascending: false, nullsFirst: false })
    .order("consolidado_id", { ascending: true })
    .order("item", { ascending: true })
    .order("id", { ascending: true })

  const { data, error } = await query.range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return { pagos: filas.map(mapPago), hayMas }
}

// Avisos de la pantalla: órdenes aprobadas cuyos pagos no se pudieron crear, y
// pagos aprobados que esperan su ITEM. Dos conteos baratos (índices parciales).
export type AlertasConsolidado = { fallos: number; sinItem: number }

export async function obtenerAlertasConsolidado(): Promise<AlertasConsolidado> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const [fallos, sinItem] = await Promise.all([
    supabase.from("pagos_fallos").select("id", { count: "exact", head: true }).is("resuelto_en", null),
    supabase.from("pagos").select("id", { count: "exact", head: true }).eq("estado", "aprobado").is("item", null),
  ])
  if (fallos.error) throw new Error(fallos.error.message)
  if (sinItem.error) throw new Error(sinItem.error.message)
  return { fallos: fallos.count ?? 0, sinItem: sinItem.count ?? 0 }
}

export async function reintentarPagos(): Promise<{ fallosResueltos: number; itemsAsignados: number }> {
  await requerirAccion("gestionar_pagos")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("reintentar_pagos")
  if (error) throw new Error(error.message)
  const fila = (Array.isArray(data) ? data[0] : data) as { fallos_resueltos?: number; items_asignados?: number } | null
  return { fallosResueltos: fila?.fallos_resueltos ?? 0, itemsAsignados: fila?.items_asignados ?? 0 }
}

// ---------------------------------------------------- resolver una novedad

export type TerceroOpcion = { id: string; nombre: string; documento: string }

export async function buscarTercerosParaPago(termino: string): Promise<TerceroOpcion[]> {
  await requerirAccion("gestionar_pagos")
  const t = termino.trim()
  if (!puedeBuscar(t)) return []

  const supabase = await createClient()
  let query: any = supabase
    .from("terceros")
    .select("id, tipo_documento, numero_documento, dv, razon_social")
    .order("razon_social", { ascending: true })
    .limit(limiteBusqueda(t))

  if (t !== COMODIN_LISTAR) {
    const digitos = soloDigitos(t)
    // Por documento (empieza por) si escribió solo números; si no, por nombre.
    query = digitos.length >= 2 && digitos === t.replace(/[\s.\-]/g, "")
      ? query.like("numero_documento", `${digitos}%`)
      : query.ilike("razon_social", `%${t}%`)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((x: any) => ({
    id: x.id,
    nombre: x.razon_social,
    documento: `${x.tipo_documento} ${documentoFormateado({
      tipoDocumento: x.tipo_documento,
      numeroDocumento: x.numero_documento,
      dv: x.dv,
    })}`,
  }))
}

export type CuentaOpcion = { id: string; texto: string; estado: "ACTIVO" | "PENDIENTE" }

// Cuentas con las que se le puede pagar a un tercero (sin las inactivas).
export async function cuentasDeTercero(terceroId: string): Promise<CuentaOpcion[]> {
  await requerirAccion("gestionar_pagos")
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("terceros_cuentas")
    .select("id, tipo_cuenta, numero_cuenta, estado, banco:bancos(nombre)")
    .eq("tercero_id", terceroId)
    .neq("estado", "INACTIVO")
    .order("estado", { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((c: any) => ({
    id: c.id,
    texto: `${c.banco?.nombre ?? ""} · ${c.tipo_cuenta === "AHORROS" ? "Ahorros" : "Corriente"} · ${c.numero_cuenta}`,
    estado: c.estado,
  }))
}

export async function asignarTerceroPago(pagoId: string, terceroId: string, cuentaId: string | null): Promise<Pago> {
  await requerirAccion("gestionar_pagos")
  const supabase = await createClient()
  const { error } = await supabase.rpc("asignar_tercero_pago", {
    p_pago_id: pagoId,
    p_tercero_id: terceroId,
    p_cuenta_id: cuentaId,
  })
  if (error) throw new Error(error.message)

  const { data, error: errorLeer } = await supabase.from("pagos").select(CAMPOS_PAGO).eq("id", pagoId).maybeSingle()
  if (errorLeer) throw new Error(errorLeer.message)
  if (!data) throw new Error("El pago no existe o no tienes acceso.")
  return mapPago(data)
}
