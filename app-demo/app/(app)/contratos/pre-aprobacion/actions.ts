"use server"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import type { EstadoContrato } from "@/lib/contratos"
import { SELECT_FILA_CONTRATO, cargarDetalleContrato, mapFilaContrato, type SolicitudContratoFila } from "@/lib/contratos-db"
import { hoyColombia } from "@/lib/fechas"
import { limpiarMinuta, mezclarMinuta, minutaPorDefecto, type MinutaManoObra } from "@/lib/minuta-mano-obra"

// ---------------------------------------------------------------------------
// Pre-aprobación de contratos: Jurídica revisa las solicitudes de TODOS los
// proyectos que puede ver (no solo el proyecto actual), y las aprueba,
// devuelve o rechaza. La base valida permiso, proyecto y estado
// (resolver_solicitud_contrato, 20261014000000_preaprobacion_contratos.sql).
// ---------------------------------------------------------------------------

export type FiltrosPreaprobacion = {
  estado?: EstadoContrato // sin estado = todas
  proyectoId?: string
}

export async function listarSolicitudesPreaprobacion(filtros: FiltrosPreaprobacion): Promise<SolicitudContratoFila[]> {
  await requerirPestana("contratos.preaprobacion")
  const supabase = await createClient()
  const filas = await traerTodo<any>((desde, hasta) => {
    let q = supabase.from("contratos").select(SELECT_FILA_CONTRATO)
    if (filtros.estado) q = q.eq("estado", filtros.estado)
    if (filtros.proyectoId) q = q.eq("proyecto_id", filtros.proyectoId)
    // Las que esperan revisión: primero las más antiguas (orden de llegada).
    return q
      .order("enviado_at", { ascending: filtros.estado === "pre_aprobacion" })
      .order("id", { ascending: true })
      .range(desde, hasta)
  })
  return filas.map(mapFilaContrato)
}

export type AccionPreaprobacion = "aprobar" | "devolver" | "rechazar"

export async function resolverSolicitudContrato(id: string, accion: AccionPreaprobacion, motivo?: string): Promise<void> {
  await requerirAccion("aprobar_contratos")
  if ((accion === "devolver" || accion === "rechazar") && !motivo?.trim()) {
    throw new Error("Escribe el motivo.")
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_solicitud_contrato", {
    p_id: id,
    p_accion: accion,
    p_motivo: motivo?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

// ---------------------------------------------------------------- minuta
// La minuta se arma con los datos de la solicitud (minutaPorDefecto) y encima
// lo que Jurídica ya guardó (contratos.minuta_datos,
// 20261015000000_minuta_contratos.sql).

export type MinutaContrato = {
  minuta: MinutaManoObra
  porDefecto: MinutaManoObra // solo con los datos de la solicitud (para "Restablecer")
  guardadaAt: string | null
  guardadaPorNombre: string | null
}

export async function obtenerMinutaContrato(id: string): Promise<MinutaContrato> {
  await requerirPestana("contratos.preaprobacion")
  const supabase = await createClient()
  const [detalle, extra, guardada] = await Promise.all([
    cargarDetalleContrato(supabase, id),
    supabase
      .from("contratos")
      .select(`
        proyecto:proyectos!contratos_proyecto_id_fkey(ciudad, empresa:empresas(nit, razon_social)),
        contratista:contratistas!contratos_contratista_id_fkey(
          tipo_documento, numero_documento, digito_verificacion, representante_nombre, representante_numero_documento, ciudad
        )
      `)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contratos")
      .select("minuta_datos, minuta_actualizada_at, editor:perfiles!contratos_minuta_actualizada_por_fkey(nombre)")
      .eq("id", id)
      .maybeSingle(),
  ])
  if (extra.error) throw new Error(extra.error.message)
  if (guardada.error) throw new Error(guardada.error.message)

  const x = extra.data as any
  const c = x?.contratista
  const defecto = minutaPorDefecto(
    detalle,
    {
      proyectoCiudad: x?.proyecto?.ciudad ?? null,
      empresaNombre: x?.proyecto?.empresa?.razon_social ?? null,
      empresaNit: x?.proyecto?.empresa?.nit ?? null,
      contratistaTipoDocumento: c?.tipo_documento ?? null,
      contratistaNumeroDocumento: c?.numero_documento ?? null,
      contratistaDv: c?.digito_verificacion ?? null,
      contratistaRepresentante: c?.representante_nombre ?? null,
      contratistaRepresentanteDocumento: c?.representante_numero_documento ?? null,
      contratistaCiudad: c?.ciudad ?? null,
    },
    hoyColombia()
  )
  const g = guardada.data as any
  return {
    minuta: mezclarMinuta(defecto, g?.minuta_datos),
    porDefecto: defecto,
    guardadaAt: g?.minuta_actualizada_at ?? null,
    guardadaPorNombre: g?.editor?.nombre ?? null,
  }
}

export async function guardarMinutaContrato(id: string, minuta: MinutaManoObra): Promise<{ guardadaAt: string }> {
  await requerirAccion("aprobar_contratos")
  const supabase = await createClient()
  const { error } = await supabase.rpc("guardar_minuta_contrato", { p_id: id, p_datos: limpiarMinuta(minuta) })
  if (error) throw new Error(error.message)
  return { guardadaAt: new Date().toISOString() }
}
