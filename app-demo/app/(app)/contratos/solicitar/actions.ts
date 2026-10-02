"use server"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { requerirAccion, requerirPestana } from "@/lib/permisos"
import { MIME_PERMITIDOS, TAMANO_MAXIMO } from "@/lib/contratistas"
import {
  TIPO_CONTRATO_POR_VALOR,
  validarSolicitud,
  type EstadoContrato,
  type SolicitudContratoForm,
  type TipoContrato,
  type TipoDocumentoContrato,
} from "@/lib/contratos"

export type SolicitudContratoFila = {
  id: string
  numero: number
  tipo: TipoContrato
  estado: EstadoContrato
  contratistaNombre: string
  contratistaDocumento: string
  objeto: string
  valor: number
  plazoTipo: "fechas" | "duracion"
  fechaInicio: string | null
  fechaFin: string | null
  duracionCantidad: number | null
  duracionUnidad: "dias" | "meses" | null
  solicitadoPorNombre: string | null
  createdAt: string
}

export type SolicitudContratoDetalle = SolicitudContratoFila & {
  contratistaId: string
  contratistaCorreo: string
  anexoTipo: "valor_global" | "valores_unitarios"
  tieneAnticipo: boolean
  anticipoPorcentaje: number | null
  formaPago: string
  correoNotificacion: string
  observaciones: string | null
  obligaciones: string[]
  entregables: string[]
  items: { actividad: string; unidad: string; cantidad: number; valorUnitario: number }[]
  documentos: { id: string; tipo: TipoDocumentoContrato; nombreArchivo: string; mime: string }[]
}

const SELECT_FILA = `
  id, numero, tipo, estado, objeto, valor, plazo_tipo, fecha_inicio, fecha_fin, duracion_cantidad,
  duracion_unidad, created_at,
  contratista:contratistas!contratos_contratista_id_fkey(id, nombre, tipo_documento, numero_documento, digito_verificacion, correo),
  solicitante:perfiles!contratos_solicitado_por_fkey(nombre)
`

function mapFila(f: any): SolicitudContratoFila {
  const c = f.contratista
  return {
    id: f.id,
    numero: Number(f.numero),
    tipo: f.tipo,
    estado: f.estado,
    contratistaNombre: c?.nombre ?? "(contratista eliminado)",
    contratistaDocumento: c
      ? c.tipo_documento === "NIT"
        ? `NIT ${c.numero_documento}-${c.digito_verificacion ?? ""}`
        : `${c.tipo_documento} ${c.numero_documento}`
      : "",
    objeto: f.objeto,
    valor: Number(f.valor),
    plazoTipo: f.plazo_tipo,
    fechaInicio: f.fecha_inicio,
    fechaFin: f.fecha_fin,
    duracionCantidad: f.duracion_cantidad,
    duracionUnidad: f.duracion_unidad,
    solicitadoPorNombre: f.solicitante?.nombre ?? null,
    createdAt: f.created_at,
  }
}

// Solicitudes del proyecto actual (la base filtra además por acceso al proyecto).
export async function listarSolicitudesContrato(proyectoId: string): Promise<SolicitudContratoFila[]> {
  await requerirPestana("contratos.solicitar")
  const supabase = await createClient()
  const filas = await traerTodo<any>((desde, hasta) =>
    supabase
      .from("contratos")
      .select(SELECT_FILA)
      .eq("proyecto_id", proyectoId)
      .order("numero", { ascending: false })
      .range(desde, hasta)
  )
  return filas.map(mapFila)
}

export async function obtenerSolicitudContrato(id: string): Promise<SolicitudContratoDetalle> {
  await requerirPestana("contratos.solicitar")
  const supabase = await createClient()
  const { data: f, error } = await supabase
    .from("contratos")
    .select(`
      ${SELECT_FILA},
      anexo_tipo, tiene_anticipo, anticipo_porcentaje, forma_pago, correo_notificacion, observaciones,
      obligaciones:contrato_obligaciones(orden, texto),
      entregables:contrato_entregables(orden, texto),
      items:contrato_anexo_items(orden, actividad, unidad, cantidad, valor_unitario),
      documentos:contrato_documentos(id, tipo, nombre_archivo, mime)
    `)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!f) throw new Error("La solicitud no existe o no tienes acceso.")

  const porOrden = (a: { orden: number }, b: { orden: number }) => a.orden - b.orden
  return {
    ...mapFila(f),
    contratistaId: (f as any).contratista?.id,
    contratistaCorreo: (f as any).contratista?.correo ?? "",
    anexoTipo: (f as any).anexo_tipo,
    tieneAnticipo: (f as any).tiene_anticipo,
    anticipoPorcentaje: (f as any).anticipo_porcentaje === null ? null : Number((f as any).anticipo_porcentaje),
    formaPago: (f as any).forma_pago,
    correoNotificacion: (f as any).correo_notificacion,
    observaciones: (f as any).observaciones,
    obligaciones: [...((f as any).obligaciones ?? [])].sort(porOrden).map((o: any) => o.texto),
    entregables: [...((f as any).entregables ?? [])].sort(porOrden).map((e: any) => e.texto),
    items: [...((f as any).items ?? [])].sort(porOrden).map((i: any) => ({
      actividad: i.actividad,
      unidad: i.unidad,
      cantidad: Number(i.cantidad),
      valorUnitario: Number(i.valor_unitario),
    })),
    documentos: ((f as any).documentos ?? []).map((d: any) => ({ id: d.id, tipo: d.tipo, nombreArchivo: d.nombre_archivo, mime: d.mime })),
  }
}

export type DocumentoContratoSubido = {
  tipo: TipoDocumentoContrato
  ruta: string
  nombreArchivo: string
  tamano: number
  mime: string
}

// Los archivos ya los subió el navegador a `contratos/<id>/...`. Aquí se
// valida todo otra vez y crear_solicitud_contrato guarda la solicitud en una
// sola transacción, en estado 'pre_aprobacion'. Devuelve el número.
export async function crearSolicitudContrato(
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
  const { data, error } = await supabase.rpc("crear_solicitud_contrato", {
    p_id: id,
    p_datos: {
      proyecto_id: proyectoId,
      contratista_id: d.contratistaId,
      tipo: d.tipo,
      objeto: d.objeto,
      valor: d.valor,
      anexo_tipo: d.anexoTipo,
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
      actividad: i.actividad,
      unidad: i.unidad,
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

// Enlace temporal (2 minutos) para ver un documento del contrato.
export async function enlaceDocumentoContrato(documentoId: string): Promise<string> {
  await requerirPestana("contratos.solicitar")
  const supabase = await createClient()
  const { data: doc, error } = await supabase.from("contrato_documentos").select("ruta").eq("id", documentoId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!doc) throw new Error("El documento no existe o no tienes acceso.")
  const { data, error: errorUrl } = await supabase.storage.from("contratos").createSignedUrl(doc.ruta, 120)
  if (errorUrl || !data) throw new Error(errorUrl?.message ?? "No se pudo abrir el documento.")
  return data.signedUrl
}
