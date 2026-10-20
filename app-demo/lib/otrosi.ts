import { CONTRATANTE_POR_DEFECTO, type OrigenDato } from "@/lib/minuta-mano-obra"
import { TIPOS_DOCUMENTO_ARRENDADOR, type TipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"
import { nombreTipoContrato, type ClaseContrato } from "@/lib/contratos"

// ---------------------------------------------------------------------------
// Otrosí de contratos (plantilla "OTROSÍ" versión 04, 9/05/2025). El ingeniero
// pide qué cláusulas cambian y cómo quedan (Solicitud de otrosí); Jurídica
// arma el documento y lo envía a Subgerencia, que lo aprueba (Aprobación de
// otrosí). Es solo documento: no cambia el plazo ni el valor del contrato en
// el sistema. Base: supabase/migrations/20261119000000_otrosis.sql.
// ---------------------------------------------------------------------------

// Pestañas desde las que se ven los otrosí (y su PDF): las de otrosí y las que
// ya dejan ver contratos (igual que _puede_ver_otrosis en la base).
export const PESTANAS_VER_OTROSI = [
  "contratos.solicitar_otrosi",
  "contratos.aprobar_otrosi",
  "contratos.solicitar",
  "contratos.contratos",
  "contratos.preaprobacion",
  "contratos.aprobar_minutas",
  "contratos.cortes",
  "contratos.aprobar_actas",
  "admin.visualizacion",
]

// Un otrosí visto desde su contrato (otrosis_de_contrato).
export type OtrosiDeContrato = {
  id: string
  numero: number | null
  estado: EstadoOtrosi
  clausulas: string
  solicitadoPorNombre: string | null
  createdAt: string
  aprobadoAt: string | null
}

export type EstadoOtrosi = "por_revisar" | "devuelta" | "rechazada" | "en_revision" | "devuelta_subgerencia" | "aprobada"

export const ETIQUETA_ESTADO_OTROSI: Record<EstadoOtrosi, string> = {
  por_revisar: "En Jurídica",
  devuelta: "Devuelto al ingeniero",
  rechazada: "Rechazado",
  en_revision: "En Subgerencia",
  devuelta_subgerencia: "Devuelto por Subgerencia",
  aprobada: "Aprobado",
}

export const CLASE_ESTADO_OTROSI: Record<EstadoOtrosi, string> = {
  por_revisar: "border-transparent bg-amber-100 text-amber-800",
  devuelta: "border-transparent bg-orange-100 text-orange-800",
  rechazada: "border-transparent bg-red-100 text-red-800",
  en_revision: "border-transparent bg-sky-100 text-sky-800",
  devuelta_subgerencia: "border-transparent bg-orange-100 text-orange-800",
  aprobada: "border-transparent bg-emerald-100 text-emerald-800",
}

export type ModificacionOtrosi = { clausula: string; redaccion: string }

// Contrato al que se le puede pedir otrosí (contratos_para_otrosi).
export type ContratoParaOtrosi = {
  id: string
  numero: number
  numeroContrato: string
  tipo: string
  clase: ClaseContrato
  tipoDetalle: string | null
  objeto: string
  valor: number
  fechaFin: string | null
  proyectoCodigo: string | null
  proyectoNombre: string | null
  contratistaId: string
  contratistaNombre: string
  contratistaDocumento: string
  otrosisAprobados: number
  otrosisEnTramite: number
}

export type OtrosiFila = {
  id: string
  numero: number | null
  estado: EstadoOtrosi
  contratoId: string
  numeroContrato: string
  tipo: string
  clase: ClaseContrato
  tipoDetalle: string | null
  objeto: string
  valor: number
  proyectoId: string
  proyectoCodigo: string | null
  proyectoNombre: string | null
  contratistaNombre: string
  nModificaciones: number
  clausulas: string
  solicitadoPorNombre: string | null
  createdAt: string
  enviadoAt: string
  enviadaSubgerenciaAt: string | null
  enviadaSubgerenciaPorNombre: string | null
  aprobadoAt: string | null
}

export type ContratistaOtrosi = {
  tipoPersona: "natural" | "juridica"
  tipoDocumento: string | null
  numeroDocumento: string | null
  digitoVerificacion: number | null
  representanteNombre: string | null
  representanteTipoDocumento: string | null
  representanteNumeroDocumento: string | null
  cedulaExpedidaEn: string | null
  ciudad: string | null
}

export type OtrosiDetalle = OtrosiFila & {
  modificaciones: ModificacionOtrosi[]
  justificacion: string
  motivo: string | null
  resueltoPorNombre: string | null
  resueltoAt: string | null
  aprobadoPorNombre: string | null
  minutaDatos: unknown
  minutaActualizadaAt: string | null
  minutaActualizadaPorNombre: string | null
  numeroProvisional: number
  fechaFin: string | null
  contratoMinuta: unknown
  proyectoCiudad: string | null
  empresaNombre: string | null
  empresaNit: string | null
  contratista: ContratistaOtrosi
}

// ---------------------------------------------------------------- lectura (jsonb de la base)
type Fila = Record<string, unknown>
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v))
const textoONulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v))
const numeroONulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))

export function mapContratoParaOtrosi(x: Fila): ContratoParaOtrosi {
  return {
    id: texto(x.id),
    numero: Number(x.numero),
    numeroContrato: texto(x.numero_contrato),
    tipo: texto(x.tipo),
    clase: (x.clase === "general" ? "general" : "grupo") as ClaseContrato,
    tipoDetalle: textoONulo(x.tipo_detalle),
    objeto: texto(x.objeto),
    valor: Number(x.valor ?? 0),
    fechaFin: textoONulo(x.fecha_fin),
    proyectoCodigo: textoONulo(x.proyecto_codigo),
    proyectoNombre: textoONulo(x.proyecto_nombre),
    contratistaId: texto(x.contratista_id),
    contratistaNombre: texto(x.contratista_nombre),
    contratistaDocumento: texto(x.contratista_documento),
    otrosisAprobados: Number(x.otrosis_aprobados ?? 0),
    otrosisEnTramite: Number(x.otrosis_en_tramite ?? 0),
  }
}

export function mapOtrosiFila(x: Fila): OtrosiFila {
  return {
    id: texto(x.id),
    numero: numeroONulo(x.numero),
    estado: x.estado as EstadoOtrosi,
    contratoId: texto(x.contrato_id),
    numeroContrato: texto(x.numero_contrato),
    tipo: texto(x.tipo),
    clase: (x.clase === "general" ? "general" : "grupo") as ClaseContrato,
    tipoDetalle: textoONulo(x.tipo_detalle),
    objeto: texto(x.objeto),
    valor: Number(x.valor ?? 0),
    proyectoId: texto(x.proyecto_id),
    proyectoCodigo: textoONulo(x.proyecto_codigo),
    proyectoNombre: textoONulo(x.proyecto_nombre),
    contratistaNombre: texto(x.contratista_nombre),
    nModificaciones: Number(x.n_modificaciones ?? 0),
    clausulas: texto(x.clausulas),
    solicitadoPorNombre: textoONulo(x.solicitado_por_nombre),
    createdAt: texto(x.created_at),
    enviadoAt: texto(x.enviado_at),
    enviadaSubgerenciaAt: textoONulo(x.enviada_subgerencia_at),
    enviadaSubgerenciaPorNombre: textoONulo(x.enviada_subgerencia_por_nombre),
    aprobadoAt: textoONulo(x.aprobado_at),
  }
}

export function mapOtrosiDetalle(x: Fila): OtrosiDetalle {
  const k = (x.contratista ?? {}) as Fila
  const mods = Array.isArray(x.modificaciones) ? (x.modificaciones as Fila[]) : []
  return {
    ...mapOtrosiFila(x),
    modificaciones: mods.map((m) => ({ clausula: texto(m.clausula), redaccion: texto(m.redaccion) })),
    justificacion: texto(x.justificacion),
    motivo: textoONulo(x.motivo),
    resueltoPorNombre: textoONulo(x.resuelto_por_nombre),
    resueltoAt: textoONulo(x.resuelto_at),
    aprobadoPorNombre: textoONulo(x.aprobado_por_nombre),
    minutaDatos: x.minuta_datos ?? null,
    minutaActualizadaAt: textoONulo(x.minuta_actualizada_at),
    minutaActualizadaPorNombre: textoONulo(x.minuta_actualizada_por_nombre),
    numeroProvisional: Number(x.numero_provisional ?? 1),
    fechaFin: textoONulo(x.fecha_fin),
    contratoMinuta: x.contrato_minuta ?? null,
    proyectoCiudad: textoONulo(x.proyecto_ciudad),
    empresaNombre: textoONulo(x.empresa_nombre),
    empresaNit: textoONulo(x.empresa_nit),
    contratista: {
      tipoPersona: k.tipo_persona === "juridica" ? "juridica" : "natural",
      tipoDocumento: textoONulo(k.tipo_documento),
      numeroDocumento: textoONulo(k.numero_documento),
      digitoVerificacion: numeroONulo(k.digito_verificacion),
      representanteNombre: textoONulo(k.representante_nombre),
      representanteTipoDocumento: textoONulo(k.representante_tipo_documento),
      representanteNumeroDocumento: textoONulo(k.representante_numero_documento),
      cedulaExpedidaEn: textoONulo(k.cedula_expedida_en),
      ciudad: textoONulo(k.ciudad),
    },
  }
}

// ---------------------------------------------------------------- solicitud
export const MAXIMO_MODIFICACIONES_OTROSI = 20

// Lo mismo que revisa la base (_normalizar_modificaciones_otrosi y crear_otrosi).
export function validarSolicitudOtrosi(s: { contratoId: string | null; modificaciones: ModificacionOtrosi[]; justificacion: string }): string | null {
  if (!s.contratoId) return "Escoge el contrato."
  const mods = s.modificaciones
  if (mods.length === 0) return "Agrega al menos una cláusula a modificar."
  if (mods.length > MAXIMO_MODIFICACIONES_OTROSI) return `Máximo ${MAXIMO_MODIFICACIONES_OTROSI} cláusulas por otrosí.`
  for (const [i, m] of mods.entries()) {
    if (!m.clausula.trim()) return `Modificación ${i + 1}: indica qué cláusula se modifica.`
    if (!m.redaccion.trim()) return `Modificación ${i + 1}: escribe cómo queda la cláusula.`
    if (m.clausula.trim().length > 200) return `Modificación ${i + 1}: el nombre de la cláusula es muy largo (máximo 200 caracteres).`
    if (m.redaccion.trim().length > 20000) return `Modificación ${i + 1}: la redacción es muy larga.`
  }
  if (!s.justificacion.trim()) return "Escribe por qué se necesita el otrosí."
  if (s.justificacion.trim().length > 5000) return "La justificación es muy larga (máximo 5.000 caracteres)."
  return null
}

// El plazo inicial ya terminó (la base tampoco deja hacer otrosí).
export const contratoVencido = (fechaFin: string | null, hoy: string) => Boolean(fechaFin && fechaFin < hoy)

// ---------------------------------------------------------------- documento (minuta del otrosí)
export type MinutaOtrosi = {
  contratanteNombre: string
  contratanteNit: string
  contratanteRepresentante: string
  contratanteRepresentanteCedula: string
  contratanteRepresentanteExpedida: string
  contratistaTipoPersona: "natural" | "juridica"
  contratistaNombre: string
  contratistaNit: string // jurídica
  contratistaRepresentante: string // jurídica
  contratistaTipoDocumento: TipoDocumentoArrendador // natural: el suyo; jurídica: el del representante
  contratistaCedula: string
  contratistaCiudad: string
  numeroContrato: string
  // "contrato de mano de obra" (segunda: "Las demás cláusulas ... del contrato de ...").
  nombreContrato: string
  modificaciones: ModificacionOtrosi[]
  ciudadFirma: string
  fechaFirma: string // AAAA-MM-DD
}

// La plantilla dice "con cédula N° ... expedida en Arauca".
export const EXPEDIDA_PLANTILLA_OTROSI = "Arauca"

const CAMPOS_DE_PLANTILLA = new Set<keyof MinutaOtrosi>(["contratanteRepresentanteExpedida"])

// Lo que ya quedó escrito en la minuta aprobada del contrato (representante de
// la empresa, datos del contratista) gana sobre el directorio: es lo firmado.
function deMinuta(minuta: unknown, clave: string): string | null {
  if (!minuta || typeof minuta !== "object" || Array.isArray(minuta)) return null
  const v = (minuta as Record<string, unknown>)[clave]
  return typeof v === "string" && v.trim() ? v.trim() : null
}

const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

export function minutaOtrosiPorDefecto(d: OtrosiDetalle, hoy: string): MinutaOtrosi {
  const k = d.contratista
  const juridica = k.tipoPersona === "juridica"
  const nitDirectorio =
    k.tipoDocumento === "NIT" && k.numeroDocumento ? `${k.numeroDocumento}${k.digitoVerificacion !== null ? `-${k.digitoVerificacion}` : ""}` : ""
  const tipoDocumento = juridica ? k.representanteTipoDocumento : k.tipoDocumento
  const cm = d.contratoMinuta
  return {
    contratanteNombre: deMinuta(cm, "contratanteNombre") ?? d.empresaNombre ?? CONTRATANTE_POR_DEFECTO.nombre,
    contratanteNit: deMinuta(cm, "contratanteNit") ?? d.empresaNit ?? CONTRATANTE_POR_DEFECTO.nit,
    contratanteRepresentante: deMinuta(cm, "contratanteRepresentante") ?? "",
    contratanteRepresentanteCedula: deMinuta(cm, "contratanteRepresentanteCedula") ?? "",
    contratanteRepresentanteExpedida: deMinuta(cm, "contratanteRepresentanteExpedida") ?? EXPEDIDA_PLANTILLA_OTROSI,
    contratistaTipoPersona: juridica ? "juridica" : "natural",
    contratistaNombre: deMinuta(cm, "contratistaNombre") ?? d.contratistaNombre,
    contratistaNit: deMinuta(cm, "contratistaNit") ?? nitDirectorio,
    contratistaRepresentante: juridica ? (deMinuta(cm, "contratistaRepresentante") ?? k.representanteNombre ?? "") : "",
    contratistaTipoDocumento: TIPOS_DOCUMENTO_ARRENDADOR.some((t) => t.valor === tipoDocumento) ? (tipoDocumento as TipoDocumentoArrendador) : "CC",
    contratistaCedula: deMinuta(cm, "contratistaCedula") ?? (juridica ? (k.representanteNumeroDocumento ?? "") : (k.numeroDocumento ?? "")),
    contratistaCiudad: deMinuta(cm, "contratistaCiudad") ?? k.ciudad ?? "",
    numeroContrato: d.numeroContrato,
    nombreContrato: `contrato de ${minuscula(nombreTipoContrato(d))}`,
    modificaciones: d.modificaciones.map((m) => ({ ...m })),
    ciudadFirma: d.proyectoCiudad ?? "",
    fechaFirma: hoy,
  }
}

export function minutaOtrosiVacia(): MinutaOtrosi {
  return {
    contratanteNombre: "",
    contratanteNit: "",
    contratanteRepresentante: "",
    contratanteRepresentanteCedula: "",
    contratanteRepresentanteExpedida: "",
    contratistaTipoPersona: "natural",
    contratistaNombre: "",
    contratistaNit: "",
    contratistaRepresentante: "",
    contratistaTipoDocumento: "CC",
    contratistaCedula: "",
    contratistaCiudad: "",
    numeroContrato: "",
    nombreContrato: "",
    modificaciones: [],
    ciudadFirma: "",
    fechaFirma: "",
  }
}

// Lo guardado gana campo por campo sobre lo calculado (como las minutas).
export function mezclarMinutaOtrosi(defecto: MinutaOtrosi, guardada: unknown): MinutaOtrosi {
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return defecto
  const g = guardada as Record<string, unknown>
  const r: Record<string, unknown> = { ...defecto }
  for (const clave of Object.keys(defecto) as (keyof MinutaOtrosi)[]) {
    if (!(clave in g)) continue
    const valor = g[clave]
    if (clave === "modificaciones") {
      if (Array.isArray(valor))
        r.modificaciones = valor
          .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
          .map((x) => ({ clausula: String(x.clausula ?? ""), redaccion: String(x.redaccion ?? "") }))
    } else if (clave === "contratistaTipoPersona") {
      if (valor === "natural" || valor === "juridica") r[clave] = valor
    } else if (clave === "contratistaTipoDocumento") {
      if (TIPOS_DOCUMENTO_ARRENDADOR.some((t) => t.valor === valor)) r[clave] = valor
    } else if (typeof valor === "string") {
      r[clave] = valor
    }
  }
  return r as MinutaOtrosi
}

// Sin modificaciones vacías.
export const limpiarMinutaOtrosi = (m: MinutaOtrosi): MinutaOtrosi => ({
  ...m,
  modificaciones: m.modificaciones.filter((x) => x.clausula.trim() || x.redaccion.trim()),
})

export function origenCampoOtrosi(clave: keyof MinutaOtrosi, actual: string, defecto: MinutaOtrosi): OrigenDato {
  if (!actual.trim()) return "vacio"
  const inicial = defecto[clave]
  if (typeof inicial !== "string" || actual !== inicial) return "editado"
  if (CAMPOS_DE_PLANTILLA.has(clave)) return actual === EXPEDIDA_PLANTILLA_OTROSI ? "plantilla" : "solicitud"
  return "solicitud"
}

export const nombreArchivoOtrosi = (numeroContrato: string, numero: number) =>
  `otrosi-${numero}-${numeroContrato}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") + ".pdf"

export const mapOtrosiDeContrato = (x: Fila): OtrosiDeContrato => ({
  id: texto(x.id),
  numero: numeroONulo(x.numero),
  estado: x.estado as EstadoOtrosi,
  clausulas: texto(x.clausulas),
  solicitadoPorNombre: textoONulo(x.solicitado_por_nombre),
  createdAt: texto(x.created_at),
  aprobadoAt: textoONulo(x.aprobado_at),
})
