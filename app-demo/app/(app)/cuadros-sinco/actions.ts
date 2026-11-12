"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, obtenerUsuarioId, requerirAccion } from "@/lib/permisos"
import type { FilaCuadroSinco, ResumenCuadroSinco } from "@/lib/cuadros-sinco"

/* eslint-disable @typescript-eslint/no-explicit-any */

// Cuadros de pagos de SINCO (20270101002500). Cargar, anular y elegir personas:
// acción cargar_cuadros_sinco (Financiera). Ver un cuadro y adjuntar soportes:
// quien tiene la acción o las personas elegidas (la base lo decide).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACCION = "cargar_cuadros_sinco"

export type CuadroSinco = {
  id: string
  numero: number
  archivo: string
  cargadoEn: string
  cargadoPor: string | null
  filas: number
  total: number
  sinSoporte: number
  anuladoEn: string | null
  motivoAnulacion: string | null
  personas: string | null
}

export type FilaSinco = {
  id: string
  orden: number
  item: number | null
  proyecto: string
  facturaNombre: string
  facturaDocumento: string
  titularNombre: string | null
  banco: string | null
  tipoCuenta: string | null
  numeroCuenta: string | null
  numeroFactura: string | null
  concepto: string | null
  valorDocumento: number | null
  iva: number | null
  anticipos: number | null
  total: number
  observaciones: string | null
  solicita: string | null
  soporteNombre: string | null
  soporteSubidoEn: string | null
  estado: string | null
  liquidacionEstado: string | null
  referencia: string | null
  novedad: string | null
}

export type PersonaCuadro = { id: string; nombre: string; rol: string | null }

export async function puedeCargarCuadrosSinco(): Promise<boolean> {
  const p = await obtenerPermisosRol()
  return Boolean(p && (p.esAdministrador || p.acciones.includes(ACCION)))
}

const num = (v: any) => (v == null ? null : Number(v))

function mapResumen(d: any): ResumenCuadroSinco {
  const lista = (x: any) => (Array.isArray(x) ? x : []).map((e: any) => ({ orden: Number(e.orden ?? 0), mensaje: String(e.mensaje ?? "") }))
  return {
    errores: lista(d?.errores),
    avisos: lista(d?.avisos),
    repetidas: lista(d?.repetidas),
    pagos: Number(d?.pagos ?? 0),
    total: Number(d?.total ?? 0),
    tercerosNuevos: Number(d?.terceros_nuevos ?? 0),
    cuentasNuevas: Number(d?.cuentas_nuevas ?? 0),
    porProyecto: (Array.isArray(d?.por_proyecto) ? d.por_proyecto : []).map((p: any) => ({
      proyecto: String(p.proyecto ?? ""),
      pagos: Number(p.pagos ?? 0),
      total: Number(p.total ?? 0),
    })),
    cuadroId: d?.cuadro_id ?? null,
  }
}

function revisarEntrada(archivo: string, filas: FilaCuadroSinco[]) {
  if (!archivo.trim()) throw new Error("Falta el nombre del archivo.")
  if (filas.length === 0) throw new Error("El cuadro no tiene pagos.")
  if (filas.length > 1000) throw new Error("Como mucho 1000 pagos por cuadro.")
}

/** Revisa el cuadro sin cargar nada: proyectos, repetidos, terceros y cuentas nuevas. */
export async function revisarCuadroSinco(archivo: string, filas: FilaCuadroSinco[]): Promise<ResumenCuadroSinco> {
  await requerirAccion(ACCION)
  revisarEntrada(archivo, filas)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("cargar_cuadro_sinco", {
    p_archivo: archivo,
    p_filas: filas,
    p_usuarios: [],
    p_confirmar: false,
  })
  if (error) throw new Error(error.message)
  return mapResumen(data)
}

export async function cargarCuadroSinco(archivo: string, filas: FilaCuadroSinco[], usuarios: string[]): Promise<ResumenCuadroSinco> {
  await requerirAccion(ACCION)
  revisarEntrada(archivo, filas)
  if (usuarios.length === 0 || usuarios.some((u) => !UUID.test(u))) throw new Error("Elige al menos una persona.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("cargar_cuadro_sinco", {
    p_archivo: archivo,
    p_filas: filas,
    p_usuarios: usuarios,
    p_confirmar: true,
  })
  if (error) throw new Error(error.message)
  return mapResumen(data)
}

export async function listarCuadrosSinco(): Promise<CuadroSinco[]> {
  if (!(await obtenerUsuarioId())) throw new Error("Inicia sesión.")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_cuadros_sinco")
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    numero: Number(c.numero),
    archivo: c.archivo,
    cargadoEn: c.cargado_en,
    cargadoPor: c.cargado_por ?? null,
    filas: Number(c.filas ?? 0),
    total: Number(c.total ?? 0),
    sinSoporte: Number(c.sin_soporte ?? 0),
    anuladoEn: c.anulado_en ?? null,
    motivoAnulacion: c.motivo_anulacion ?? null,
    personas: c.personas ?? null,
  }))
}

export async function obtenerCuadroSinco(
  id: string
): Promise<{ cuadro: CuadroSinco; filas: FilaSinco[]; personas: string[]; puedeAdministrar: boolean } | null> {
  if (!UUID.test(id)) return null
  if (!(await obtenerUsuarioId())) throw new Error("Inicia sesión.")
  const supabase = await createClient()
  const [cuadros, rFilas, rPagos, rPersonas, puedeAdministrar] = await Promise.all([
    listarCuadrosSinco(),
    supabase
      .from("sinco_filas")
      .select(
        "id, orden, item, proyecto_texto, factura_nombre, factura_documento, titular_nombre, banco, tipo_cuenta, numero_cuenta, numero_factura, concepto, valor_documento, iva, anticipos, total, observaciones, solicita, soporte_nombre, soporte_subido_en"
      )
      .eq("cuadro_id", id)
      .order("orden"),
    supabase.rpc("pagos_cuadro_sinco", { p_cuadro: id }),
    supabase.from("sinco_cuadro_usuarios").select("usuario_id").eq("cuadro_id", id),
    puedeCargarCuadrosSinco(),
  ])
  const cuadro = cuadros.find((c) => c.id === id)
  if (!cuadro) return null
  for (const r of [rFilas, rPagos, rPersonas]) if (r.error) throw new Error(r.error.message)
  const pagos = new Map<string, any>(((rPagos.data ?? []) as any[]).map((p) => [p.fila_id, p]))
  const filas: FilaSinco[] = ((rFilas.data ?? []) as any[]).map((f) => {
    const p = pagos.get(f.id)
    return {
      id: f.id,
      orden: Number(f.orden),
      item: f.item ?? null,
      proyecto: f.proyecto_texto ?? "",
      facturaNombre: f.factura_nombre,
      facturaDocumento: f.factura_documento,
      titularNombre: f.titular_nombre ?? null,
      banco: f.banco ?? null,
      tipoCuenta: f.tipo_cuenta ?? null,
      numeroCuenta: f.numero_cuenta ?? null,
      numeroFactura: f.numero_factura ?? null,
      concepto: f.concepto ?? null,
      valorDocumento: num(f.valor_documento),
      iva: num(f.iva),
      anticipos: num(f.anticipos),
      total: Number(f.total),
      observaciones: f.observaciones ?? null,
      solicita: f.solicita ?? null,
      soporteNombre: f.soporte_nombre ?? null,
      soporteSubidoEn: f.soporte_subido_en ?? null,
      estado: p?.estado ?? null,
      liquidacionEstado: p?.liquidacion_estado ?? null,
      referencia: p?.referencia ?? null,
      novedad: p?.novedad ?? null,
    }
  })
  return {
    cuadro,
    filas,
    personas: ((rPersonas.data ?? []) as any[]).map((p) => p.usuario_id as string),
    puedeAdministrar,
  }
}

export async function personasParaCuadroSinco(): Promise<PersonaCuadro[]> {
  await requerirAccion(ACCION)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("usuarios_para_cuadro_sinco")
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol ?? null }))
}

export async function fijarPersonasCuadroSinco(cuadroId: string, usuarios: string[]): Promise<void> {
  await requerirAccion(ACCION)
  if (!UUID.test(cuadroId)) throw new Error("Cuadro no válido.")
  if (usuarios.length === 0 || usuarios.some((u) => !UUID.test(u))) throw new Error("Elige al menos una persona.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("fijar_usuarios_cuadro_sinco", { p_cuadro: cuadroId, p_usuarios: usuarios })
  if (error) throw new Error(error.message)
}

export async function anularCuadroSinco(cuadroId: string, motivo: string): Promise<void> {
  await requerirAccion(ACCION)
  if (!UUID.test(cuadroId)) throw new Error("Cuadro no válido.")
  if (!motivo.trim()) throw new Error("Escribe el motivo.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("anular_cuadro_sinco", { p_cuadro: cuadroId, p_motivo: motivo.trim() })
  if (error) throw new Error(error.message)
}

/** Después de subir el archivo a sinco/<cuadro>/<fila>/...: lo deja como soporte del pago. */
export async function guardarSoporteSinco(filaId: string, soporte: { ruta: string; nombre: string; mime: string }): Promise<void> {
  if (!(await obtenerUsuarioId())) throw new Error("Inicia sesión.")
  if (!UUID.test(filaId)) throw new Error("Pago no válido.")
  const supabase = await createClient()
  const { error } = await supabase.rpc("guardar_soporte_sinco", {
    p_fila: filaId,
    p_ruta: soporte.ruta,
    p_nombre: soporte.nombre,
    p_mime: soporte.mime,
  })
  if (error) throw new Error(error.message)
}

export async function enlaceSoporteSinco(filaId: string): Promise<string> {
  if (!UUID.test(filaId)) throw new Error("Pago no válido.")
  const supabase = await createClient()
  const { data, error } = await supabase.from("sinco_filas").select("soporte_ruta").eq("id", filaId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.soporte_ruta) throw new Error("Este pago no tiene soporte o no tienes acceso.")
  const { data: firmado, error: e } = await supabase.storage.from("sinco").createSignedUrl(data.soporte_ruta, 120)
  if (e || !firmado) throw new Error("No tienes acceso al soporte.")
  return firmado.signedUrl
}
