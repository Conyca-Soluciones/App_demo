"use server"

// Informes de pagos (pestaña ayf.informes, 2026-11-25). Lo que cada quien ve lo decide la
// RLS: un dispersor se lee si tiene algún pago que la persona ve (dispersiones_select), y
// su soporte PDF con la misma regla en el bucket (dispersores_archivos_select).

import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { traerTodo } from "@/lib/supabase/traer-todo"

const PESTANA = "ayf.informes"
const BUCKET = "dispersores"

export type FiltrosInformeDispersores = { anios?: number[]; semanas?: number[] }

export type DispersorGenerado = {
  id: string
  apodo: string
  banco: string
  anio: number | null
  semana: number | null
  esNomina: boolean
  secuencia: string
  ronda: number
  registros: number
  total: number
  generadoEn: string
  generadoPor: string | null
  soporteNombre: string | null
}

function enteros(lista: number[] | undefined, min: number, max: number): number[] {
  const unicos = [...new Set(lista ?? [])]
  if (unicos.length > 53 || unicos.some((n) => !Number.isInteger(n) || n < min || n > max)) {
    throw new Error("El filtro de semanas no es válido.")
  }
  return unicos
}

export async function listarDispersoresGenerados(filtros: FiltrosInformeDispersores): Promise<DispersorGenerado[]> {
  await requerirPestana(PESTANA)
  const supabase = await createClient()
  const anios = enteros(filtros.anios, 2020, 2100)
  const semanas = enteros(filtros.semanas, 1, 53)
  const filas = await traerTodo<any>((desde, hasta) => {
    let q: any = supabase
      .from("dispersiones")
      .select(
        "id, apodo, banco, anio, semana, es_nomina, secuencia, ronda, registros, total, generado_en, soporte_nombre, autor:perfiles!dispersiones_generado_por_fkey(nombre)"
      )
    if (anios.length > 0) q = q.in("anio", anios)
    if (semanas.length > 0) q = q.in("semana", semanas)
    return q.order("generado_en", { ascending: false }).order("id", { ascending: true }).range(desde, hasta)
  })
  return filas.map((d) => ({
    id: d.id,
    apodo: d.apodo,
    banco: d.banco,
    anio: d.anio,
    semana: d.semana,
    esNomina: d.es_nomina,
    secuencia: d.secuencia,
    ronda: d.ronda,
    registros: d.registros,
    total: Number(d.total),
    generadoEn: d.generado_en,
    generadoPor: d.autor?.nombre ?? null,
    soporteNombre: d.soporte_nombre ?? null,
  }))
}

/** Enlace de 2 minutos al soporte PDF de un dispersor (la RLS y la política del bucket deciden). */
export async function enlaceSoporteDispersor(
  dispersionId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    await requerirPestana(PESTANA)
    const supabase = await createClient()
    const { data: d, error } = await supabase
      .from("dispersiones")
      .select("soporte_ruta, soporte_nombre")
      .eq("id", dispersionId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!d?.soporte_ruta) throw new Error("Este dispersor no tiene soporte o no tienes acceso.")
    const nombre = d.soporte_nombre ?? d.soporte_ruta.split("/").pop() ?? "soporte.pdf"
    const { data, error: errUrl } = await supabase.storage.from(BUCKET).createSignedUrl(d.soporte_ruta, 120, { download: nombre })
    if (errUrl || !data) throw new Error("No se pudo abrir el soporte.")
    return { ok: true, url: data.signedUrl }
  } catch (e) {
    // Se devuelve el mensaje: en producción Next.js esconde el de un error lanzado.
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo abrir el soporte." }
  }
}
