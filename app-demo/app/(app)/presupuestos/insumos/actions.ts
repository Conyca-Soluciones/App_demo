"use server"

import { createClient } from "@/lib/supabase/server"
import { obtenerPermisosRol, requerirAccion } from "@/lib/permisos"
import { hoyColombia } from "@/lib/fechas"
import type { ResultadoAccion } from "@/lib/caja-menor"
import {
  cambiosInsumo,
  validarEdicionInsumo,
  type CamposInsumo,
  type FormularioInsumo,
} from "@/lib/editar-insumo"

// ---------------------------------------------------------------------------
// Editar un insumo de la Maestra de insumos (lib/editar-insumo.ts). Edita quien
// tiene la acción aprobar_insumos (la política maestro_insumos_update exige lo
// mismo); el código no se cambia (disparador trg_insumo_codigo_fijo), vr_neto
// lo calcula maestro_insumos_vr_neto y cada cambio queda en el historial
// (trg_historial_insumo, 20270101007800). No toca los APU.
// ---------------------------------------------------------------------------

const ACCION = "aprobar_insumos"
const COLUMNAS =
  "id, codigo, descripcion, tipo, u_m, agrupacion, vr_unitario, iva_porcentaje, vr_neto, excluye_iva, iva_descontable, usuario_modificacion, fecha_modificacion"

export type InsumoMaestra = CamposInsumo & {
  id: string
  codigo: number
  vr_neto: number | null
  usuario_modificacion: string | null
  fecha_modificacion: string | null
}

/** ¿Quien consulta puede editar insumos? (decide si sale el botón "Editar"). */
export async function puedeEditarInsumos(): Promise<boolean> {
  const p = await obtenerPermisosRol()
  return Boolean(p && (p.esAdministrador || p.acciones.includes(ACCION)))
}

/** Todos los datos de un insumo para la ventana (también los que la tabla no trae). */
export async function obtenerInsumoMaestra(id: string): Promise<ResultadoAccion<InsumoMaestra>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("maestro_insumos").select(COLUMNAS).eq("id", id).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: "No se encontró el insumo." }
  return { ok: true, valor: data as InsumoMaestra }
}

export async function editarInsumoMaestra(
  id: string,
  formulario: FormularioInsumo
): Promise<ResultadoAccion<InsumoMaestra>> {
  try {
    const { id: usuarioId } = await requerirAccion(ACCION)
    const supabase = await createClient()

    const validacion = validarEdicionInsumo(formulario)
    if (!validacion.ok) {
      return { ok: false, error: Object.values(validacion.errores)[0] ?? "Revisa los datos del insumo." }
    }
    const valores = validacion.valores

    const { data: actual, error: errorActual } = await supabase
      .from("maestro_insumos")
      .select(COLUMNAS)
      .eq("id", id)
      .maybeSingle()
    if (errorActual) return { ok: false, error: errorActual.message }
    if (!actual) return { ok: false, error: "No se encontró el insumo." }

    const cambios = cambiosInsumo(actual as InsumoMaestra, valores)
    if (Object.keys(cambios).length === 0) return { ok: true, valor: actual as InsumoMaestra }

    // La agrupación tiene que ser una de las que ya usa el maestro.
    if (cambios.agrupacion !== undefined) {
      const { data: hay, error } = await supabase
        .from("maestro_insumos")
        .select("id")
        .eq("agrupacion", valores.agrupacion as string)
        .limit(1)
      if (error) return { ok: false, error: error.message }
      if (!hay || hay.length === 0) return { ok: false, error: "Elige una agrupación de la lista." }
    }

    // Mismo nombre que OTRO insumo del maestro = duplicado (como al aprobar).
    if (cambios.descripcion !== undefined) {
      const { data: repetido, error } = await supabase
        .from("maestro_insumos")
        .select("codigo, descripcion")
        .ilike("descripcion", valores.descripcion.replace(/[\\%_]/g, (c: string) => `\\${c}`))
        .neq("id", id)
        .limit(1)
      if (error) return { ok: false, error: error.message }
      if (repetido && repetido.length > 0) {
        return {
          ok: false,
          error: `Ya existe en el maestro "${repetido[0].descripcion}" (código ${repetido[0].codigo}). Cambia el nombre.`,
        }
      }
    }

    const { data: perfil } = await supabase.from("perfiles").select("nombre").eq("id", usuarioId).maybeSingle()

    const { data, error } = await supabase
      .from("maestro_insumos")
      .update({
        ...cambios,
        usuario_modificacion: perfil?.nombre ?? usuarioId,
        fecha_modificacion: hoyColombia(),
      })
      .eq("id", id)
      .select(COLUMNAS)
      .maybeSingle()
    if (error) return { ok: false, error: error.message }
    // RLS no da error al bloquear un UPDATE: vuelve sin fila.
    if (!data) return { ok: false, error: "No tienes permiso para editar insumos." }
    return { ok: true, valor: data as InsumoMaestra }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo guardar el insumo." }
  }
}
