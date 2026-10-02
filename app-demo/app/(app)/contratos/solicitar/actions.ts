"use server"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { obtenerPermisosRol, requerirAccion, requerirPestana } from "@/lib/permisos"
import { MIME_PERMITIDOS, TAMANO_MAXIMO } from "@/lib/contratistas"
import {
  TIPO_CONTRATO_POR_VALOR,
  validarSolicitud,
  type ItemPresupuestoContrato,
  type SolicitudContratoForm,
  type TipoDocumentoContrato,
} from "@/lib/contratos"
import {
  SELECT_FILA_CONTRATO,
  cargarDetalleContrato,
  mapFilaContrato,
  type SolicitudContratoDetalle,
  type SolicitudContratoFila,
} from "@/lib/contratos-db"

// Ver el detalle de una solicitud: quien la pide (Solicitud de contratos) o
// quien la revisa (Pre-aprobación). La base además limita por proyecto.
async function requerirVerContratos() {
  const permisos = await obtenerPermisosRol()
  const ok =
    permisos &&
    (permisos.esAdministrador ||
      ["contratos.solicitar", "contratos.preaprobacion", "contratos.contratos"].some((t) => permisos.pestanas.includes(t)))
  if (!ok) throw new Error("No tienes permiso para ver contratos.")
}

// Solicitudes del proyecto actual (la base filtra además por acceso al proyecto).
export async function listarSolicitudesContrato(proyectoId: string): Promise<SolicitudContratoFila[]> {
  await requerirPestana("contratos.solicitar")
  const supabase = await createClient()
  const filas = await traerTodo<any>((desde, hasta) =>
    supabase
      .from("contratos")
      .select(SELECT_FILA_CONTRATO)
      .eq("proyecto_id", proyectoId)
      .order("numero", { ascending: false })
      .range(desde, hasta)
  )
  return filas.map(mapFilaContrato)
}

export async function obtenerSolicitudContrato(id: string): Promise<SolicitudContratoDetalle> {
  await requerirVerContratos()
  const supabase = await createClient()
  return cargarDetalleContrato(supabase, id)
}

export type DocumentoContratoSubido = {
  tipo: TipoDocumentoContrato
  ruta: string
  nombreArchivo: string
  tamano: number
  mime: string
}

// Los archivos ya los subió el navegador a `contratos/<id>/...`. Aquí se
// valida todo otra vez y la base guarda la solicitud en una sola transacción
// (crear_solicitud_contrato / reenviar_solicitud_contrato), en estado
// 'pre_aprobacion'. Devuelve el número.
async function guardarSolicitud(
  modo: "crear" | "reenviar",
  id: string,
  proyectoId: string,
  form: SolicitudContratoForm,
  documentos: DocumentoContratoSubido[]
): Promise<number> {
  await requerirAccion("solicitar_contratos")

  const r = validarSolicitud(form)
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa los datos de la solicitud.")
  const d = r.datos

  const tipo = TIPO_CONTRATO_POR_VALOR.get(d.tipo)!
  const subidos = new Set(documentos.map((x) => x.tipo))
  const faltan = tipo.documentos.filter((x) => x.obligatorio && !subidos.has(x.tipo))
  if (faltan.length > 0) throw new Error(`Faltan documentos: ${faltan.map((x) => x.titulo).join(", ")}.`)
  for (const doc of documentos) {
    if (!doc.ruta.startsWith(`${id}/`)) throw new Error("La ruta de un documento no corresponde a esta solicitud.")
    if (!MIME_PERMITIDOS.includes(doc.mime) || doc.tamano <= 0 || doc.tamano > TAMANO_MAXIMO) {
      throw new Error(`El archivo "${doc.nombreArchivo}" no es válido (solo PDF, JPG o PNG de hasta 10 MB).`)
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc(modo === "crear" ? "crear_solicitud_contrato" : "reenviar_solicitud_contrato", {
    p_id: id,
    p_datos: {
      proyecto_id: proyectoId,
      contratista_id: d.contratistaId,
      tipo: d.tipo,
      objeto: d.objeto,
      valor: d.valor,
      anexo_tipo: d.anexoTipo,
      valor_mensual: d.valorMensual ?? "",
      tiene_anticipo: d.tieneAnticipo,
      anticipo_porcentaje: d.anticipoPorcentaje ?? "",
      forma_pago: d.formaPago,
      plazo_tipo: d.plazoTipo,
      fecha_inicio: d.fechaInicio ?? "",
      fecha_fin: d.fechaFin ?? "",
      duracion_cantidad: d.duracionCantidad ?? "",
      duracion_unidad: d.duracionUnidad ?? "",
      correo_notificacion: d.correoNotificacion,
      observaciones: d.observaciones ?? "",
    },
    p_obligaciones: d.obligaciones,
    p_entregables: d.entregables,
    p_items: d.items.map((i) => ({
      presupuesto_item_id: i.presupuestoItemId,
      cantidad: i.cantidad,
      valor_unitario: i.valorUnitario,
    })),
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

export async function crearSolicitudContrato(
  id: string,
  proyectoId: string,
  form: SolicitudContratoForm,
  documentos: DocumentoContratoSubido[]
): Promise<number> {
  return guardarSolicitud("crear", id, proyectoId, form, documentos)
}

// Corrige una solicitud DEVUELTA y la vuelve a mandar a pre-aprobación (mismo
// número). Reemplaza sus líneas y documentos.
export async function reenviarSolicitudContrato(
  id: string,
  proyectoId: string,
  form: SolicitudContratoForm,
  documentos: DocumentoContratoSubido[]
): Promise<number> {
  return guardarSolicitud("reenviar", id, proyectoId, form, documentos)
}

// Ítems del presupuesto vigente del proyecto que se pueden contratar a
// valores unitarios, con lo disponible (vacío si el proyecto no tiene
// presupuesto). Paginado: la API corta en 1000 filas.
export async function listarItemsPresupuestoContrato(proyectoId: string): Promise<ItemPresupuestoContrato[]> {
  await requerirAccion("solicitar_contratos")
  const supabase = await createClient()
  const filas = await traerTodo<any>((desde, hasta) =>
    supabase.rpc("items_presupuesto_para_contrato", { p_proyecto_id: proyectoId }).range(desde, hasta)
  )
  return filas.map((f) => ({
    id: f.presupuesto_item_id,
    codigo: f.codigo,
    descripcion: f.descripcion,
    unidad: f.unidad,
    cantidad: Number(f.cantidad),
    valorUnitario: Number(f.valor_unitario),
    contratado: Number(f.contratado),
    disponible: Number(f.disponible),
  }))
}

// Enlace temporal (2 minutos) para ver un documento del contrato.
export async function enlaceDocumentoContrato(documentoId: string): Promise<string> {
  await requerirVerContratos()
  const supabase = await createClient()
  const { data: doc, error } = await supabase.from("contrato_documentos").select("ruta").eq("id", documentoId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!doc) throw new Error("El documento no existe o no tienes acceso.")
  const { data, error: errorUrl } = await supabase.storage.from("contratos").createSignedUrl(doc.ruta, 120)
  if (errorUrl || !data) throw new Error(errorUrl?.message ?? "No se pudo abrir el documento.")
  return data.signedUrl
}
