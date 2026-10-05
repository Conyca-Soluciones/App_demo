"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, requerirAccion } from "@/lib/permisos"
import { validarPresentacion } from "@/lib/unidades"

// Presentación de los insumos (cuánto trae cada unidad de compra: 1 bulto =
// 50 kg). La define quien aprueba insumos; la base vuelve a exigirlo con la
// política maestro_insumos_update (aprobar_insumos). Cambiarla no toca las
// líneas de APU que ya existen: cada línea guardó su factor al crearse,
// igual que su precio congelado.

export async function puedeEditarPresentacion(): Promise<boolean> {
  const permisos = await obtenerPermisosRol()
  return !!permisos && (permisos.esAdministrador || permisos.acciones.includes("aprobar_insumos"))
}

export async function guardarPresentacion(
  insumoId: string,
  unidadUso: string | null,
  contenido: number | string | null
): Promise<{ unidadUso: string | null; contenido: number | null }> {
  await requerirAccion("aprobar_insumos")
  const presentacion = validarPresentacion(unidadUso, contenido)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("maestro_insumos")
    .update({ unidad_uso: presentacion?.unidadUso ?? null, contenido: presentacion?.contenido ?? null })
    .eq("id", insumoId)
    .select("unidad_uso, contenido")
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error("No se encontró el insumo o no tienes permiso para editarlo.")
  return { unidadUso: data[0].unidad_uso, contenido: data[0].contenido == null ? null : Number(data[0].contenido) }
}

/**
 * Acepta varias sugerencias de una vez (las que la pantalla leyó del
 * nombre: "CEMENTO X 50 KG" -> 50 kg). Solo toca insumos que todavía no
 * tienen presentación, para no pisar una que alguien ya corrigió a mano.
 */
export async function aceptarSugerenciasPresentacion(
  sugerencias: { insumoId: string; unidadUso: string; contenido: number }[]
): Promise<{ guardadas: number }> {
  await requerirAccion("aprobar_insumos")
  if (sugerencias.length > 1000) throw new Error("Demasiadas sugerencias de una vez (máximo 1000).")
  const supabase = await createClient()

  // Una actualización por presentación distinta (50 kg, 6 m...), no una por insumo.
  const porPresentacion = new Map<string, { unidadUso: string; contenido: number; ids: string[] }>()
  for (const s of sugerencias) {
    const p = validarPresentacion(s.unidadUso, s.contenido)
    if (!p) continue
    const clave = `${p.unidadUso}|${p.contenido}`
    const grupo = porPresentacion.get(clave) ?? { ...p, ids: [] }
    grupo.ids.push(s.insumoId)
    porPresentacion.set(clave, grupo)
  }

  let guardadas = 0
  for (const grupo of porPresentacion.values()) {
    for (let i = 0; i < grupo.ids.length; i += 200) {
      const { data, error } = await supabase
        .from("maestro_insumos")
        .update({ unidad_uso: grupo.unidadUso, contenido: grupo.contenido })
        .in("id", grupo.ids.slice(i, i + 200))
        .is("unidad_uso", null)
        .select("id")
      if (error) throw new Error(error.message)
      guardadas += data?.length ?? 0
    }
  }
  return { guardadas }
}
