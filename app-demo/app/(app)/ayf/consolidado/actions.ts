"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { COMODIN_LISTAR, limiteBusqueda, puedeBuscar } from "@/lib/busqueda"
import { CAMPOS_PAGO, CAMPOS_PAGO_TERCERO_INNER, mapPago } from "@/lib/pagos-db"
import { documentoFormateado, soloDigitos } from "@/lib/terceros"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { buscarSoportesDePagos } from "@/lib/soportes-pagos-db"
import {
  PESTANA_CONSOLIDADO,
  esClaveConsolidado,
  type ComentarioPago,
  type ConteoEtapas,
  type FilaLiquidacion,
  type FiltrosConsolidado,
  type Pago,
  type ResultadoLiquidacion,
  type SoportePago,
  type TipoComentarioPago,
} from "@/lib/pagos"

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

// La consulta del consolidado con los filtros (sin paginar): la usan la lista,
// el Excel de liquidación y "Enviar a liquidar los filtrados". Todo se filtra
// en la base: el consolidado, el año, la semana y la etapa usan los índices;
// el nombre del tercero, un join !inner en la misma consulta.
function consultaConsolidado(supabase: any, consolidadoId: string, filtros: FiltrosConsolidado, campos?: string) {
  const tercero = filtros.tercero?.trim()
  let query: any = supabase.from("pagos").select(campos ?? (tercero ? CAMPOS_PAGO_TERCERO_INNER : CAMPOS_PAGO))

  query = query.eq("consolidado_id", consolidadoId).not("item", "is", null)
  const anios = enteros(filtros.anios, 2020, 2100, "un año no válido")
  const semanas = enteros(filtros.semanas, 1, 53, "una semana no válida")
  if (anios.length > 0) query = query.in("anio", anios)
  if (semanas.length > 0) query = query.in("semana", semanas)
  if (filtros.estado) query = query.eq("estado", filtros.estado)
  if (filtros.soloConNovedad) query = query.not("novedad", "is", null)
  if (tercero) query = query.ilike("tercero.razon_social", `%${tercero}%`)
  // Las etapas son de los pagos aprobados (los anulados o en dispersión, en "Todos").
  if (filtros.etapa === "preparacion") query = query.eq("estado", "aprobado").is("liquidacion_estado", null)
  else if (filtros.etapa && filtros.etapa !== "todos") query = query.eq("estado", "aprobado").eq("liquidacion_estado", filtros.etapa)

  return query
    .order("anio", { ascending: false, nullsFirst: false })
    .order("semana", { ascending: false, nullsFirst: false })
    .order("item", { ascending: true })
    .order("id", { ascending: true })
}

// Una página (50) del consolidado, con el soporte de cada pago.
export async function listarConsolidado(
  clave: string,
  filtros: FiltrosConsolidado = {},
  pagina = 0
): Promise<{ pagos: Pago[]; hayMas: boolean; soportes: Record<string, SoportePago> }> {
  const consolidadoId = await idConsolidado(clave)
  const supabase = await createClient()
  const { data, error } = await consultaConsolidado(supabase, consolidadoId, filtros).range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina((data ?? []) as any[])
  const pagos = filas.map(mapPago)
  const soportes = await buscarSoportesDePagos(supabase, pagos)
  return { pagos, hayMas, soportes }
}

// Cuántos pagos hay en cada pestaña con los años y semanas elegidos.
export async function conteoEtapasConsolidado(clave: string, filtros: FiltrosConsolidado = {}): Promise<ConteoEtapas> {
  const consolidadoId = await idConsolidado(clave)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("conteo_etapas_consolidado", {
    p_consolidado_id: consolidadoId,
    p_anios: enteros(filtros.anios, 2020, 2100, "un año no válido"),
    p_semanas: enteros(filtros.semanas, 1, 53, "una semana no válida"),
  })
  if (error) throw new Error(error.message)
  const c = (data ?? {}) as Record<string, number>
  return {
    preparacion: Number(c.preparacion ?? 0),
    por_liquidar: Number(c.por_liquidar ?? 0),
    observado: Number(c.observado ?? 0),
    liquidado: Number(c.liquidado ?? 0),
    todos: Number(c.todos ?? 0),
  }
}

// Un pago (para refrescar la fila después de una acción).
export async function obtenerPagoConsolidado(pagoId: string): Promise<Pago> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("pagos").select(CAMPOS_PAGO).eq("id", pagoId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("El pago no existe o no tienes acceso.")
  return mapPago(data)
}

// ------------------------------------------------------------ liquidación

// Financiera: los elegidos, o TODOS los que están en preparación con los filtros.
export async function enviarPagosALiquidar(ids: string[]): Promise<number> {
  await requerirAccion("gestionar_pagos")
  if (ids.length === 0) return 0
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("enviar_pagos_a_liquidar", { p_ids: ids })
  if (error) throw new Error(error.message)
  return Number(data ?? 0)
}

export async function enviarFiltradosALiquidar(clave: string, filtros: FiltrosConsolidado): Promise<number> {
  await requerirAccion("gestionar_pagos")
  const consolidadoId = await idConsolidado(clave)
  const supabase = await createClient()
  const campos = filtros.tercero?.trim() ? "id, tercero:terceros!pagos_tercero_id_fkey!inner(razon_social)" : "id"
  const filas = await traerTodo<{ id: string }>((desde, hasta) =>
    consultaConsolidado(supabase, consolidadoId, { ...filtros, etapa: "preparacion" }, campos).range(desde, hasta)
  )
  let total = 0
  for (let i = 0; i < filas.length; i += 1000) {
    const { data, error } = await supabase.rpc("enviar_pagos_a_liquidar", { p_ids: filas.slice(i, i + 1000).map((f) => f.id) })
    if (error) throw new Error(error.message)
    total += Number(data ?? 0)
  }
  return total
}

export async function comentarPago(pagoId: string, texto: string, tipo: TipoComentarioPago): Promise<void> {
  if (tipo === "observacion") await requerirAccion("liquidar_pagos")
  else if (tipo === "respuesta") await requerirAccion("gestionar_pagos")
  const supabase = await createClient()
  const { error } = await supabase.rpc("comentar_pago", { p_pago_id: pagoId, p_texto: texto, p_tipo: tipo })
  if (error) throw new Error(error.message)
}

export async function listarComentariosPago(pagoId: string): Promise<ComentarioPago[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("pago_comentarios")
    .select("id, texto, tipo, creado_en, autor:perfiles!pago_comentarios_autor_id_fkey(nombre)")
    .eq("pago_id", pagoId)
    .order("creado_en", { ascending: true })
    .limit(500)
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    texto: c.texto,
    tipo: c.tipo,
    autor: c.autor?.nombre ?? null,
    creadoEn: c.creado_en,
  }))
}

// Contabilidad: la pantalla (una fila o varias) y el Excel. Tandas de 300.
export async function liquidarPagos(filas: FilaLiquidacion[]): Promise<ResultadoLiquidacion[]> {
  await requerirAccion("liquidar_pagos")
  if (filas.length > 5000) throw new Error("Como mucho 5000 pagos a la vez.")
  const supabase = await createClient()
  const salida: ResultadoLiquidacion[] = []
  for (let i = 0; i < filas.length; i += 300) {
    const { data, error } = await supabase.rpc("liquidar_pagos_lote", {
      p_filas: filas.slice(i, i + 300).map((f) => ({
        pago_id: f.pagoId,
        base: f.base,
        iva: f.iva,
        retefuente: f.retefuente,
        reteiva: f.reteiva,
        reteica: f.reteica,
        asumidas: f.asumidas,
        liquidaciones: f.liquidaciones,
        anticipos_descuentos: f.anticiposDescuentos,
        valor_a_pagar: f.valorAPagar,
        sin_retenciones: f.sinRetenciones,
        comentario: f.comentario,
      })),
    })
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as any[]) {
      salida.push({ pagoId: String(r.pago_id ?? ""), resultado: r.resultado, mensaje: r.mensaje ?? null })
    }
  }
  return salida
}

// Todos los pagos para el Excel de liquidación: los que ya se enviaron a
// liquidar (por liquidar, observados y liquidados), con los filtros de años,
// semanas y tercero. Sin paginar.
export async function pagosParaExcelLiquidacion(clave: string, filtros: FiltrosConsolidado): Promise<Pago[]> {
  const consolidadoId = await idConsolidado(clave)
  const supabase = await createClient()
  const filas = await traerTodo<any>((desde, hasta) =>
    consultaConsolidado(supabase, consolidadoId, { ...filtros, etapa: "todos", estado: "aprobado" })
      .not("liquidacion_estado", "is", null)
      .range(desde, hasta)
  )
  return filas.map(mapPago)
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
