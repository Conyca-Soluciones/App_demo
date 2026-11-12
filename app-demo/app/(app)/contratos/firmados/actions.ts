"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, requerirAlgunaPestana, requerirPestana } from "@/lib/permisos"
import { PESTANAS_VER_OTROSI } from "@/lib/otrosi"
import {
  mapFirmados,
  validarArchivoFirmado,
  type FirmadosContrato,
} from "@/lib/contratos-firmados"

// ---------------------------------------------------------------------------
// Copia firmada por el contratista (contrato y otrosí) y las actas que se ven
// desde el detalle del contrato. La base revisa todo otra vez
// (20270101001800, 20270101001900).
// ---------------------------------------------------------------------------

type ArchivoSubido = { ruta: string; nombre: string; mime: string; tamano: number }

export async function firmadosDeContrato(contratoId: string): Promise<FirmadosContrato> {
  await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("firmados_de_contrato", { p_contrato_id: contratoId })
  if (error) throw new Error(error.message)
  return mapFirmados(data)
}

// Mismos permisos que pólizas: la pestaña Pólizas (o Administrador).
export async function puedeSubirFirmados(): Promise<boolean> {
  const permisos = await obtenerPermisosRol()
  return Boolean(permisos?.esAdministrador || permisos?.pestanas.includes("contratos.polizas"))
}

// El navegador ya subió el archivo; devuelven la ruta anterior (para borrarla).
export async function subirContratoFirmado(contratoId: string, a: ArchivoSubido): Promise<string | null> {
  await requerirPestana("contratos.polizas")
  const problema = validarArchivoFirmado({ name: a.nombre, size: a.tamano, type: a.mime })
  if (problema) throw new Error(problema)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("subir_contrato_firmado", {
    p_contrato_id: contratoId,
    p_ruta: a.ruta,
    p_nombre: a.nombre,
    p_mime: a.mime,
    p_tamano: a.tamano,
  })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

export async function subirOtrosiFirmado(otrosiId: string, a: ArchivoSubido): Promise<string | null> {
  await requerirPestana("contratos.polizas")
  const problema = validarArchivoFirmado({ name: a.nombre, size: a.tamano, type: a.mime })
  if (problema) throw new Error(problema)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("subir_otrosi_firmado", {
    p_otrosi_id: otrosiId,
    p_ruta: a.ruta,
    p_nombre: a.nombre,
    p_mime: a.mime,
    p_tamano: a.tamano,
  })
  if (error) throw new Error(error.message)
  return (data as string | null) ?? null
}

// Enlace de 2 minutos a una copia firmada del contrato o de uno de sus otrosí.
// Solo rutas que la base dice que son de ese contrato.
export async function enlaceFirmado(contratoId: string, ruta: string): Promise<string> {
  const firmados = await firmadosDeContrato(contratoId)
  const valida = firmados.contrato?.ruta === ruta || Object.values(firmados.otrosis).some((o) => o.ruta === ruta)
  if (!valida) throw new Error("El archivo no es de este contrato.")
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from("contratos").createSignedUrl(ruta, 120)
  if (error || !data) throw new Error(error?.message ?? "No se pudo abrir la copia firmada.")
  return data.signedUrl
}

