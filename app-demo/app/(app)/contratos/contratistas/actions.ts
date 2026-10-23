"use server"

import { createClient } from "@/lib/supabase/server"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { cortarPagina, rangoPagina } from "@/lib/paginacion"
import { COMODIN_LISTAR } from "@/lib/busqueda"
import { obtenerPermisosRol, requerirAccion } from "@/lib/permisos"
import {
  DOCUMENTOS_POR_PERSONA,
  MIME_PERMITIDOS,
  TAMANO_MAXIMO,
  validarContratista,
  type Contratista,
  type DatosContratista,
  type FiltrosContratistas,
  type TipoDocumentoContratista,
} from "@/lib/contratistas"

// La cuenta bancaria ya no está en contratistas: vive en Terceros
// (20261222000000). Nombre, documento y tipo de persona son copia del tercero.
const SELECT_CONTRATISTA = `
  id, tercero_id, tipo_persona, tipo_documento, numero_documento, digito_verificacion, nombre,
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
    terceroId: f.tercero_id,
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

// Marca si quien pregunta ve la certificación bancaria (acción
// ver_datos_bancarios). Las cuentas se ven en Terceros.
async function conDatosBancarios(
  _supabase: Awaited<ReturnType<typeof createClient>>,
  lista: Contratista[]
): Promise<Contratista[]> {
  if (lista.length === 0 || !(await puedeVerDatosBancarios())) return lista
  return lista.map((c) => ({ ...c, datosBancariosVisibles: true }))
}

async function requerirVerContratistas() {
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
}

// Texto de búsqueda: sin comodines propios (el usuario escribe texto, no patrones).
const limpiarBusqueda = (t: string) => t.replace(/[%*\\]/g, " ").trim()

// Columnas por las que se puede ordenar la lista (clave de la tabla -> columna).
const ORDEN_CONTRATISTAS: Record<string, string> = {
  nombre: "nombre",
  tipoPersona: "tipo_persona",
  documento: "numero_documento",
  correo: "correo",
  ciudad: "ciudad",
  createdAt: "created_at",
}

// Pantalla Contratistas: una página (50) a la vez, filtrada y ordenada en la
// base (la tabla va a crecer mucho). Sin filtros = todos los contratistas.
export async function listarContratistasPagina(
  filtros: FiltrosContratistas = {},
  pagina = 0,
  orden: { clave: string; dir: "asc" | "desc" } = { clave: "nombre", dir: "asc" }
): Promise<{ contratistas: Contratista[]; hayMas: boolean }> {
  await requerirVerContratistas()
  const supabase = await createClient()
  const columna = ORDEN_CONTRATISTAS[orden.clave] ?? "nombre"

  let query = supabase
    .from("contratistas")
    .select(SELECT_CONTRATISTA)
    .order(columna, { ascending: orden.dir === "asc" })
    .order("id", { ascending: true })

  const nombre = limpiarBusqueda(filtros.nombre ?? "")
  const ciudad = limpiarBusqueda(filtros.ciudad ?? "")
  if (nombre && nombre !== COMODIN_LISTAR) {
    // Por nombre o por documento (quien escribe números busca la cédula o el NIT).
    const digitos = nombre.replace(/\D/g, "")
    query = /^\d[\d.\s-]*$/.test(nombre) && digitos
      ? query.like("numero_documento", `${digitos}%`)
      : query.ilike("nombre", `%${nombre}%`)
  }
  if (ciudad && ciudad !== COMODIN_LISTAR) query = query.ilike("ciudad", `%${ciudad}%`)
  if (filtros.tipoPersona) query = query.eq("tipo_persona", filtros.tipoPersona)

  const { data, error } = await query.range(...rangoPagina(pagina))
  if (error) throw new Error(error.message)
  const { filas, hayMas } = cortarPagina(data ?? [])
  return { contratistas: await conDatosBancarios(supabase, filas.map(mapContratista)), hayMas }
}

// Todos (para elegir el contratista en las solicitudes de contrato).
export async function listarContratistas(): Promise<Contratista[]> {
  await requerirVerContratistas()
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
    tercero_id: d.terceroId,
    representante_nombre: d.representanteNombre,
    representante_tipo_documento: d.representanteTipoDocumento,
    representante_numero_documento: d.representanteNumeroDocumento,
    cedula_expedida_en: d.cedulaExpedidaEn,
    correo: d.correo,
    telefono: d.telefono,
    direccion: d.direccion,
    ciudad: d.ciudad,
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

function errorDeBase(error: { code?: string; message: string }) {
  if (error.code === "23505") return new Error("Ese tercero ya está registrado como contratista.")
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
  if (error) throw errorDeBase(error)

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

  const r = validarContratista(crudo)
  if (!r.ok) throw new Error(Object.values(r.errores)[0] ?? "Revisa los datos del contratista.")
  const d = r.datos
  validarArchivosSubidos(id, documentos)

  const supabase = await createClient()
  const { data: viejas, error } = await supabase.rpc("editar_contratista", {
    p_id: id,
    p_datos: datosParaBase(d),
    p_documentos: documentosParaBase(documentos),
  })
  if (error) throw errorDeBase(error)

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
