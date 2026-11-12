"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { esEstadoAutorizacionTercero, type AutorizacionTercero, type EstadoAutorizacionTercero } from "@/lib/actas"

/* eslint-disable @typescript-eslint/no-explicit-any */

// Autorizaciones para depositar el pago de un acta a otro tercero
// (20270101000300). La base filtra por los proyectos que ve quien consulta.
export async function listarAutorizacionesTercero(estado: EstadoAutorizacionTercero | null): Promise<AutorizacionTercero[]> {
  await requerirPestana("contratos.autorizar_terceros")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_autorizaciones_tercero", { p_estado: estado })
  if (error) throw new Error(error.message)
  return ((data ?? []) as any[]).map((x) => ({
    actaId: x.acta_id,
    numero: Number(x.numero),
    tipo: x.tipo,
    estadoActa: x.estado,
    estado: esEstadoAutorizacionTercero(x.autorizacion_estado) ? x.autorizacion_estado : "por_revisar",
    motivo: x.autorizacion_motivo ?? null,
    resueltaAt: x.autorizacion_resuelta_at ?? null,
    resueltaPorNombre: x.resuelta_por_nombre ?? null,
    neto: Number(x.neto),
    solicitadaAt: x.solicitada_at,
    creadoPorNombre: x.creado_por_nombre ?? null,
    contratoId: x.contrato_id,
    numeroContrato: x.numero_contrato ?? "",
    contratista: x.contratista ?? "",
    contratistaDocumento: x.contratista_documento ?? null,
    proyecto: x.proyecto ?? null,
    terceroNombre: x.tercero_nombre ?? null,
    terceroDocumento: x.tercero_documento ?? null,
    cuenta: x.cuenta ?? null,
    cuentaVerificada: Boolean(x.cuenta_verificada),
    soportes: ((x.soportes ?? []) as any[]).map((s) => ({
      id: s.id,
      ruta: s.ruta,
      nombreArchivo: s.nombre_archivo,
      mime: s.mime ?? null,
    })),
  }))
}

// Aprobar: el pago pasa a Aprobación de pagos. Rechazar (con motivo): el acta
// queda rechazada y quien la hizo la corrige.
export async function resolverAutorizacionTercero(actaId: string, accion: "aprobar" | "rechazar", motivo?: string) {
  await requerirPestana("contratos.autorizar_terceros")
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolver_autorizacion_acta", {
    p_acta_id: actaId,
    p_accion: accion,
    p_motivo: motivo ?? null,
  })
  if (error) throw new Error(error.message)
}

// Enlace firmado de 2 minutos al archivo de la autorización (la política del
// bucket deja leer a quien ve el acta: actas_select_autorizacion).
export async function enlaceAutorizacionTercero(ruta: string): Promise<string> {
  await requerirPestana("contratos.autorizar_terceros")
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from("actas").createSignedUrl(ruta, 120)
  if (error || !data) throw new Error(error?.message ?? "No se pudo abrir la autorización.")
  return data.signedUrl
}
