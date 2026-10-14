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

// Sin banco, tipo_cuenta ni numero_cuenta: nadie los lee de la tabla
// (20261115100000_seguridad_documentos_y_datos_bancarios.sql); quien tiene la
// acción ver_datos_bancarios los pide aparte (conDatosBancarios).
const SELECT_CONTRATISTA = `
  id, tipo_persona, tipo_documento, numero_documento, digito_verificacion, nombre,
  representante_nombre, representante_tipo_documento, representante_numero_documento, cedula_expedida_en,
  correo, telefono, direccion, ciudad, created_at,
  updated_at, updated_by,
  creador:perfiles!contratistas_created_by_fkey(nombre),
  editor:perfiles!contratistas_updated_by_fkey(nombre),
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
    cedulaExpedidaEn: f.cedula_expedida_en ?? null,
    correo: f.correo,
    telefono: f.telefono,
    direccion: f.direccion,
    ciudad: f.ciudad,
    banco: "",
    tipoCuenta: "ahorros",
    numeroCuenta: "",
    datosBancariosVisibles: false,
    creadoPorNombre: f.creador?.nombre ?? null,
    createdAt: f.created_at,
    // updated_at se llena también al crear: solo cuenta si alguien editó.
    editadoAt: f.updated_by ? f.updated_at : null,
    editadoPorNombre: f.updated_by ? (f.editor?.nombre ?? null) : null,
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
async function puedeVerDatosBancarios(): Promise<boolean> {
  const permisos = await obtenerPermisosRol()
  return Boolean(permisos && (permisos.esAdministrador || permisos.acciones.includes("ver_datos_bancarios")))
}

// Completa banco y cuenta si quien pregunta tiene la acción (una sola llamada
// para toda la lista).
async function conDatosBancarios(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lista: Contratista[]
): Promise<Contratista[]> {
  if (lista.length === 0 || !(await puedeVerDatosBancarios())) return lista
  const { data, error } = await supabase.rpc("datos_bancarios_contratistas", { p_ids: lista.map((c) => c.id) })
  if (error) throw new Error(error.message)
  const porId = new Map(
    ((data ?? []) as { contratista_id: string; banco: string; tipo_cuenta: string; numero_cuenta: string }[]).map((b) => [b.contratista_id, b])
  )
  return lista.map((c) => {
    const b = porId.get(c.id)
    return b
      ? { ...c, banco: b.banco, tipoCuenta: b.tipo_cuenta as Contratista["tipoCuenta"], numeroCuenta: b.numero_cuenta, datosBancariosVisibles: true }
      : c
  })
}

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
  return conDatosBancarios(supabase, filas.map(mapContratista))
}

export type DocumentoSubido = {
  tipo: TipoDocumentoContratista
  ruta: string
  nombreArchivo: string
  tamano: number
  mime: string
}

// Datos y documentos con los nombres de columna de la base (crear y editar).
function datosParaBase(d: DatosContratista) {
  return {
    tipo_persona: d.tipoPersona,
    tipo_documento: d.tipoDocumento,
    numero_documento: d.numeroDocumento,
    digito_verificacion: d.digitoVerificacion,
    nombre: d.nombre,
    representante_nombre: d.representanteNombre,
    representante_tipo_documento: d.representanteTipoDocumento,
    representante_numero_documento: d.representanteNumeroDocumento,
    cedula_expedida_en: d.cedulaExpedidaEn,
    correo: d.correo,
    telefono: d.telefono,
    direccion: d.direccion,
    ciudad: d.ciudad,
    banco: d.banco,
    tipo_cuenta: d.tipoCuenta,
    numero_cuenta: d.numeroCuenta,
  }
}

const documentosParaBase = (documentos: DocumentoSubido[]) =>
  documentos.map((x) => ({ tipo: x.tipo, ruta: x.ruta, nombre_archivo: x.nombreArchivo, tamano: x.tamano, mime: x.mime }))

function validarArchivosSubidos(id: string, documentos: DocumentoSubido[]) {
  for (const doc of documentos) {
    if (!doc.ruta.startsWith(`${id}/`)) throw new Error("La ruta de un documento no corresponde a este contratista.")
    if (!MIME_PERMITIDOS.includes(doc.mime) || doc.tamano <= 0 || doc.tamano > TAMANO_MAXIMO) {
      throw new Error(`El archivo "${doc.nombreArchivo}" no es válido (solo PDF, JPG o PNG de hasta 10 MB).`)
    }
  }
}

function errorDeBase(error: { code?: string; message: string }, d: DatosContratista) {
  if (error.code === "23505") {
    return new Error(
      d.tipoPersona === "juridica"
        ? `Ya existe un contratista con el NIT ${d.numeroDocumento}.`
        : `Ya existe un contratista con ${d.tipoDocumento} ${d.numeroDocumento}.`
    )
  }
  return new Error(error.message)
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
  validarArchivosSubidos(id, documentos)

  const supabase = await createClient()
  const { error } = await supabase.rpc("crear_contratista", {
    p_id: id,
    p_datos: datosParaBase(d),
    p_documentos: documentosParaBase(documentos),
  })
  if (error) throw errorDeBase(error, d)

  const { data, error: errorLeer } = await supabase.from("contratistas").select(SELECT_CONTRATISTA).eq("id", id).single()
  if (errorLeer) throw new Error(errorLeer.message)
  return (await conDatosBancarios(supabase, [mapContratista(data)]))[0]
}

// Corrige los datos de un contratista y reemplaza o agrega documentos
// (`documentos` = solo los archivos nuevos, ya subidos por el navegador). El
// tipo de persona no cambia. Devuelve el contratista y las rutas de los
// archivos reemplazados, que el navegador borra (ya no son documento de nadie).
export async function editarContratista(
  id: string,
  crudo: DatosContratista,
  documentos: DocumentoSubido[]
): Promise<{ contratista: Contratista; rutasReemplazadas: string[] }> {
  await requerirAccion("gestionar_contratistas")

  // Sin la acción ver_datos_bancarios no se piden ni se cambian (la base los
  // deja como estaban).
  const r = validarContratista(crudo, { sinDatosBancarios: !(await puedeVerDatosBancarios()) })
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa los datos del contratista.")
  const d = r.datos
  validarArchivosSubidos(id, documentos)

  const supabase = await createClient()
  const { data: viejas, error } = await supabase.rpc("editar_contratista", {
    p_id: id,
    p_datos: datosParaBase(d),
    p_documentos: documentosParaBase(documentos),
  })
  if (error) throw errorDeBase(error, d)

  const { data, error: errorLeer } = await supabase.from("contratistas").select(SELECT_CONTRATISTA).eq("id", id).single()
  if (errorLeer) throw new Error(errorLeer.message)
  return { contratista: (await conDatosBancarios(supabase, [mapContratista(data)]))[0], rutasReemplazadas: (viejas as string[] | null) ?? [] }
}

// Enlace temporal (2 minutos) para ver un documento: el bucket es privado.
// También desde Pre-aprobación y Aprobación de minutas: Jurídica y Subgerencia
// revisan los documentos generales del contratista (igual que la política
// contratistas_archivos_select).
export async function enlaceDocumentoContratista(documentoId: string): Promise<string> {
  const permisos = await obtenerPermisosRol()
  if (
    !permisos ||
    !(
      permisos.esAdministrador ||
      permisos.pestanas.includes("contratos.contratistas") ||
      permisos.pestanas.includes("contratos.preaprobacion") ||
      permisos.pestanas.includes("contratos.aprobar_minutas")
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
