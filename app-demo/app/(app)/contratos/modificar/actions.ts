"use server"

import { createClient } from "@/lib/supabase/server"

// Modificar un contrato antes de aprobar su póliza (20270101000400). La base
// revisa permisos (solicitar_contratos / aprobar_contratos, el proyecto y que
// la solicitud sea de quien la pidió) y las condiciones.

export type EstadoModificable = { modificable: boolean; motivo: string | null; esSolicitante: boolean }

export async function contratoModificable(id: string): Promise<EstadoModificable> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("contrato_modificable", { p_id: id })
  if (error) throw new Error(error.message)
  return { modificable: Boolean(data?.modificable), motivo: data?.motivo ?? null, esSolicitante: Boolean(data?.es_solicitante) }
}

// La solicitud vuelve a "devuelta" (Corregir y reenviar) y pasa otra vez por
// Pre-aprobación y Subgerencia.
export async function reabrirSolicitudContrato(id: string, motivo: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reabrir_solicitud_contrato", { p_id: id, p_motivo: motivo })
  if (error) throw new Error(error.message)
}

// La minuta vuelve a Jurídica (devuelta): se edita y se envía otra vez a Subgerencia.
export async function reabrirMinutaContrato(id: string, motivo: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reabrir_minuta_contrato", { p_id: id, p_motivo: motivo })
  if (error) throw new Error(error.message)
}
