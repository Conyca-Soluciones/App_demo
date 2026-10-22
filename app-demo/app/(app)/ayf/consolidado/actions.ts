"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { COMODIN_LISTAR, limiteBusqueda, puedeBuscar } from "@/lib/busqueda"
import { CAMPOS_PAGO, CAMPOS_PAGO_TERCERO_INNER, mapPago } from "@/lib/pagos-db"
import { documentoFormateado, soloDigitos } from "@/lib/terceros"
import { PESTANA_CONSOLIDADO, esClaveConsolidado, type FiltrosConsolidado, type Pago } from "@/lib/pagos"

// Cada consolidado es su propia pestaña (ayf.consolidado_<clave>). La base
// también lo exige: solo devuelve los pagos de los consolidados que se ven.
async function idConsolidado(clave: string): Promise<string> {
  if (!esClaveConsolidado(clave)) throw new Error("Consolidado no válido.")
  await requerirPestana(PESTANA_CONSOLIDADO(clave))
  const supabase = await createClient()
  const { data, error } = await supabase.from("consolidados").select("id").eq("clave", clave).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("El consolidado no existe o no tienes acceso.")
  return (data as any).id
}

// Años o semanas elegidos: enteros en el rango, sin repetir (como mucho 53).
function enteros(lista: number[] | undefined, min: number, max: number, nombre: string): number[] {
  const unicos = [...new Set(lista ?? [])]
  if (unicos.length > 53 || unicos.some((n) => !Number.isInteger(n) || n < min || n > max)) {
    throw new Error(`El filtro tiene ${nombre}.`)
  }
  return unicos
}

// Una página (50) del consolidado de las semanas elegidas. Todo se filtra en la base:
// el consolidado, el año y la semana usan el índice (consolidado, año, semana,
// estado); el nombre del tercero, un join !inner en la misma consulta.
export async function listarConsolidado(
  clave: string,
  filtros: FiltrosConsolidado = {},
  pagina = 0
): Promise<{ pagos: Pago[]; hayMas: boolean }> {
  const consolidadoId = await idConsolidado(clave)
  const supabase = await createClient()

  const tercero = filtros.tercero?.trim()
  let query: any = supabase.from("pagos").select(tercero ? CAMPOS_PAGO_TERCERO_INNER : CAMPOS_PAGO)

  query = query.eq("consolidado_id", consolidadoId).not("item", "is", null)
  const anios = enteros(filtros.anios, 2020, 2100, "un año no válido")
  const semanas = enteros(filtros.semanas, 1, 53, "una semana no válida")
  if (anios.length > 0) query = query.in("anio", anios)
  if (semanas.length > 0) query = query.in("semana", semanas)
  if (filtros.estado) query = query.eq("estado", filtros.estado)
  if (filtros.soloConNovedad) query = query.not("novedad", "is", null)
  if (tercero) query = query.ilike("tercero.razon_social", `%${tercero}%`)

  query = query
    .order("anio", { ascending: false, nullsFirst: false })
    .order("semana", { ascending: false, nullsFirst: false })
    .order("item", { ascending: true })
    .order("id", { ascending: true })

  const { data, error } = await query.range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  return { pagos: filas.map(mapPago), hayMas }
}

// Aviso de la pantalla: órdenes aprobadas cuyos pagos no se pudieron crear (la
// base solo cuenta las de las empresas de los consolidados que se ven). Los
// pagos sin ITEM (empresa sin consolidado) no son de ningún consolidado: los
// ve Aprobación de pagos.
export type AlertasConsolidado = { fallos: number }

export async function obtenerAlertasConsolidado(clave: string): Promise<AlertasConsolidado> {
  await idConsolidado(clave)
  const supabase = await createClient()
  const { count, error } = await supabase.from("pagos_fallos").select("id", { count: "exact", head: true }).is("resuelto_en", null)
  if (error) throw new Error(error.message)
  return { fallos: count ?? 0 }
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
