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
} from "@/lib/caja-menor"

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
export async function enviarLegalizacion(id: string | null, gastos: GastoForm[]): Promise<string> {
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
export async function guardarBorrador(gastos: GastoForm[]): Promise<string | null> {
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
export async function descartarBorrador(): Promise<void> {
  const supabase = await clienteResponsable()
  const { data, error } = await supabase.rpc("descartar_borrador_caja_menor")
  if (error) throw new Error(error.message)
  const rutas = ((data ?? []) as string[]).filter(Boolean)
  if (rutas.length > 0) await supabase.storage.from("cajas_menores").remove(rutas)
}

export async function cancelarLegalizacion(id: string, motivo: string): Promise<void> {
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

export async function guardarCajaMenor(id: string | null, caja: CajaMenorForm): Promise<string> {
  const e = validarCajaMenor(caja)
  if (e) throw new Error(e)
  const supabase = await clienteAyf()
  const { data, error } = await supabase.rpc("guardar_caja_menor", { p_id: id, p_datos: cajaParaGuardar(caja) })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function cerrarCajaMenor(id: string, motivo: string): Promise<void> {
  const supabase = await clienteAyf()
  const { error } = await supabase.rpc("cerrar_caja_menor", { p_id: id, p_motivo: motivo })
  if (error) throw new Error(error.message)
}

/** Financiera: pasa a Líder Financiera ("aprobar") o devuelve al responsable. */
export async function revisarLegalizacion(id: string, accion: "aprobar" | "devolver", motivo: string | null): Promise<void> {
  const supabase = await clienteAyf()
  const { error } = await supabase.rpc("revisar_legalizacion_caja_menor", { p_id: id, p_accion: accion, p_motivo: motivo })
  if (error) throw new Error(error.message)
}

/** Líder Financiera: devuelve al responsable. */
export async function devolverLegalizacionLider(id: string, motivo: string): Promise<void> {
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
export async function aprobarLegalizacionLider(id: string): Promise<string> {
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
