"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirAlgunaPestana } from "@/lib/permisos"
import { MAXIMO_CARACTERES_FIRMA } from "@/lib/firmas"
import {
  mapEmpresasRepresentantes,
  mapFirmaRepresentante,
  type EmpresaConRepresentantes,
  type FirmaRepresentanteContrato
} from "@/lib/representantes"

// ---------------------------------------------------------------------------
// Firmas de representantes legales: las adjunta el Administrador (Admin ›
// Empresas, donde se registran los representantes) o Subgerencia (acción
// aprobar_minutas, botón «Adjuntar firma de RL» en Aprobación de contratos).
// Todo pasa por las funciones de 20261201000000_representantes_legales.sql.
// ---------------------------------------------------------------------------

export async function listarRepresentantesLegales(): Promise<EmpresaConRepresentantes[]> {
  await requerirAccion("aprobar_minutas") // el Administrador también pasa
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_representantes_legales")
  if (error) throw new Error(error.message)
  return mapEmpresasRepresentantes(data)
}

// Subgerencia: la firma de un representante y, si usa la app, su usuario.
// Cada campo solo cambia si viene: imagenFirma null = quitarla; perfilId null =
// no usa la app.
export async function guardarFirmaRepresentante(
  id: string,
  cambios: { imagenFirma?: string | null; perfilId?: string | null }
): Promise<void> {
  await requerirAccion("aprobar_minutas")
  const { imagenFirma, perfilId } = cambios
  if (imagenFirma && (!imagenFirma.startsWith("data:image/png;base64,") || imagenFirma.length > MAXIMO_CARACTERES_FIRMA)) {
    throw new Error("La firma no es válida.")
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc("guardar_firma_representante", {
    p_id: id,
    p_datos: {
      ...(imagenFirma !== undefined ? { imagen_firma: imagenFirma } : {}),
      ...(perfilId !== undefined ? { perfil_id: perfilId } : {}),
    },
  })
  if (error) throw new Error(error.message)
}

// Usuarios para enlazar a un representante que usa la app (nombre visible
// para todos, 20261118000000).
export async function listarUsuariosParaRepresentante(): Promise<{ id: string; nombre: string }[]> {
  await requerirAccion("aprobar_minutas")
  const supabase = await createClient()
  const { data, error } = await supabase.from("perfiles").select("id, nombre").order("nombre").limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []).map((p) => ({ id: p.id as string, nombre: (p.nombre as string) ?? "(sin nombre)" }))
}

// Quién firmaría como representante legal si se aprueba la minuta ahora.
export async function firmaRepresentanteContrato(contratoId: string): Promise<FirmaRepresentanteContrato> {
  await requerirAlgunaPestana(["contratos.preaprobacion", "contratos.aprobar_minutas"])
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("representante_que_firma", { p_contrato_id: contratoId })
  if (error) throw new Error(error.message)
  return mapFirmaRepresentante(data)
}
