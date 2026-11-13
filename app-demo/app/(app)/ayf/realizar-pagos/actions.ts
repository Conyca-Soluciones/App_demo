"use server"

// Realizar Pagos (A&F › Pagos): la consola de dispersores de Python dentro de
// la app. Lee los pagos LIQUIDADOS de los tres consolidados, les da su estado
// (los seis de la consola), asigna la cuenta a debitar y genera los archivos
// del banco con sus soportes. Generar es todo o nada: primero se arma todo en
// memoria (como api_generar), luego se sube y la base lo registra en una sola
// transacción (registrar_dispersiones), que deja los pagos DISPERSADOS.

import { readFileSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import ExcelJS from "exceljs"
import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, requerirAccion, requerirPestana } from "@/lib/permisos"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { fechaIsoEnZona, formatearFechaSinHora, hoyColombia } from "@/lib/fechas"
import { CAMPOS_PAGO, conProyectos, mapPago } from "@/lib/pagos-db"
import { aPesos, texto } from "@/lib/dispersores/textos"
import { ErrorGeneracion, avisosDispersor, generarArchivos, nombreBase, totalTanda, validarTanda } from "@/lib/dispersores/generador"
import {
  agruparAsignados,
  cambiosManuales,
  conEstado,
  cuentaDebitarDe,
  tandaDe,
  type CuentaEmpresa,
  type PagoConEstado,
  type PagoDispersor,
  type TerceroDispersor,
} from "@/lib/dispersores/pagos-dispersor"
import { SoporteDispersorPDF, nombreSoporteGrupal, nombreSoporteIndividual, nombreSoportePagoManual } from "@/components/soporte-dispersor-pdf"
import type { Tanda } from "@/lib/dispersores/generador"

const PESTANA = "ayf.realizar_pagos"
const ACCION = "generar_dispersores"
const BUCKET = "dispersores"

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FiltrosRealizarPagos = { anios?: number[]; semanas?: number[] }

function enteros(lista: number[] | undefined, min: number, max: number, nombre: string): number[] {
  const unicos = [...new Set(lista ?? [])]
  if (unicos.length > 53 || unicos.some((n) => !Number.isInteger(n) || n < min || n > max)) {
    throw new Error(`El filtro tiene ${nombre}.`)
  }
  return unicos
}

const CAMPOS_TERCERO = "razon_social, tipo_documento, numero_documento, dv, nombre_banco, nombres, apellidos"
const CAMPOS = `
  id, referencia, anio, semana, estado, fuente, valor_a_pagar, fuera_dispersor, cuenta_debitar_id, dispersion_id,
  cuenta_confirmada_en, cuenta_modificada, etiquetas, tercero_id, titular_tercero_id, proyecto_id,
  es_pse:pago_es_pse, pagado_manual_por, pago_comprobante_nombre, pago_comprobante_ruta, pago_soporte_nombre, dispersado_en,
  consolidado:consolidados!pagos_consolidado_id_fkey(nombre),
  req:requisiciones_admin!pagos_requisicion_admin_id_fkey(metodo),
  req_item:requisicion_admin_items!pagos_requisicion_admin_item_id_fkey(titular_nombre),
  proyecto:proyectos!pagos_proyecto_id_fkey(codigo, nombre),
  empresa:empresas!pagos_empresa_id_fkey(razon_social),
  tercero:terceros!pagos_tercero_id_fkey(${CAMPOS_TERCERO}),
  titular:terceros!pagos_titular_tercero_id_fkey(${CAMPOS_TERCERO}),
  cuenta:terceros_cuentas!pagos_cuenta_tercero_id_fkey(numero_cuenta, tipo_cuenta, estado, etiqueta, banco:bancos(nombre)),
  dispersion:dispersiones!pagos_dispersion_id_fkey(apodo, nombre_base, generado_en),
  intentos:dispersion_pagos!dispersion_pagos_pago_id_fkey(dispersion_id, soporte_ruta, soporte_nombre, rebotado_en, motivo_rebote)
`

const terceroDe = (t: any): TerceroDispersor | null =>
  t
    ? {
        razonSocial: t.razon_social ?? "",
        tipoDocumento: t.tipo_documento ?? "",
        numeroDocumento: t.numero_documento ?? "",
        dv: t.dv ?? "",
        nombreBanco: t.nombre_banco ?? "",
        nombres: t.nombres ?? "",
        apellidos: t.apellidos ?? "",
      }
    : null

// Los intentos de dispersión del pago (20261226000000): el vigente es el de su
// dispersion_id; el último que rebotó se muestra como aviso.
const intentosDe = (x: any): any[] => (Array.isArray(x) ? x : x ? [x] : [])

function soporteDe(intentos: any[], dispersionId: string | null): { nombre: string; ruta: string } | null {
  const x = dispersionId ? intentos.find((i) => i.dispersion_id === dispersionId && !i.rebotado_en) : null
  return x?.soporte_ruta ? { nombre: x.soporte_nombre, ruta: x.soporte_ruta } : null
}

function reboteDe(intentos: any[]): { fecha: string; motivo: string } | null {
  let ultimo: any = null
  for (const i of intentos) if (i.rebotado_en && (!ultimo || i.rebotado_en > ultimo.rebotado_en)) ultimo = i
  return ultimo ? { fecha: ultimo.rebotado_en, motivo: ultimo.motivo_rebote ?? "" } : null
}

// Financiera no tiene proyectos asignados: el embed de proyectos le llega
// vacío (RLS) y el soporte del dispersor decía "(sin proyecto)". Se completa
// con proyectos_de_pagos (20261231300000), una consulta por lista.
async function completarProyectos(supabase: any, filas: any[]): Promise<any[]> {
  const ids = [...new Set(filas.filter((f) => f.proyecto_id && !f.proyecto).map((f) => f.proyecto_id as string))]
  if (ids.length === 0) return filas
  const { data, error } = await supabase.rpc("proyectos_de_pagos", { p_ids: ids })
  if (error) throw new Error(error.message)
  const porId = new Map<string, any>(((data ?? []) as any[]).map((p) => [p.id, p]))
  return filas.map((f) => (f.proyecto_id && !f.proyecto && porId.has(f.proyecto_id) ? { ...f, proyecto: porId.get(f.proyecto_id) } : f))
}

function mapPagoDispersor(f: any): PagoDispersor {
  const valorOriginal = Number(f.valor_a_pagar ?? 0)
  const banco = f.cuenta?.banco?.nombre ?? ""
  return {
    id: f.id,
    item: f.referencia ?? "", // REF del pago (001-00001)
    semana: f.semana ?? null,
    anio: f.anio ?? null,
    consolidado: f.consolidado?.nombre ?? "",
    grupo: f.empresa?.razon_social ?? "",
    proyecto: f.proyecto?.codigo || f.proyecto?.nombre || "",
    valorOriginal,
    valor: aPesos(valorOriginal),
    estadoPago: f.estado,
    // PSE de la requisición administrativa, de la OC o del contrato (pago_es_pse, 20270101000300)
    esPse: f.es_pse === true || f.req?.metodo === "pse" || texto(banco) === "PSE",
    fueraManual: Boolean(f.fuera_dispersor),
    esNomina: ((f.etiquetas ?? []) as string[]).some((e) => texto(e) === "NOM"),
    // la cuenta es del titular si se eligió otro; si no, de quien factura
    beneficiario: terceroDe(f.titular_tercero_id ? f.titular : f.tercero),
    factura: f.tercero?.razon_social ?? f.req_item?.titular_nombre ?? null,
    cuenta: f.cuenta
      ? { banco, tipoCuenta: f.cuenta.tipo_cuenta ?? "", numero: f.cuenta.numero_cuenta ?? "", estado: f.cuenta.estado ?? "", etiqueta: f.cuenta.etiqueta ?? "" }
      : null,
    cuentaModificada: f.cuenta_modificada != null,
    confirmada: f.cuenta_confirmada_en != null,
    cuentaDebitarId: f.cuenta_debitar_id ?? null,
    dispersion: f.dispersion
      ? {
          apodo: f.dispersion.apodo,
          nombreBase: f.dispersion.nombre_base,
          generadoEn: f.dispersion.generado_en,
          soporte: soporteDe(intentosDe(f.intentos), f.dispersion_id ?? null),
        }
      : null,
    rebote: reboteDe(intentosDe(f.intentos)),
    pagadoManual:
      f.estado === "dispersado" && f.pagado_manual_por
        ? {
            fecha: f.dispersado_en ?? null,
            comprobante: f.pago_comprobante_ruta ? { nombre: f.pago_comprobante_nombre ?? "comprobante", ruta: f.pago_comprobante_ruta } : null,
            soporte: f.pago_soporte_nombre ? { nombre: f.pago_soporte_nombre } : null,
          }
        : null,
  }
}

// Los liquidados por dispersar y los ya dispersados de esos años y semanas.
function consulta(supabase: any, filtros: FiltrosRealizarPagos) {
  let q: any = supabase
    .from("pagos")
    .select(CAMPOS)
    .eq("liquidacion_estado", "liquidado")
    .in("estado", ["aprobado", "dispersado"])
    .not("referencia", "is", null)
    // Los PSE se pagan desde el Consolidado, pestaña PSE (20270101000400).
    .eq("pago_es_pse", false)
  const anios = enteros(filtros.anios, 2020, 2100, "un año no válido")
  const semanas = enteros(filtros.semanas, 1, 53, "una semana no válida")
  if (anios.length > 0) q = q.in("anio", anios)
  if (semanas.length > 0) q = q.in("semana", semanas)
  return q
    .order("anio", { ascending: false })
    .order("semana", { ascending: false })
    .order("referencia", { ascending: true })
    .order("id", { ascending: true })
}

async function cuentasEmpresa(supabase: any): Promise<CuentaEmpresa[]> {
  const { data, error } = await supabase
    .from("cuentas_empresa")
    .select("id, apodo, diminutivo, tipo_cuenta, numero_cuenta, nit, dv, razon_social, correo_itau, banco:bancos(nombre), empresa:empresas(razon_social)")
    .eq("estado", "ACTIVA")
    .order("apodo", { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((c) => cuentaDebitarDe({ ...c, banco: c.banco?.nombre ?? "", empresa: c.empresa?.razon_social ?? null }))
}

export async function listarRealizarPagos(
  filtros: FiltrosRealizarPagos
): Promise<{ pagos: PagoConEstado[]; cuentas: CuentaEmpresa[] }> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const [filas, cuentas] = await Promise.all([
    traerTodo<any>((desde, hasta) => consulta(supabase, filtros).range(desde, hasta)),
    cuentasEmpresa(supabase),
  ])
  return { pagos: (await completarProyectos(supabase, filas)).map((f) => conEstado(mapPagoDispersor(f))), cuentas }
}

// ------------------------------------------------------------- pasos 1 y 2

async function enTandas(ids: string[], fn: (lote: string[]) => Promise<number>): Promise<number> {
  if (ids.length > 3000) throw new Error("Como mucho 3000 pagos a la vez.")
  let n = 0
  for (let i = 0; i < ids.length; i += 1000) n += await fn(ids.slice(i, i + 1000))
  return n
}

export async function asignarCuentaDebitar(ids: string[], cuentaId: string | null): Promise<number> {
  await requerirAccion(ACCION)
  const supabase = await createClient()
  return enTandas(ids, async (lote) => {
    const { data, error } = await supabase.rpc("asignar_cuenta_debitar", { p_ids: lote, p_cuenta_id: cuentaId })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  })
}

export async function marcarFueraDispersor(ids: string[], fuera: boolean): Promise<number> {
  await requerirAccion(ACCION)
  const supabase = await createClient()
  return enTandas(ids, async (lote) => {
    const { data, error } = await supabase.rpc("marcar_fuera_dispersor", { p_ids: lote, p_fuera: fuera })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  })
}

export async function confirmarCuentaPagos(ids: string[]): Promise<number> {
  await requerirAccion(ACCION)
  const supabase = await createClient()
  return enTandas(ids, async (lote) => {
    const { data, error } = await supabase.rpc("confirmar_cuenta_pagos", { p_ids: lote })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  })
}

/** "Rebotó en el banco": el pago dispersado vuelve a dispersión (Por asignar), con el motivo. */
export async function redispersarPagos(ids: string[], motivo: string): Promise<number> {
  await requerirAccion(ACCION)
  if (motivo.trim().length < 3) throw new Error("Escribe por qué rebotó el pago.")
  const supabase = await createClient()
  return enTandas(ids, async (lote) => {
    const { data, error } = await supabase.rpc("redispersar_pagos", { p_ids: lote, p_motivo: motivo.trim() })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  })
}

/**
 * Pagos por PSE u otro medio (Otros pagos pendientes): quedan pagados con la
 * fecha de hoy y la cuenta desde la que se pagaron; el comprobante (opcional)
 * ya está subido a dispersores/pse/... (20270101000300).
 */
// Pagar sin dispersor: PSE (Consolidado, pagar_pse) u otro medio (aquí,
// generar_dispersores). La base decide qué pago puede marcar cada uno.
async function requerirPagar() {
  const permisos = await obtenerPermisosRol()
  const ok = permisos?.esAdministrador || permisos?.acciones.includes(ACCION) || permisos?.acciones.includes("pagar_pse")
  if (!ok) throw new Error("No tienes permiso para pagar estos pagos.")
}

/** Las cuentas de las empresas desde las que se paga (las mismas del dispersor). */
export async function cuentasParaPagar(): Promise<CuentaEmpresa[]> {
  await requerirPagar()
  return cuentasEmpresa(await createClient())
}

/** "El pago no salió": un PSE marcado como pagado vuelve a la pestaña PSE. */
export async function deshacerPagoPse(ids: string[], motivo: string): Promise<number> {
  await requerirAccion("pagar_pse")
  if (motivo.trim().length < 3) throw new Error("Escribe por qué no salió el pago.")
  const supabase = await createClient()
  return enTandas(ids, async (lote) => {
    const { data, error } = await supabase.rpc("deshacer_pago_pse", { p_ids: lote, p_motivo: motivo.trim() })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  })
}

export async function marcarPagosPagados(
  ids: string[],
  cuentaId: string,
  comprobante: { ruta: string; nombre: string; mime: string } | null
): Promise<number> {
  await requerirPagar()
  if (!cuentaId) throw new Error("Escoge la cuenta desde la que se pagó.")
  if (comprobante && !comprobante.ruta.startsWith("pse/")) throw new Error("El comprobante no se subió bien: vuelve a adjuntarlo.")
  const supabase = await createClient()
  const n = await enTandas(ids, async (lote) => {
    const { data, error } = await supabase.rpc("marcar_pagos_pagados", { p_ids: lote, p_cuenta_id: cuentaId, p_comprobante: comprobante })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  })
  // El soporte de cada pago (20270101003200). Si falla, los pagos ya quedaron
  // pagados: el soporte se genera después desde la ventana del pago.
  if (n > 0) {
    try {
      await soportesPagoManual(supabase, ids)
    } catch (e) {
      console.error("marcarPagosPagados: no se generó el soporte:", e instanceof Error ? e.message : e)
    }
  }
  return n
}

// ------------------------------------------------- soporte de pagos sin dispersor

/** Genera el soporte de los pagos pagados por PSE u otro medio que aún no lo tienen. */
export async function generarSoportesPagoManual(ids: string[]): Promise<number> {
  await requerirPagar()
  return soportesPagoManual(await createClient(), ids)
}

async function soportesPagoManual(supabase: any, ids: string[]): Promise<number> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return 0
  if (unicos.length > 3000) throw new Error("Como mucho 3000 pagos a la vez.")
  const filas: any[] = []
  for (let i = 0; i < unicos.length; i += 100) {
    const { data, error } = await supabase
      .from("pagos")
      .select(`${CAMPOS_PAGO}, dispersado_en, cuenta_debitar_id, pago_soporte_ruta, es_pse:pago_es_pse`)
      .in("id", unicos.slice(i, i + 100))
      .eq("estado", "dispersado")
      .not("pagado_manual_por", "is", null)
      .is("pago_soporte_ruta", null)
    if (error) throw new Error(error.message)
    filas.push(...((data ?? []) as any[]))
  }
  if (filas.length === 0) return 0
  const pagos = await conProyectos(supabase, filas.map(mapPago))
  const crudo = new Map(filas.map((f) => [f.id as string, f]))

  // Las cuentas debitadas (también si ya no están activas).
  const idsCuentas = [...new Set(filas.map((f) => f.cuenta_debitar_id).filter(Boolean))] as string[]
  const { data: cs, error: ec } = await supabase
    .from("cuentas_empresa")
    .select("id, apodo, diminutivo, tipo_cuenta, numero_cuenta, nit, dv, razon_social, correo_itau, banco:bancos(nombre), empresa:empresas(razon_social)")
    .in("id", idsCuentas)
  if (ec) throw new Error(ec.message)
  const cuentas = new Map(((cs ?? []) as any[]).map((c) => [c.id as string, cuentaDebitarDe({ ...c, banco: c.banco?.nombre ?? "", empresa: c.empresa?.razon_social ?? null })]))

  const logo = readFileSync(path.join(process.cwd(), "public", "logo-conyca.png"))
  const generado = new Date()
  const sinTipo = (d: string | null) => (d ?? "").replace(/^[A-Z]+\s+/, "")

  const preparados: { pagoId: string; ruta: string; nombre: string; contenido: Uint8Array }[] = []
  for (const p of pagos) {
    const f = crudo.get(p.id)
    const cuenta = f?.cuenta_debitar_id ? cuentas.get(f.cuenta_debitar_id) : null
    if (!f || !cuenta) continue
    const pse = f.es_pse === true || p.metodoPago === "pse"
    const fechaPago = f.dispersado_en ? fechaIsoEnZona(new Date(f.dispersado_en)) : hoyColombia()
    const [bancoCuenta, tipoCuenta, numeroCuenta] = (p.cuentaTexto ?? "").split(" · ")
    const titularPse = pse && p.cuentaTitular ? p.cuentaTitular : null
    const tanda: Tanda = {
      cuenta,
      renglones: [
        {
          item: p.referencia ?? "",
          documento: titularPse ? "" : sinTipo(p.terceroDocumento),
          tipoDoc: "",
          dv: "",
          nombre: (titularPse ?? p.terceroNombre ?? "").toUpperCase(),
          nombres: "",
          apellidos: "",
          bancoDestino: pse ? "PSE" : (bancoCuenta ?? "").toUpperCase(),
          tipoCuenta: pse ? "" : (tipoCuenta ?? ""),
          cuenta: pse ? "—" : (numeroCuenta ?? ""),
          valor: Math.trunc(p.valorAPagar ?? p.valor),
          referencia: p.referencia ?? "",
          empresa: (p.empresaNombre ?? "").toUpperCase(),
          proyecto: (p.proyectoCodigo || p.proyectoNombre || "").toUpperCase(),
        },
      ],
      semana: p.semana,
      clasePago: "PROVEEDORES",
      secuencia: "",
      fecha: fechaPago.replaceAll("-", ""),
      esNomina: false,
      truncado: "",
    }
    const medio = pse ? "PSE" : "OTRO"
    const nombre = nombreSoportePagoManual(tanda, p.referencia ?? p.id.slice(0, 8), medio)
    const notas = [
      titularPse ? `Factura: ${p.terceroNombre ?? "—"} · ${p.terceroDocumento ?? ""}` : null,
      p.pagoObservaciones ? `Información para el pago: ${p.pagoObservaciones}` : null,
      `Origen: ${p.origen || "—"}`,
    ].filter((x): x is string => Boolean(x))
    const contenido = new Uint8Array(
      await renderToBuffer(
        createElement(SoporteDispersorPDF, {
          tanda,
          archivos: [],
          logo,
          generado,
          titulo: pse ? "Soporte de Pago por PSE" : "Soporte de Pago (otro medio)",
          meta: `Medio de pago: ${pse ? "PSE" : "otro medio, sin dispersor"}  ·  Pagado el ${formatearFechaSinHora(fechaPago)}${
            p.comprobanteOtroMedio ? `  ·  Comprobante: ${p.comprobanteOtroMedio}` : ""
          }`,
          notas,
        }) as never
      )
    )
    preparados.push({ pagoId: p.id, ruta: `pse/soportes/${p.id}/${crypto.randomUUID()}/${nombre}`, nombre, contenido })
  }
  if (preparados.length === 0) return 0

  const subidas: string[] = []
  try {
    await aLimites(preparados, 4, async (x) => {
      const { error } = await supabase.storage.from(BUCKET).upload(x.ruta, x.contenido, { contentType: PDF, upsert: false })
      if (error) throw new Error(`No se pudo subir ${x.nombre}: ${error.message}`)
      subidas.push(x.ruta)
    })
    const { data, error } = await supabase.rpc("guardar_soportes_pago_manual", {
      p_soportes: preparados.map((x) => ({ pago_id: x.pagoId, ruta: x.ruta, nombre: x.nombre })),
    })
    if (error) throw new Error(error.message)
    return Number(data ?? 0)
  } catch (e) {
    for (let i = 0; i < subidas.length; i += 100) await supabase.storage.from(BUCKET).remove(subidas.slice(i, i + 100))
    throw e
  }
}

// ------------------------------------------------------------- paso 3: generar

export type ArchivoDispersion = { nombre: string; ruta: string; tipo: string }

export type TandaGenerada = {
  id: string
  apodo: string
  banco: string
  semana: number | null
  esNomina: boolean
  registros: number
  total: number
  secuencia: string
  ronda: number
  archivos: ArchivoDispersion[]
  soporte: ArchivoDispersion
  avisos: string[]
}

async function pagosPorId(supabase: any, ids: string[]): Promise<PagoConEstado[]> {
  const salida: PagoConEstado[] = []
  // .in() va en la URL: tandas de 100
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("pagos").select(CAMPOS).in("id", ids.slice(i, i + 100))
    if (error) throw new Error(error.message)
    for (const f of await completarProyectos(supabase, (data ?? []) as any[])) salida.push(conEstado(mapPagoDispersor(f)))
  }
  return salida
}

async function aLimites<T, R>(lista: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(lista.length)
  let siguiente = 0
  await Promise.all(
    Array.from({ length: Math.min(n, lista.length) }, async () => {
      while (siguiente < lista.length) {
        const i = siguiente++
        salida[i] = await fn(lista[i])
      }
    })
  )
  return salida
}

const PDF = "application/pdf"

/** Genera los dispersores de los pagos asignados (los ids que muestra el paso 3). */
export async function generarDispersores(ids: string[]): Promise<TandaGenerada[]> {
  await requerirAccion(ACCION)
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) throw new Error("No hay ningún pago asignado.")
  if (unicos.length > 3000) throw new Error("Como mucho 3000 pagos a la vez.")
  const supabase = await createClient()

  const [pagos, cuentas] = await Promise.all([pagosPorId(supabase, unicos), cuentasEmpresa(supabase)])
  if (pagos.length !== unicos.length) throw new Error("Algún pago ya no existe o no tienes acceso: vuelve a consultar.")
  const cambiados = pagos.filter((p) => p.estado !== "asignado")
  if (cambiados.length > 0) {
    throw new Error(`Estos pagos ya no están asignados: REF ${cambiados.slice(0, 10).map((p) => p.item).join(", ")}${cambiados.length > 10 ? "…" : ""}. Vuelve a consultar.`)
  }
  const porId = new Map(cuentas.map((c) => [c.id, c]))
  const grupos = agruparAsignados(pagos, porId)
  if (grupos.reduce((a, g) => a + g.pagos.length, 0) !== pagos.length) {
    throw new Error("Algún pago tiene una cuenta a debitar que ya no está activa: vuelve a asignarla.")
  }

  // Secuencia (por cuenta, año y semana) y ronda (por nombre y año), desde lo
  // ya generado; dentro de esta misma generación van subiendo.
  const anios = [...new Set(grupos.map((g) => g.anio).filter((a): a is number => a != null))]
  const previas = await traerTodo<any>((desde, hasta) => {
    let q: any = supabase
      .from("dispersiones")
      .select("id, cuenta_empresa_id, anio, semana, nombre_base")
      .in("cuenta_empresa_id", [...new Set(grupos.map((g) => g.cuenta.id))])
    if (anios.length > 0) q = q.in("anio", anios)
    return q.order("id", { ascending: true }).range(desde, hasta)
  })
  const conteoSec = new Map<string, number>()
  const conteoRonda = new Map<string, number>()
  const sumar = (m: Map<string, number>, k: string) => {
    const n = (m.get(k) ?? 0) + 1
    m.set(k, n)
    return n
  }
  for (const d of previas) {
    sumar(conteoSec, `${d.cuenta_empresa_id}|${d.anio ?? ""}|${d.semana ?? ""}`)
    sumar(conteoRonda, `${d.nombre_base}|${d.anio ?? ""}`)
  }

  const fecha = hoyColombia().replaceAll("-", "")
  const generado = new Date()
  const logo = readFileSync(path.join(process.cwd(), "public", "logo-conyca.png"))

  // 1. Todo en memoria; si una tanda falla, no se sube nada (api_generar).
  type Preparada = {
    id: string
    grupo: (typeof grupos)[number]
    tanda: ReturnType<typeof tandaDe>
    ronda: number
    archivos: { nombre: string; contenido: Uint8Array; tipo: string }[]
    soporte: { nombre: string; contenido: Uint8Array }
    individuales: { pagoId: string; item: string; valor: number; nombre: string; contenido: Uint8Array }[]
    avisos: string[]
  }
  const errores: string[] = []
  const borradores: Omit<Preparada, "soporte" | "individuales">[] = []
  for (const g of grupos) {
    const secuencia = `A${sumar(conteoSec, `${g.cuenta.id}|${g.anio ?? ""}|${g.semana ?? ""}`)}`
    const tanda = tandaDe(g, fecha, secuencia)
    try {
      validarTanda(ExcelJS, tanda)
      const archivos = await generarArchivos(ExcelJS, tanda)
      const ronda = sumar(conteoRonda, `${nombreBase(tanda)}|${g.anio ?? ""}`)
      borradores.push({ id: crypto.randomUUID(), grupo: g, tanda, ronda, archivos, avisos: avisosDispersor(tanda.cuenta, tanda.renglones) })
    } catch (e) {
      if (!(e instanceof ErrorGeneracion)) throw e
      errores.push(`${g.cuenta.apodo}: ${e.message}`)
    }
  }
  if (errores.length > 0) throw new Error(errores.join("\n"))

  const pdf = async (props: Parameters<typeof SoporteDispersorPDF>[0]) =>
    new Uint8Array(await renderToBuffer(createElement(SoporteDispersorPDF, props) as never))

  const preparadas: Preparada[] = []
  for (const b of borradores) {
    const nombres = b.archivos.map((a) => a.nombre)
    const soporte = {
      nombre: nombreSoporteGrupal(b.tanda, b.ronda),
      contenido: await pdf({ tanda: b.tanda, archivos: nombres, cambiosManuales: cambiosManuales(b.grupo), logo, generado }),
    }
    // El individual: la misma tanda con un solo pago, sin cambios manuales.
    const individuales = await aLimites(b.grupo.pagos, 4, async (p) => {
      const t = tandaDe({ ...b.grupo, pagos: [p] }, fecha, b.tanda.secuencia)
      return {
        pagoId: p.id,
        item: p.item,
        valor: p.valor,
        nombre: nombreSoporteIndividual(t, p.item),
        contenido: await pdf({ tanda: t, archivos: nombres, logo, generado }),
      }
    })
    preparadas.push({ ...b, soporte, individuales })
  }

  // 2. Subir (carpeta de la tanda; los individuales en items/).
  const subidas: string[] = []
  const subir = async (ruta: string, contenido: Uint8Array, tipo: string) => {
    const { error } = await supabase.storage.from(BUCKET).upload(ruta, contenido, { contentType: tipo, upsert: false })
    if (error) throw new Error(`No se pudo subir ${ruta.split("/").pop()}: ${error.message}`)
    subidas.push(ruta)
  }
  const deshacer = async () => {
    for (let i = 0; i < subidas.length; i += 100) await supabase.storage.from(BUCKET).remove(subidas.slice(i, i + 100))
  }

  try {
    const trabajos: (() => Promise<void>)[] = []
    for (const p of preparadas) {
      for (const a of p.archivos) trabajos.push(() => subir(`${p.id}/${a.nombre}`, a.contenido, a.tipo))
      trabajos.push(() => subir(`${p.id}/${p.soporte.nombre}`, p.soporte.contenido, PDF))
      for (const i of p.individuales) trabajos.push(() => subir(`${p.id}/items/${i.nombre}`, i.contenido, PDF))
    }
    await aLimites(trabajos, 8, (t) => t())

    // 3. La base revisa todo otra vez y registra (todo o nada).
    const { error } = await supabase.rpc("registrar_dispersiones", {
      p_tandas: preparadas.map((p) => ({
        id: p.id,
        cuenta_empresa_id: p.grupo.cuenta.id,
        clase_pago: p.tanda.clasePago,
        anio: p.grupo.anio,
        semana: p.grupo.semana,
        es_nomina: p.grupo.esNomina,
        secuencia: p.tanda.secuencia,
        ronda: p.ronda,
        nombre_base: nombreBase(p.tanda),
        fecha: `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)}`,
        total: totalTanda(p.tanda),
        truncado: p.tanda.truncado,
        archivos: p.archivos.map((a) => ({ nombre: a.nombre, ruta: `${p.id}/${a.nombre}`, tipo: a.tipo })),
        soporte: { nombre: p.soporte.nombre, ruta: `${p.id}/${p.soporte.nombre}` },
        pagos: p.individuales.map((i) => ({
          pago_id: i.pagoId,
          item: i.item,
          valor: i.valor,
          soporte: { nombre: i.nombre, ruta: `${p.id}/items/${i.nombre}` },
        })),
      })),
    })
    if (error) throw new Error(error.message)
  } catch (e) {
    await deshacer().catch(() => {})
    throw e
  }

  return preparadas.map((p) => ({
    id: p.id,
    apodo: p.grupo.cuenta.apodo,
    banco: p.grupo.cuenta.banco,
    semana: p.grupo.semana,
    esNomina: p.grupo.esNomina,
    registros: p.tanda.renglones.length,
    total: totalTanda(p.tanda),
    secuencia: p.tanda.secuencia,
    ronda: p.ronda,
    archivos: p.archivos.map((a) => ({ nombre: a.nombre, ruta: `${p.id}/${a.nombre}`, tipo: a.tipo })),
    soporte: { nombre: p.soporte.nombre, ruta: `${p.id}/${p.soporte.nombre}`, tipo: PDF },
    avisos: p.avisos,
  }))
}

// ------------------------------------------------------------- historial

export type Dispersion = {
  id: string
  apodo: string
  banco: string
  anio: number | null
  semana: number | null
  esNomina: boolean
  secuencia: string
  ronda: number
  registros: number
  total: number
  generadoEn: string
  generadoPor: string | null
  archivos: ArchivoDispersion[]
  soporte: ArchivoDispersion
}

export async function listarDispersiones(filtros: FiltrosRealizarPagos): Promise<Dispersion[]> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const anios = enteros(filtros.anios, 2020, 2100, "un año no válido")
  const semanas = enteros(filtros.semanas, 1, 53, "una semana no válida")
  const filas = await traerTodo<any>((desde, hasta) => {
    let q: any = supabase
      .from("dispersiones")
      .select("id, apodo, banco, anio, semana, es_nomina, secuencia, ronda, registros, total, generado_en, archivos, soporte_ruta, soporte_nombre, autor:perfiles!dispersiones_generado_por_fkey(nombre)")
    if (anios.length > 0) q = q.in("anio", anios)
    if (semanas.length > 0) q = q.in("semana", semanas)
    return q.order("generado_en", { ascending: false }).order("id", { ascending: true }).range(desde, hasta)
  })
  return filas.map((d) => ({
    id: d.id,
    apodo: d.apodo,
    banco: d.banco,
    anio: d.anio,
    semana: d.semana,
    esNomina: d.es_nomina,
    secuencia: d.secuencia,
    ronda: d.ronda,
    registros: d.registros,
    total: Number(d.total),
    generadoEn: d.generado_en,
    generadoPor: d.autor?.nombre ?? null,
    archivos: (d.archivos ?? []) as ArchivoDispersion[],
    soporte: { nombre: d.soporte_nombre, ruta: d.soporte_ruta, tipo: PDF },
  }))
}

/** Enlace de 2 minutos a un archivo de una tanda (la política del bucket decide). */
export async function enlaceArchivoDispersion(ruta: string): Promise<string> {
  const supabase = await createClient()
  const nombre = ruta.split("/").pop() ?? "archivo"
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 120, { download: nombre })
  if (error || !data) throw new Error(error?.message ?? "No se encontró el archivo.")
  return data.signedUrl
}
