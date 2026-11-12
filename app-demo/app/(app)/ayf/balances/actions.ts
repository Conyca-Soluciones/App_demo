"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirAlgunaPestana } from "@/lib/permisos"
import { hoyColombia } from "@/lib/fechas"
import {
  ACCION_REGISTRAR_MOVIMIENTOS,
  PESTANAS_BALANCES,
  mapExtracto,
  mapMovimiento,
  mapSaldoCuenta,
  validarMovimiento,
  type Extracto,
  type FormMovimiento,
  type MovimientoBancario,
  type SaldoCuenta,
  type TipoMovimiento,
} from "@/lib/balances"

/* eslint-disable @typescript-eslint/no-explicit-any */

// Balances (20270101001200). Leer: pestaña ayf.balances. Escribir: acción
// registrar_movimientos_bancarios. La base vuelve a exigir las dos.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function saldosBancarios(): Promise<SaldoCuenta[]> {
  await requerirAlgunaPestana(PESTANAS_BALANCES)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("saldos_bancarios")
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map(mapSaldoCuenta)
}

export async function extractoCuenta(cuentaId: string, desde: string | null, hasta: string | null): Promise<Extracto> {
  await requerirAlgunaPestana(PESTANAS_BALANCES)
  if (!UUID.test(cuentaId)) throw new Error("Cuenta no válida.")
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) throw new Error("Fecha no válida.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("extracto_cuenta", { p_cuenta_id: cuentaId, p_desde: desde, p_hasta: hasta })
  if (error) throw new Error(error.message)
  return mapExtracto(data)
}

export type FiltrosMovimientos = { cuentaId?: string; tipo?: TipoMovimiento; desde?: string; hasta?: string; eliminados?: boolean }

export async function listarMovimientos(filtros: FiltrosMovimientos, pagina = 0): Promise<{ filas: MovimientoBancario[]; hayMas: boolean }> {
  await requerirAlgunaPestana(PESTANAS_BALANCES)
  if (filtros.cuentaId && !UUID.test(filtros.cuentaId)) throw new Error("Cuenta no válida.")
  if ((filtros.desde && !FECHA.test(filtros.desde)) || (filtros.hasta && !FECHA.test(filtros.hasta))) throw new Error("Fecha no válida.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_movimientos_bancarios", {
    p_cuenta_id: filtros.cuentaId ?? null,
    p_tipo: filtros.tipo ?? null,
    p_desde: filtros.desde ?? null,
    p_hasta: filtros.hasta ?? null,
    p_eliminados: Boolean(filtros.eliminados),
    p_offset: pagina * 50,
    p_limite: 51,
  })
  if (error) throw new Error(error.message)
  const filas = ((data ?? []) as any[]).map(mapMovimiento)
  return { filas: filas.slice(0, 50), hayMas: filas.length > 50 }
}

export async function guardarSaldoInicial(cuentaId: string, saldo: number, fechaCorte: string): Promise<void> {
  await requerirAccion(ACCION_REGISTRAR_MOVIMIENTOS)
  if (!UUID.test(cuentaId)) throw new Error("Cuenta no válida.")
  if (!Number.isFinite(saldo)) throw new Error("Escribe el saldo de inicio.")
  if (!FECHA.test(fechaCorte)) throw new Error("Escoge la fecha de corte.")
  if (fechaCorte > hoyColombia()) throw new Error("La fecha de corte no puede ser futura.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("guardar_saldo_inicial", { p_cuenta_id: cuentaId, p_saldo: saldo, p_fecha_corte: fechaCorte })
  if (error) throw new Error(error.message)
}

type ArchivoSubido = { ruta: string; nombre: string; mime: string }

/**
 * Crea (id null) o edita un movimiento. soporte: undefined = no se toca, null =
 * se quita, objeto = el nuevo (ya subido a balances/<uid>/...).
 */
export async function guardarMovimiento(
  id: string | null,
  form: FormMovimiento,
  soporte?: ArchivoSubido | null
): Promise<{ id: string; codigo: string }> {
  await requerirAccion(ACCION_REGISTRAR_MOVIMIENTOS)
  if (id && !UUID.test(id)) throw new Error("Movimiento no válido.")
  const errores = validarMovimiento(form, hoyColombia())
  const primero = Object.values(errores)[0]
  if (primero) throw new Error(primero)
  const datos: Record<string, unknown> = {
    tipo: form.tipo,
    cuenta_id: form.cuentaId,
    cuenta_destino_id: form.tipo === "traslado" ? form.cuentaDestinoId : null,
    fecha: form.fecha,
    valor: form.valor,
    concepto: form.concepto.trim(),
    titular: form.tipo === "traslado" ? null : form.titular.trim(),
  }
  if (soporte !== undefined) datos.soporte = soporte
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("guardar_movimiento_bancario", { p_id: id, p_datos: datos })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { id: string; codigo: string }
  return { id: r.id, codigo: r.codigo }
}

export async function eliminarMovimiento(id: string, motivo: string): Promise<void> {
  await requerirAccion(ACCION_REGISTRAR_MOVIMIENTOS)
  if (!UUID.test(id)) throw new Error("Movimiento no válido.")
  if (motivo.trim().length < 3) throw new Error("Escribe por qué se elimina.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("eliminar_movimiento_bancario", { p_id: id, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

/** Enlace firmado (2 min) al soporte de un movimiento (Balances o Consolidado Gerencia). */
export async function enlaceSoporteMovimiento(id: string): Promise<string> {
  if (!UUID.test(id)) throw new Error("Movimiento no válido.")
  const supabase = await createClient()
  const { data, error } = await supabase.from("movimientos_bancarios").select("soporte_ruta").eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.soporte_ruta) throw new Error("Este movimiento no tiene soporte o no tienes acceso.")
  const { data: firmado, error: e } = await supabase.storage.from("balances").createSignedUrl(data.soporte_ruta, 120)
  if (e || !firmado) throw new Error("No tienes acceso al soporte.")
  return firmado.signedUrl
}
