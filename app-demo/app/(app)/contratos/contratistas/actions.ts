"use server"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { obtenerPermisosRol, requerirAccion } from "@/lib/permisos"
import {
  DOCUMENTOS_POR_PERSONA,
  MIME_PERMITIDOS,
  TAMANO_MAXIMO,
  validarContratista,
  type Contratista,
  type DatosContratista,
  type TipoDocumentoContratista,
} from "@/lib/contratistas"

const SELECT_CONTRATISTA = `
  id, tipo_persona, tipo_documento, numero_documento, digito_verificacion, nombre,
  representante_nombre, representante_tipo_documento, representante_numero_documento,
  correo, telefono, direccion, ciudad, banco, tipo_cuenta, numero_cuenta, created_at,
  creador:perfiles!contratistas_created_by_fkey(nombre),
  documentos:contratista_documentos(id, tipo, nombre_archivo, tamano, mime, subido_at)
`

function mapContratista(f: any): Contratista {
  return {
    id: f.id,
    tipoPersona: f.tipo_persona,
    tipoDocumento: f.tipo_documento,
    numeroDocumento: f.numero_documento,
    digitoVerificacion: f.digito_verificacion,
    nombre: f.nombre,
    representanteNombre: f.representante_nombre,
    representanteTipoDocumento: f.representante_tipo_documento,
    representanteNumeroDocumento: f.representante_numero_documento,
    correo: f.correo,
    telefono: f.telefono,
    direccion: f.direccion,
    ciudad: f.ciudad,
    banco: f.banco,
    tipoCuenta: f.tipo_cuenta,
    numeroCuenta: f.numero_cuenta,
    creadoPorNombre: f.creador?.nombre ?? null,
    createdAt: f.created_at,
    documentos: ((f.documentos ?? []) as any[]).map((d) => ({
      id: d.id,
      tipo: d.tipo,
      nombreArchivo: d.nombre_archivo,
      tamano: Number(d.tamano),
      mime: d.mime,
      subidoAt: d.subido_at,
    })),
  }
}

// También lo usa Solicitud de contratos para elegir el contratista: basta con
// la pestaña Contratistas o con poder solicitar contratos (igual que la
// política contratistas_select).
export async function listarContratistas(): Promise<Contratista[]> {
  const permisos = await obtenerPermisosRol()
  if (
    !permisos ||
    !(
      permisos.esAdministrador ||
      permisos.pestanas.includes("contratos.contratistas") ||
      permisos.acciones.includes("solicitar_contratos")
    )
  ) {
    throw new Error("No tienes permiso para ver los contratistas.")
  }
  const supabase = await createClient()
  const filas = await traerTodo<any>((desde, hasta) =>
    supabase
      .from("contratistas")
      .select(SELECT_CONTRATISTA)
      .order("nombre", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, hasta)
  )
  return filas.map(mapContratista)
}

export type DocumentoSubido = {
  tipo: TipoDocumentoContratista
  ruta: string
  nombreArchivo: string
  tamano: number
  mime: string
}

// Los archivos ya los subió el navegador a `contratistas/<id>/...`; aquí se
// valida todo otra vez y crear_contratista guarda datos y documentos en una
// sola transacción (y comprueba que cada archivo exista).
export async function crearContratista(
  id: string,
  crudo: DatosContratista,
  documentos: DocumentoSubido[]
): Promise<Contratista> {
  await requerirAccion("gestionar_contratistas")

  const r = validarContratista(crudo)
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa los datos del contratista.")
  const d = r.datos

  const requeridos = DOCUMENTOS_POR_PERSONA[d.tipoPersona]
  const tipos = new Set(documentos.map((x) => x.tipo))
  const faltan = requeridos.filter((x) => x.obligatorio && !tipos.has(x.tipo))
  if (faltan.length > 0) {
    throw new Error(`Faltan documentos: ${faltan.map((x) => x.titulo).join(", ")}.`)
  }
  for (const doc of documentos) {
    if (!doc.ruta.startsWith(`${id}/`)) throw new Error("La ruta de un documento no corresponde a este contratista.")
    if (!MIME_PERMITIDOS.includes(doc.mime) || doc.tamano <= 0 || doc.tamano > TAMANO_MAXIMO) {
      throw new Error(`El archivo "${doc.nombreArchivo}" no es válido (solo PDF, JPG o PNG de hasta 10 MB).`)
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("crear_contratista", {
    p_id: id,
    p_datos: {
      tipo_persona: d.tipoPersona,
      tipo_documento: d.tipoDocumento,
      numero_documento: d.numeroDocumento,
      digito_verificacion: d.digitoVerificacion,
      nombre: d.nombre,
      representante_nombre: d.representanteNombre,
      representante_tipo_documento: d.representanteTipoDocumento,
      representante_numero_documento: d.representanteNumeroDocumento,
      correo: d.correo,
      telefono: d.telefono,
      direccion: d.direccion,
      ciudad: d.ciudad,
      banco: d.banco,
      tipo_cuenta: d.tipoCuenta,
      numero_cuenta: d.numeroCuenta,
    },
    p_documentos: documentos.map((x) => ({
      tipo: x.tipo,
      ruta: x.ruta,
      nombre_archivo: x.nombreArchivo,
      tamano: x.tamano,
      mime: x.mime,
    })),
  })
  if (error) {
    if (error.code === "23505") {
      throw new Error(
        d.tipoPersona === "juridica"
          ? `Ya existe un contratista con el NIT ${d.numeroDocumento}.`
          : `Ya existe un contratista con ${d.tipoDocumento} ${d.numeroDocumento}.`
      )
    }
    throw new Error(error.message)
  }

  const { data, error: errorLeer } = await supabase.from("contratistas").select(SELECT_CONTRATISTA).eq("id", id).single()
  if (errorLeer) throw new Error(errorLeer.message)
  return mapContratista(data)
}

// Enlace temporal (2 minutos) para ver un documento: el bucket es privado.
// También desde Pre-aprobación: Jurídica revisa los documentos generales del
// contratista (igual que la política contratistas_archivos_select).
export async function enlaceDocumentoContratista(documentoId: string): Promise<string> {
  const permisos = await obtenerPermisosRol()
  if (
    !permisos ||
    !(
      permisos.esAdministrador ||
      permisos.pestanas.includes("contratos.contratistas") ||
      permisos.pestanas.includes("contratos.preaprobacion")
    )
  ) {
    throw new Error("No tienes permiso para ver documentos de contratistas.")
  }
  const supabase = await createClient()
  const { data: doc, error } = await supabase
    .from("contratista_documentos")
    .select("ruta")
    .eq("id", documentoId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!doc) throw new Error("El documento no existe o no tienes acceso.")

  const { data, error: errorUrl } = await supabase.storage.from("contratistas").createSignedUrl(doc.ruta, 120)
  if (errorUrl || !data) throw new Error(errorUrl?.message ?? "No se pudo abrir el documento.")
  return data.signedUrl
}
