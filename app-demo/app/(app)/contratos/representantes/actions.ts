"use server"

import { createClient } from "@/lib/supabase/server"
import { requerirAccion, requerirAlgunaPestana, requerirPestana } from "@/lib/permisos"
import { MAXIMO_CARACTERES_FIRMA } from "@/lib/firmas"
import {
  mapEmpresasRepresentantes,
  mapFirmaRepresentante,
  mapRepresentante,
  soloDigitos,
  validarRepresentante,
  type DatosRepresentante,
  type EmpresaConRepresentantes,
  type FirmaRepresentanteContrato,
  type RepresentanteLegal,
} from "@/lib/representantes"

// ---------------------------------------------------------------------------
// Representantes legales (pestaña contratos.representantes; registrar y
// cambiar exige la acción aprobar_minutas, Subgerencia). Todo pasa por las
// funciones de 20261201000000_representantes_legales.sql.
// ---------------------------------------------------------------------------

export async function listarRepresentantesLegales(): Promise<EmpresaConRepresentantes[]> {
  await requerirPestana("contratos.representantes")
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("listar_representantes_legales")
  if (error) throw new Error(error.message)
  return mapEmpresasRepresentantes(data)
}

// imagenFirma: undefined = no cambia; null = quitarla; texto = PNG nuevo.
export async function guardarRepresentanteLegal(
  id: string | null,
  empresaId: string,
  datos: DatosRepresentante,
  imagenFirma?: string | null
): Promise<string> {
  await requerirAccion("aprobar_minutas")
  const problema = validarRepresentante(datos)
  if (problema) throw new Error(problema)
  if (imagenFirma && (!imagenFirma.startsWith("data:image/png;base64,") || imagenFirma.length > MAXIMO_CARACTERES_FIRMA)) {
    throw new Error("La firma no es válida.")
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("guardar_representante_legal", {
    p_id: id,
    p_empresa_id: empresaId,
    p_datos: {
      tipo: datos.tipo,
      nombre: datos.nombre.trim(),
      tipo_documento: datos.tipoDocumento,
      numero_documento: soloDigitos(datos.numeroDocumento),
      expedida_en: datos.expedidaEn.trim(),
      perfil_id: datos.perfilId,
      ...(imagenFirma !== undefined ? { imagen_firma: imagenFirma } : {}),
    },
  })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function desactivarRepresentanteLegal(id: string): Promise<void> {
  await requerirAccion("aprobar_minutas")
  const supabase = await createClient()
  const { error } = await supabase.rpc("desactivar_representante_legal", { p_id: id })
  if (error) throw new Error(error.message)
}

// Usuarios para enlazar a un representante que usa la app (nombre visible
// para todos, 20261118000000).
export async function listarUsuariosParaRepresentante(): Promise<{ id: string; nombre: string }[]> {
  await requerirPestana("contratos.representantes")
  const supabase = await createClient()
  const { data, error } = await supabase.from("perfiles").select("id, nombre").order("nombre").limit(1000)
  if (error) throw new Error(error.message)
  return (data ?? []).map((p) => ({ id: p.id as string, nombre: (p.nombre as string) ?? "(sin nombre)" }))
}

// Representantes activos de la empresa del contrato (minuta: Jurídica y Subgerencia).
export async function representantesDeContrato(contratoId: string): Promise<RepresentanteLegal[]> {
  await requerirAlgunaPestana(["contratos.preaprobacion", "contratos.aprobar_minutas"])
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("representantes_de_contrato", { p_contrato_id: contratoId })
  if (error) throw new Error(error.message)
  return (Array.isArray(data) ? data : []).map(mapRepresentante)
}

// Quién firmaría como representante legal si se aprueba la minuta ahora.
export async function firmaRepresentanteContrato(contratoId: string): Promise<FirmaRepresentanteContrato> {
  await requerirAlgunaPestana(["contratos.preaprobacion", "contratos.aprobar_minutas"])
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("representante_que_firma", { p_contrato_id: contratoId })
  if (error) throw new Error(error.message)
  return mapFirmaRepresentante(data)
}
