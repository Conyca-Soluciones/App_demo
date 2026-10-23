// ---------------------------------------------------------------------------
// Contratistas: tipos, catálogo de documentos generales y validación.
//
// Sin dependencias de servidor: lo usan el formulario (cliente) y la Server
// Action (que vuelve a validar). La base repite las reglas en sus CHECK y en
// crear_contratista (20261011000000_contratistas.sql).
//
// Documentos GENERALES (aplican a todo contrato, definidos por Jurídica). Los
// que dependen del tipo de contrato se piden al crear el contrato.
// ---------------------------------------------------------------------------

export type TipoPersona = "natural" | "juridica"
export type TipoDocumentoPersona = "CC" | "CE" | "PPT" | "PA"
export type TipoDocumento = TipoDocumentoPersona | "NIT"
export type TipoCuenta = "ahorros" | "corriente"

export type TipoDocumentoContratista =
  | "cedula"
  | "rut"
  | "certificacion_bancaria"
  | "hoja_vida"
  | "autorizacion_datos"
  | "camara_comercio"
  | "cedula_representante"
  | "consulta_oficial_cumplimiento"

export type DocumentoRequerido = { tipo: TipoDocumentoContratista; titulo: string; obligatorio: boolean }

export const DOCUMENTOS_POR_PERSONA: Record<TipoPersona, DocumentoRequerido[]> = {
  natural: [
    { tipo: "cedula", titulo: "Copia de la cédula de ciudadanía", obligatorio: true },
    { tipo: "rut", titulo: "RUT", obligatorio: true },
    { tipo: "certificacion_bancaria", titulo: "Certificación bancaria", obligatorio: true },
    { tipo: "hoja_vida", titulo: "Hoja de vida (si aplica)", obligatorio: false },
    { tipo: "autorizacion_datos", titulo: "Autorización para el tratamiento de datos personales", obligatorio: true },
  ],
  juridica: [
    { tipo: "camara_comercio", titulo: "Cámara de comercio", obligatorio: true },
    { tipo: "rut", titulo: "RUT", obligatorio: true },
    { tipo: "cedula_representante", titulo: "Cédula del representante legal", obligatorio: true },
    { tipo: "certificacion_bancaria", titulo: "Certificación bancaria", obligatorio: true },
    { tipo: "autorizacion_datos", titulo: "Autorización para el tratamiento de datos personales", obligatorio: true },
    { tipo: "consulta_oficial_cumplimiento", titulo: "Consulta de Oficial de Cumplimiento", obligatorio: true },
  ],
}

export const TITULO_DOCUMENTO: Record<TipoDocumentoContratista, string> = {
  cedula: "Cédula",
  rut: "RUT",
  certificacion_bancaria: "Certificación bancaria",
  hoja_vida: "Hoja de vida",
  autorizacion_datos: "Autorización de datos personales",
  camara_comercio: "Cámara de comercio",
  cedula_representante: "Cédula del representante legal",
  consulta_oficial_cumplimiento: "Consulta de Oficial de Cumplimiento",
}

export const TIPOS_DOCUMENTO_PERSONA: { valor: TipoDocumentoPersona; titulo: string }[] = [
  { valor: "CC", titulo: "Cédula de ciudadanía" },
  { valor: "CE", titulo: "Cédula de extranjería" },
  { valor: "PPT", titulo: "Permiso por protección temporal" },
  { valor: "PA", titulo: "Pasaporte" },
]

// Archivos: igual que el bucket `contratistas` (la base también lo exige).
export const MIME_PERMITIDOS = ["application/pdf", "image/jpeg", "image/png"]
export const TAMANO_MAXIMO = 10 * 1024 * 1024 // 10 MB

export type Contratista = {
  id: string
  // El tercero (20261222000000): nombre, documento y tipo de persona son una
  // copia del tercero; la cuenta bancaria vive solo en Terceros.
  terceroId: string
  tipoPersona: TipoPersona
  tipoDocumento: TipoDocumento
  numeroDocumento: string
  digitoVerificacion: number | null
  nombre: string
  representanteNombre: string | null
  representanteTipoDocumento: TipoDocumentoPersona | null
  representanteNumeroDocumento: string | null
  // Dónde se expidió la cédula: de la persona natural o del representante legal.
  cedulaExpedidaEn: string | null
  correo: string
  telefono: string
  direccion: string
  ciudad: string
  // La certificación bancaria solo la ve quien tiene la acción
  // ver_datos_bancarios (20261115100000).
  datosBancariosVisibles: boolean
  creadoPorNombre: string | null
  createdAt: string
  editadoAt: string | null
  editadoPorNombre: string | null
  documentos: DocumentoContratista[]
}

export type DocumentoContratista = {
  id: string
  tipo: TipoDocumentoContratista
  nombreArchivo: string
  tamano: number
  mime: string
  subidoAt: string
}

// Lo que llena el formulario (todo como texto, igual que los inputs). El nombre
// y el documento salen del tercero elegido (terceroId); el tipo de persona
// también (NIT = jurídica, tipoPersonaDeTercero).
export type DatosContratista = {
  terceroId: string
  tipoPersona: TipoPersona
  representanteNombre: string
  representanteTipoDocumento: TipoDocumentoPersona | ""
  representanteNumeroDocumento: string
  cedulaExpedidaEn: string
  correo: string
  telefono: string
  direccion: string
  ciudad: string
}

export type CampoContratista = keyof DatosContratista

// Tipos de documento con que se identifica un contratista (los de Terceros
// también incluyen TI y RC, que no sirven aquí).
export const esDocumentoContratista = (tipo: string): tipo is TipoDocumento =>
  tipo === "NIT" || TIPOS_DOCUMENTO_PERSONA.some((t) => t.valor === tipo)

export const tipoPersonaDeTercero = (tipoDocumento: string): TipoPersona => (tipoDocumento === "NIT" ? "juridica" : "natural")

// Dígito de verificación del NIT (algoritmo de la DIAN, módulo 11).
const PESOS_DV = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]
export function calcularDvNit(nit: string): number {
  let suma = 0
  const digitos = nit.split("").reverse()
  for (let i = 0; i < digitos.length; i++) suma += Number(digitos[i]) * PESOS_DV[i]
  const r = suma % 11
  return r > 1 ? 11 - r : r
}

// Documento sin puntos, espacios ni guiones, en mayúsculas ("1.020.304" -> "1020304").
const limpiarDocumento = (v: string) => v.replace(/[\s.\-]/g, "").toUpperCase()
const limpiarTelefono = (v: string) => v.replace(/[\s\-()]/g, "")

export type ResultadoValidacion =
  | { ok: true; datos: DatosContratista }
  | { ok: false; errores: Partial<Record<CampoContratista, string>> }

// Valida y normaliza. Devuelve los datos listos para guardar o un error por campo.
// El nombre y el documento no se validan aquí: vienen del tercero.
export function validarContratista(crudo: DatosContratista): ResultadoValidacion {
  const errores: Partial<Record<CampoContratista, string>> = {}
  const juridica = crudo.tipoPersona === "juridica"
  const datos: DatosContratista = {
    ...crudo,
    representanteNombre: juridica ? crudo.representanteNombre.trim().replace(/\s+/g, " ") : "",
    representanteTipoDocumento: juridica ? crudo.representanteTipoDocumento : "",
    representanteNumeroDocumento: juridica ? limpiarDocumento(crudo.representanteNumeroDocumento) : "",
    cedulaExpedidaEn: crudo.cedulaExpedidaEn.trim().replace(/\s+/g, " "),
    correo: crudo.correo.trim().toLowerCase(),
    telefono: limpiarTelefono(crudo.telefono),
    direccion: crudo.direccion.trim(),
    ciudad: crudo.ciudad.trim(),
  }

  if (!crudo.terceroId) errores.terceroId = "Busca el tercero por su documento (o créalo)."
  if (crudo.tipoPersona !== "natural" && crudo.tipoPersona !== "juridica") {
    errores.tipoPersona = "El tipo de persona sale del tercero."
  }
  if (juridica) {
    if (datos.representanteNombre.length < 3) errores.representanteNombre = "Escribe el nombre del representante legal."
    if (!datos.representanteTipoDocumento) errores.representanteTipoDocumento = "Elige el tipo de documento."
    if (!/^[0-9A-Z]{3,20}$/.test(datos.representanteNumeroDocumento)) {
      errores.representanteNumeroDocumento = "Escribe el número de documento del representante."
    }
  }
  if (!datos.cedulaExpedidaEn) {
    errores.cedulaExpedidaEn = juridica ? "Escribe dónde se expidió la cédula del representante." : "Escribe dónde se expidió la cédula."
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.correo)) errores.correo = "Escribe un correo válido."
  if (!/^\+?[0-9]{7,15}$/.test(datos.telefono)) errores.telefono = "Escribe un teléfono de 7 a 15 números."
  if (!datos.direccion) errores.direccion = "Escribe la dirección."
  if (!datos.ciudad) errores.ciudad = "Escribe la ciudad."

  return Object.keys(errores).length > 0 ? { ok: false, errores } : { ok: true, datos }
}

// Error de un archivo antes de subirlo, o null si sirve.
export function validarArchivo(archivo: File): string | null {
  if (!MIME_PERMITIDOS.includes(archivo.type)) return "Solo PDF, JPG o PNG."
  if (archivo.size > TAMANO_MAXIMO) return "El archivo pesa más de 10 MB."
  if (archivo.size === 0) return "El archivo está vacío."
  return null
}

export function documentoFormateado(c: Pick<Contratista, "tipoDocumento" | "numeroDocumento" | "digitoVerificacion">) {
  return c.tipoDocumento === "NIT"
    ? `NIT ${c.numeroDocumento}-${c.digitoVerificacion ?? ""}`
    : `${c.tipoDocumento} ${c.numeroDocumento}`
}

// Filtros de la pantalla Contratistas (vacíos = todos).
export type FiltrosContratistas = {
  nombre?: string // nombre o razón social; si son números, el documento
  ciudad?: string
  tipoPersona?: TipoPersona
}
