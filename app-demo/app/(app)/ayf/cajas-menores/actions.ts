"use server"

import { readFileSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import { createClient } from "@/lib/supabase/server"
import { obtenerUsuarioId, requerirPestana } from "@/lib/permisos"
import { formatearFechaHora, hoyColombia } from "@/lib/fechas"
import { RelacionCajaMenorPDF } from "@/components/relacion-caja-menor-pdf"
import {
  cajaParaGuardar,
  gastoParaGuardar,
  mapCajaMenor,
  mapLegalizacionDetalle,
  mapLegalizacionFila,
  validarCajaMenor,
  validarLegalizacion,
  type CajaMenor,
  type CajaMenorForm,
  type EstadoLegalizacion,
  type GastoForm,
  type LegalizacionDetalle,
  type LegalizacionFila,
  type OpcionesCajaMenor,
  type ResultadoAccion,
  type ResultadoLiquidacionGastos,
} from "@/lib/caja-menor"
import type { GastosDePago } from "@/lib/caja-menor-consolidado"

// Caja menor (20270101007400). Todo pasa por funciones de la base, que vuelven
// a validar los permisos: el responsable (sus cajas y legalizaciones), Financiera
// (gestionar_cajas_menores) y Líder Financiera (aprobar_cajas_menores).

async function clienteConSesion() {
  if (!(await obtenerUsuarioId())) throw new Error("Inicia sesión.")
  return createClient()
}

// El responsable sube su legalización desde Pagos administrativos.
async function clienteResponsable() {
  await requerirPestana("ayf.pagos_administrativos")
  return createClient()
}

async function clienteAyf() {
  await requerirPestana("ayf.cajas_menores")
  return createClient()
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- responsable
export async function miCajaMenor(): Promise<CajaMenor | null> {
  const supabase = await clienteResponsable()
  const { data, error } = await supabase.rpc("mi_caja_menor")
  if (error) throw new Error(error.message)
  return data ? mapCajaMenor(data) : null
}

export async function listarMisLegalizaciones(): Promise<LegalizacionFila[]> {
  const supabase = await clienteResponsable()
  const { data, error } = await supabase.rpc("listar_legalizaciones_caja_menor", { p_estado: null, p_solo_mias: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map(mapLegalizacionFila)
}

/** Envía (id null) o corrige y reenvía una devuelta. Los soportes ya van subidos. */
async function enviarLegalizacionLanza(id: string | null, gastos: GastoForm[]): Promise<string> {
  const errores = validarLegalizacion(gastos, hoyColombia())
  if (errores.length > 0) {
    const e = errores[0]
    throw new Error(e.indice >= 0 ? `Gasto ${e.indice + 1}: ${e.mensaje}` : e.mensaje)
  }
  const supabase = await clienteResponsable()
  const { data, error } = await supabase.rpc("enviar_legalizacion_caja_menor", {
    p_id: id,
    p_gastos: gastos.map(gastoParaGuardar),
  })
  if (error) throw new Error(error.message)
  return String(data)
}

/**
 * Guarda el borrador (todos los gastos que lleva, ya con sus soportes subidos;
 * reemplaza los de antes). Sin gastos, se borra. Financiera no lo ve.
 */
async function guardarBorradorLanza(gastos: GastoForm[]): Promise<string | null> {
  const errores = validarLegalizacion(gastos, hoyColombia())
  if (gastos.length > 0 && errores.length > 0) {
    const e = errores[0]
    throw new Error(e.indice >= 0 ? `Gasto ${e.indice + 1}: ${e.mensaje}` : e.mensaje)
  }
  const supabase = await clienteResponsable()
  const { data, error } = await supabase.rpc("guardar_borrador_caja_menor", { p_gastos: gastos.map(gastoParaGuardar) })
  if (error) throw new Error(error.message)
  return data ? String(data) : null
}

/** Descarta el borrador y borra sus soportes del bucket. */
async function descartarBorradorLanza(): Promise<void> {
  const supabase = await clienteResponsable()
  const { data, error } = await supabase.rpc("descartar_borrador_caja_menor")
  if (error) throw new Error(error.message)
  const rutas = ((data ?? []) as string[]).filter(Boolean)
  if (rutas.length > 0) await supabase.storage.from("cajas_menores").remove(rutas)
}

async function cancelarLegalizacionLanza(id: string, motivo: string): Promise<void> {
  const supabase = await clienteResponsable()
  const { error } = await supabase.rpc("cancelar_legalizacion_caja_menor", { p_id: id, p_motivo: motivo })
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------- lectura (responsable, A&F, Gerencia desde el pago)
export async function obtenerLegalizacion(id: string): Promise<LegalizacionDetalle> {
  const supabase = await clienteConSesion()
  const { data, error } = await supabase.rpc("detalle_legalizacion_caja_menor", { p_id: id })
  if (error) throw new Error(error.message)
  return mapLegalizacionDetalle(data)
}

/** La legalización de un cuadro de caja menor (null si el cuadro no es de caja menor). */
export async function legalizacionDeCuadro(requisicionAdminId: string): Promise<string | null> {
  const supabase = await clienteConSesion()
  const { data, error } = await supabase.rpc("legalizacion_de_cuadro", { p_requisicion_admin_id: requisicionAdminId })
  if (error) throw new Error(error.message)
  return data ? String(data) : null
}

/**
 * Los gastos de la caja menor de cada pago (el reembolso), para mostrarlos como
 * filas en el Consolidado y en el Excel de liquidación. Con la RLS de quien
 * consulta (Contabilidad los ve por su consolidado). Pagos que no son de caja
 * menor no salen.
 */
export async function gastosCajaMenorDePagos(pagoIds: string[]): Promise<Record<string, GastosDePago>> {
  const ids = [...new Set(pagoIds)].filter(Boolean)
  if (ids.length === 0) return {}
  if (ids.length > 2000) throw new Error("Como mucho 2000 pagos a la vez.")
  const supabase = await clienteConSesion()
  const pagos: any[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase
      .from("pagos")
      .select("id, requisicion_admin_id, liquidacion_estado")
      .in("id", ids.slice(i, i + 100))
      .not("requisicion_admin_id", "is", null)
    if (error) throw new Error(error.message)
    pagos.push(...(data ?? []))
  }
  const reqIds = [...new Set(pagos.map((p) => p.requisicion_admin_id as string))]
  if (reqIds.length === 0) return {}
  const legalizaciones: any[] = []
  for (let i = 0; i < reqIds.length; i += 100) {
    const { data, error } = await supabase
      .from("caja_menor_legalizaciones")
      .select(
        "id, codigo, requisicion_admin_id, caja_menor_gastos(id, orden, fecha, proyecto_id, numero_factura, documento, nombre, concepto, destino, valor, soporte_ruta, soporte_nombre, soporte_mime, soporte_tamano, liq_base, liq_iva, retefuente, reteiva, reteica, valor_a_pagar, liquidado_en)"
      )
      .in("requisicion_admin_id", reqIds.slice(i, i + 100))
    if (error) throw new Error(error.message)
    legalizaciones.push(...(data ?? []))
  }
  const porReq = new Map(legalizaciones.map((l) => [l.requisicion_admin_id as string, l]))
  const salida: Record<string, GastosDePago> = {}
  for (const p of pagos) {
    const l = porReq.get(p.requisicion_admin_id)
    if (!l) continue
    const gastos = ((l.caja_menor_gastos ?? []) as any[])
      .sort((a, b) => a.orden - b.orden)
      .map((g) => ({
        id: String(g.id),
        orden: Number(g.orden),
        fecha: String(g.fecha ?? ""),
        proyectoId: String(g.proyecto_id ?? ""),
        proyectoCodigo: null,
        proyectoNombre: "",
        solicitadoPorNombre: null,
        numeroFactura: String(g.numero_factura ?? ""),
        documento: String(g.documento ?? ""),
        nombre: String(g.nombre ?? ""),
        concepto: String(g.concepto ?? ""),
        destino: String(g.destino ?? ""),
        valor: Number(g.valor ?? 0),
        soporte: { ruta: String(g.soporte_ruta ?? ""), nombre: String(g.soporte_nombre ?? ""), mime: g.soporte_mime ?? null, tamano: g.soporte_tamano ?? null },
        liquidacion:
          g.valor_a_pagar == null
            ? null
            : {
                base: g.liq_base == null ? null : Number(g.liq_base),
                iva: g.liq_iva == null ? null : Number(g.liq_iva),
                retefuente: Number(g.retefuente ?? 0),
                reteiva: Number(g.reteiva ?? 0),
                reteica: Number(g.reteica ?? 0),
                valorAPagar: Number(g.valor_a_pagar),
                liquidadoEn: g.liquidado_en ?? null,
                liquidadoPorNombre: null,
              },
      }))
    salida[p.id] = {
      pagoId: String(p.id),
      legalizacionId: String(l.id),
      codigo: String(l.codigo),
      pagoLiquidacionEstado: p.liquidacion_estado ?? null,
      gastos,
    }
  }
  return salida
}

// ---------------------------------------------------------------- A&F
export async function listarLegalizaciones(estado: EstadoLegalizacion | null): Promise<LegalizacionFila[]> {
  const supabase = await clienteAyf()
  const { data, error } = await supabase.rpc("listar_legalizaciones_caja_menor", { p_estado: estado, p_solo_mias: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map(mapLegalizacionFila)
}

export async function listarCajasMenores(incluirCerradas: boolean): Promise<CajaMenor[]> {
  const supabase = await clienteAyf()
  const { data, error } = await supabase.rpc("listar_cajas_menores", { p_incluir_cerradas: incluirCerradas })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map(mapCajaMenor)
}

export async function opcionesCajaMenor(): Promise<OpcionesCajaMenor> {
  const supabase = await clienteAyf()
  const { data, error } = await supabase.rpc("opciones_caja_menor")
  if (error) throw new Error(error.message)
  const d = (data ?? {}) as any
  return {
    personas: ((d.personas ?? []) as any[]).map((p) => ({ id: String(p.id), nombre: String(p.nombre) })),
    empresas: ((d.empresas ?? []) as any[]).map((e) => ({ id: String(e.id), razonSocial: String(e.razon_social ?? "") })),
    proyectos: ((d.proyectos ?? []) as any[]).map((p) => ({
      id: String(p.id),
      codigo: p.codigo ?? null,
      nombre: String(p.nombre ?? ""),
      empresaId: p.empresa_id ?? null,
    })),
  }
}

async function guardarCajaMenorLanza(id: string | null, caja: CajaMenorForm): Promise<string> {
  const e = validarCajaMenor(caja)
  if (e) throw new Error(e)
  const supabase = await clienteAyf()
  const { data, error } = await supabase.rpc("guardar_caja_menor", { p_id: id, p_datos: cajaParaGuardar(caja) })
  if (error) throw new Error(error.message)
  return String(data)
}

async function cerrarCajaMenorLanza(id: string, motivo: string): Promise<void> {
  const supabase = await clienteAyf()
  const { error } = await supabase.rpc("cerrar_caja_menor", { p_id: id, p_motivo: motivo })
  if (error) throw new Error(error.message)
}

/** Financiera: pasa a Líder Financiera ("aprobar") o devuelve al responsable. */
async function revisarLegalizacionLanza(id: string, accion: "aprobar" | "devolver", motivo: string | null): Promise<void> {
  const supabase = await clienteAyf()
  const { error } = await supabase.rpc("revisar_legalizacion_caja_menor", { p_id: id, p_accion: accion, p_motivo: motivo })
  if (error) throw new Error(error.message)
}

/** Líder Financiera: devuelve al responsable. */
async function devolverLegalizacionLiderLanza(id: string, motivo: string): Promise<void> {
  const supabase = await clienteAyf()
  const { error } = await supabase.rpc("aprobar_legalizacion_caja_menor", {
    p_id: id,
    p_accion: "devolver",
    p_motivo: motivo,
    p_soporte: null,
  })
  if (error) throw new Error(error.message)
}

/**
 * Líder Financiera da el okay: genera la relación de gastos en PDF, la sube a
 * requisiciones_admin/<su usuario>/ y la base crea el cuadro de pago del
 * reembolso para Gerencia. Si la base no lo acepta, se borra el PDF.
 * Devuelve el id del cuadro.
 */
async function aprobarLegalizacionLiderLanza(id: string): Promise<string> {
  const supabase = await clienteAyf()
  const uid = await obtenerUsuarioId()
  if (!uid) throw new Error("Inicia sesión.")
  const { data: crudo, error: e1 } = await supabase.rpc("detalle_legalizacion_caja_menor", { p_id: id })
  if (e1) throw new Error(e1.message)
  const detalle = mapLegalizacionDetalle(crudo)
  if (detalle.estado !== "por_aprobar") throw new Error("La legalización ya no está por aprobar.")
  const { data: yo } = await supabase.from("perfiles").select("nombre").eq("id", uid).maybeSingle()

  let logo: Buffer | null = null
  try {
    logo = readFileSync(path.join(process.cwd(), "public", "logo-conyca.png"))
  } catch {
    logo = null
  }
  const pdf = new Uint8Array(
    await renderToBuffer(
      createElement(RelacionCajaMenorPDF, {
        detalle,
        logo,
        generado: formatearFechaHora(new Date().toISOString()),
        aprobadoPor: (yo as any)?.nombre ?? "Líder Financiera",
      }) as never
    )
  )
  const nombre = `Relacion caja menor ${detalle.codigo}.pdf`
  const ruta = `${uid}/caja-menor-${detalle.codigo}-${Date.now()}.pdf`
  const { error: e2 } = await supabase.storage
    .from("requisiciones_admin")
    .upload(ruta, pdf, { contentType: "application/pdf", upsert: false })
  if (e2) throw new Error(`No se pudo guardar la relación de gastos (${e2.message}).`)

  const { data, error } = await supabase.rpc("aprobar_legalizacion_caja_menor", {
    p_id: id,
    p_accion: "aprobar",
    p_motivo: null,
    p_soporte: { ruta, nombre, mime: "application/pdf", tamano: pdf.byteLength },
  })
  if (error) {
    await supabase.storage.from("requisiciones_admin").remove([ruta])
    throw new Error(error.message)
  }
  return String(data)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- lo que llama la pantalla
// En producción Next.js esconde el mensaje de un error lanzado por una acción (en
// pantalla sale un error genérico, "React error #441"): las que cambian algo DEVUELVEN
// el error para que se vea el motivo (p. ej. "La caja tiene una legalización en curso").
async function resultado<T>(f: () => Promise<T>): Promise<ResultadoAccion<T>> {
  try {
    return { ok: true, valor: await f() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo completar la acción." }
  }
}

export async function enviarLegalizacion(id: string | null, gastos: GastoForm[]): Promise<ResultadoAccion<string>> {
  return resultado(() => enviarLegalizacionLanza(id, gastos))
}
export async function guardarBorrador(gastos: GastoForm[]): Promise<ResultadoAccion<string | null>> {
  return resultado(() => guardarBorradorLanza(gastos))
}
export async function descartarBorrador(): Promise<ResultadoAccion<void>> {
  return resultado(() => descartarBorradorLanza())
}
export async function cancelarLegalizacion(id: string, motivo: string): Promise<ResultadoAccion<void>> {
  return resultado(() => cancelarLegalizacionLanza(id, motivo))
}
export async function guardarCajaMenor(id: string | null, caja: CajaMenorForm): Promise<ResultadoAccion<string>> {
  return resultado(() => guardarCajaMenorLanza(id, caja))
}
export async function cerrarCajaMenor(id: string, motivo: string): Promise<ResultadoAccion<void>> {
  return resultado(() => cerrarCajaMenorLanza(id, motivo))
}
export async function revisarLegalizacion(
  id: string,
  accion: "aprobar" | "devolver",
  motivo: string | null
): Promise<ResultadoAccion<void>> {
  return resultado(() => revisarLegalizacionLanza(id, accion, motivo))
}
export async function devolverLegalizacionLider(id: string, motivo: string): Promise<ResultadoAccion<void>> {
  return resultado(() => devolverLegalizacionLiderLanza(id, motivo))
}
export async function aprobarLegalizacionLider(id: string): Promise<ResultadoAccion<string>> {
  return resultado(() => aprobarLegalizacionLiderLanza(id))
}

// Contabilidad liquida los gastos de la caja menor del pago (20270101007600); con
// todos liquidados el pago queda liquidado con la suma.
async function liquidarGastosLanza(pagoId: string, filas: Record<string, unknown>[]): Promise<ResultadoLiquidacionGastos> {
  const supabase = await clienteConSesion()
  const { data, error } = await supabase.rpc("liquidar_gastos_caja_menor", { p_pago: pagoId, p_filas: filas })
  if (error) throw new Error(error.message)
  const d = (data ?? {}) as { gastos?: number; liquidados?: number; pago_liquidado?: boolean }
  return { gastos: Number(d.gastos ?? 0), liquidados: Number(d.liquidados ?? 0), pagoLiquidado: Boolean(d.pago_liquidado) }
}
export async function liquidarGastosCajaMenor(
  pagoId: string,
  filas: Record<string, unknown>[]
): Promise<ResultadoAccion<ResultadoLiquidacionGastos>> {
  return resultado(() => liquidarGastosLanza(pagoId, filas))
}

