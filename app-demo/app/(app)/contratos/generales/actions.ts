"use server"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import { validarContratoGeneral, type ContratoGeneralForm } from "@/lib/contratos"
import { SELECT_FILA_CONTRATO, mapFilaContrato, type SolicitudContratoFila } from "@/lib/contratos-db"
import type { DocumentoContratoSubido } from "@/app/(app)/contratos/solicitar/actions"

// ---------------------------------------------------------------------------
// Contratos generales (pestaña contratos.contratos): contratos sin ítems del
// presupuesto, como el "Contrato General" de Sinco. Mismo camino que por
// grupos (Jurídica pre-aprueba, Subgerencia aprueba); la base guarda y valida
// en crear_contrato_general / reenviar_contrato_general
// (20261113000000_contratos_generales.sql).
// ---------------------------------------------------------------------------

// Contratos generales del proyecto actual (la base filtra además por acceso).
export async function listarContratosGenerales(proyectoId: string): Promise<SolicitudContratoFila[]> {
  await requerirPestana("contratos.contratos")
  const supabase = await createClient()
  const filas = await traerTodo<Record<string, unknown>>((desde, hasta) =>
    supabase
      .from("contratos")
      .select(SELECT_FILA_CONTRATO)
      .eq("proyecto_id", proyectoId)
      .eq("clase", "general")
      .order("numero", { ascending: false })
      .range(desde, hasta)
  )
  return filas.map(mapFilaContrato)
}

async function guardar(
  modo: "crear" | "reenviar",
  id: string,
  proyectoId: string,
  form: ContratoGeneralForm,
  documentos: DocumentoContratoSubido[]
): Promise<number> {
  await requerirAccion("solicitar_contratos")
  const r = validarContratoGeneral(form)
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa el contrato.")
  const d = r.datos
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(modo === "crear" ? "crear_contrato_general" : "reenviar_contrato_general", {
    p_id: id,
    p_datos: {
      proyecto_id: proyectoId,
      tipo: d.tipo,
      contratista_id: d.contratistaId,
      objeto: d.objeto,
      valor: d.valor,
      fecha_inicio: d.fechaInicio,
      fecha_fin: d.fechaFin,
      forma_pago: d.formaPago,
      retencion_garantia_pct: d.retencionGarantiaPct,
      retencion_anticipo_pct: d.retencionAnticipoPct,
      retencion_fic_pct: d.retencionFicPct,
      referencia: d.referencia,
      correo_notificacion: d.correoNotificacion,
      observaciones: d.observaciones,
      requiere_poliza: d.requierePoliza,
    },
    p_documentos: documentos.map((x) => ({
      tipo: x.tipo,
      ruta: x.ruta,
      nombre_archivo: x.nombreArchivo,
      tamano: x.tamano,
      mime: x.mime,
    })),
  })
  if (error) throw new Error(error.message)
  return Number(data)
}

export async function crearContratoGeneral(
  id: string,
  proyectoId: string,
  form: ContratoGeneralForm,
  documentos: DocumentoContratoSubido[]
): Promise<number> {
  return guardar("crear", id, proyectoId, form, documentos)
}

// Corrige un contrato general DEVUELTO y lo vuelve a mandar a pre-aprobación
// (mismo número). Reemplaza sus documentos.
export async function reenviarContratoGeneral(
  id: string,
  proyectoId: string,
  form: ContratoGeneralForm,
  documentos: DocumentoContratoSubido[]
): Promise<number> {
  return guardar("reenviar", id, proyectoId, form, documentos)
}
