// ---------------------------------------------------------------------------
// Minuta del contrato de prestación de servicios (formato GJ-F-020 de
// Jurídica, versión 02).
//
// Igual que las demás minutas: todo lo que la plantilla deja en "XXX" es un
// campo de MinutaServicios, se llena con los datos de la solicitud
// (minutaServiciosPorDefecto), Jurídica lo edita en Pre-aprobación y se guarda
// en contratos.minuta_datos. El texto fijo de las cláusulas está en
// components/minuta-servicios-pdf.tsx. La plantilla es para una persona
// natural; también se arma para una jurídica (firma su representante legal).
// Sin dependencias de servidor.
// ---------------------------------------------------------------------------

import { anticipoEnLetras, esNoAplica, type SolicitudContratoDetalle } from "@/lib/contratos"
import {
  CONTRATANTE_POR_DEFECTO,
  cantidadEnLetras,
  pesosSinSimbolo,
  valorEnLetras,
  type ClausulaAdicional,
  type DatosExtraMinuta,
  type OrigenDato,
} from "@/lib/minuta-mano-obra"
import { TIPOS_DOCUMENTO_ARRENDADOR, type TipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"

export const VERSION_MINUTA_SERVICIOS = 1

export type MinutaServicios = {
  v: number
  // Firma (cierre)
  ciudadFirma: string
  fechaFirma: string // AAAA-MM-DD
  // Contratante: la empresa del proyecto
  contratanteNombre: string
  contratanteNit: string
  contratanteRepresentante: string
  contratanteRepresentanteCedula: string
  contratanteCorreo: string
  // Contratista
  contratistaTipoPersona: "natural" | "juridica"
  contratistaNombre: string
  contratistaNit: string // jurídica
  contratistaRepresentante: string // jurídica
  contratistaTipoDocumento: TipoDocumentoArrendador // natural: el suyo; jurídica: el del representante
  contratistaCedula: string
  contratistaCedulaExpedida: string
  contratistaCorreo: string
  // Primera: objeto ("los servicios profesionales como …, para el proyecto …")
  servicio: string
  obra: string
  // Segunda y tercera: obligaciones del contratista
  obligacionesGenerales: string[]
  obligacionesEspecificas: string[]
  // Cuarta: obligaciones del contratante
  obligacionesContratante: string[]
  // Quinta: plazo
  plazo: string // "tres (3) meses"
  fechaInicio: string // AAAA-MM-DD
  // Sexta: valor
  valor: string
  valorLetras: string
  formaPago: string // "Los pagos se realizarán de manera …"
  // Octava: cláusula penal
  clausulaPenalPorcentaje: string
  // Novena: lugar de ejecución
  municipioEjecucion: string
  departamentoEjecucion: string
  // Décima octava: domicilio
  domicilioCiudad: string
  // Cláusulas agregadas después de la décima novena
  clausulasAdicionales: ClausulaAdicional[]
}

// ---------------------------------------------------------------- texto de la plantilla
export const OBLIGACIONES_GENERALES_SERVICIOS = [
  "Cumplir con el objeto del contrato.",
  "Presentar los informes y/o productos de manera mensual aprobados por el supervisor del contrato.",
  "Dar cumplimiento a las obligaciones con los Sistemas de Seguridad Social en salud, pensión, Sistema General de Riesgos Laborales y aportes parafiscales, cuando haya lugar a ello, y presentar los documentos respectivos que así lo acrediten.",
  "Reportar al supervisor de manera inmediata cualquier novedad o anomalía que pueda afectar la ejecución del contrato.",
  "Guardar total reserva de la información que por razón de la prestación del servicio y desarrollo de sus actividades obtenga, pues en virtud del presente contrato dicha información se considera de propiedad del contratante y solo salvo expreso requerimiento de autoridad competente podrá ser divulgada.",
  "Dar aplicación a las políticas expedidas por el consorciado CONYCA SOLUCIONES SAS en materia del Sistema Integrado de Gestión, Sistema de Seguridad de la Información, Sistema de Gestión Ambiental y demás que adopte la empresa.",
  "Responder por la salvaguarda y preservación de los equipos y elementos que le sean asignados para el cumplimiento de sus actividades contractuales.",
  "Acatar las instrucciones que durante el desarrollo del contrato le imparta el supervisor del contrato.",
  "Informar a la entidad administradora de riesgos laborales, a la cual se encuentra afiliado, para que ésta realice la correspondiente novedad en la afiliación del nuevo contrato.",
  "Practicarse un examen pre ocupacional y allegar el certificado.",
  "Conocer y aplicar la normatividad y disposiciones legales vigentes en seguridad y salud en el trabajo en la ejecución de sus actividades.",
  "Mantener indemne al contratante por todo daño que puedan realizar los dependientes del contratista.",
]

export const OBLIGACIONES_CONTRATANTE_SERVICIOS = [
  "Velar por el cumplimiento del objeto del presente contrato.",
  "Facilitar acceso a los documentos e información de manera oportuna, y en general prestar la ayuda idónea que requiera el contratista para la debida ejecución del objeto del contrato.",
  "reconocer a el contratista los honorarios como remuneración pactada dentro del plazo establecido.",
]

// Títulos de las cláusulas, en el orden y con la numeración de la plantilla.
export const CLAUSULAS_SERVICIOS = [
  "PRIMERA- OBJETO",
  "SEGUNDA. – OBLIGACIONES GENERALES DEL CONTRATISTA",
  "TERCERA- OBLIGACIONES ESPECÍFICAS DEL CONTRATISTA",
  "CUARTA-OBLIGACIONES GENERALES DEL CONTRATANTE",
  "QUINTA-DURACIÓN O PLAZO",
  "SEXTA-VALOR",
  "SÉPTIMA-SUPERVISIÓN",
  "OCTAVA- CLÁUSULA PENAL PECUNIARIA",
  "NOVENA- LUGAR DE EJECUCIÓN",
  "DÉCIMA- SUSPENSIÓN, TERMINACIÓN ANTICIPADA O PRÓRROGA",
  "DÉCIMA PRIMERA- CAUSALES DE TERMINACIÓN",
  "DÉCIMA SEGUNDA- CESIÓN",
  "DÉCIMA TERCERA- SOLUCIÓN DE CONTROVERSIAS",
  "DÉCIMA CUARTA- MODIFICACIONES",
  "DÉCIMA QUINTA- INDEPENDENCIA",
  "DÉCIMA SEXTA-CONFIDENCIALIDAD",
  "DÉCIMA SÉPTIMA- LIQUIDACIÓN",
  "DÉCIMA OCTAVA - DOMICILIO CONTRACTUAL",
  "DÉCIMA NOVENA: NOTIFICACIONES",
]
export const PRIMERA_CLAUSULA_ADICIONAL_SERVICIOS = CLAUSULAS_SERVICIOS.length + 1

// ---------------------------------------------------------------- valores por defecto
const conUnidad = (n: number, singular: string, plural: string) => `${cantidadEnLetras(n)} ${n === 1 ? singular : plural}`
const sinPuntoFinal = (t: string) => t.trim().replace(/\.$/, "")
const primeraMinuscula = (t: string) => (t ? t.charAt(0).toLocaleLowerCase("es-CO") + t.slice(1) : t)

function mesesExactos(inicio: string, fin: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inicio)
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fin)
  if (!a || !b || a[3] !== b[3]) return null
  const meses = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]))
  return meses > 0 ? meses : null
}

function diasEntre(inicio: string, fin: string): number | null {
  const a = Date.parse(`${inicio}T00:00:00Z`)
  const b = Date.parse(`${fin}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null
  return Math.round((b - a) / 86_400_000)
}

// "tres (3) meses": por duración, o los meses (o días) entre las fechas.
function plazoPorDefecto(d: SolicitudContratoDetalle): string {
  if (d.plazoTipo === "duracion" && d.duracionCantidad) {
    return d.duracionUnidad === "dias" ? conUnidad(d.duracionCantidad, "día", "días") : conUnidad(d.duracionCantidad, "mes", "meses")
  }
  if (d.fechaInicio && d.fechaFin) {
    const meses = mesesExactos(d.fechaInicio, d.fechaFin)
    if (meses) return conUnidad(meses, "mes", "meses")
    const dias = diasEntre(d.fechaInicio, d.fechaFin)
    if (dias) return conUnidad(dias, "día", "días")
  }
  return ""
}

// El objeto de la solicitud empieza con un verbo ("Prestar los servicios
// profesionales como ingeniero residente…"); en la primera va solo lo que
// sigue a "los servicios profesionales como".
export function servicioDesdeObjeto(objeto: string): string {
  const t = sinPuntoFinal(objeto)
  const sin = t.replace(/^prestar\s+(los\s+|sus\s+)?servicios(\s+profesionales)?(\s+(como|de))?\s+/i, "")
  return sin === t ? primeraMinuscula(t) : sin
}

// "Los pagos se realizarán de manera …": valor mensual, anticipo y la forma de
// pago de la solicitud.
function formaPagoPorDefecto(d: SolicitudContratoDetalle): string {
  const partes: string[] = []
  if (d.valorMensual !== null) partes.push(`mensual, en pagos de ${valorEnLetras(d.valorMensual)} ($${pesosSinSimbolo(d.valorMensual)}) M/CTE.`)
  if (d.tieneAnticipo && d.anticipoPorcentaje) partes.push(`Se entregará un anticipo del ${anticipoEnLetras(d.anticipoPorcentaje, d.valor)}.`)
  if (d.formaPago.trim()) partes.push(d.formaPago.trim())
  return partes.join(" ")
}

export function minutaServiciosPorDefecto(d: SolicitudContratoDetalle, extra: DatosExtraMinuta, hoy: string): MinutaServicios {
  const juridica = d.contratistaTipoPersona === "juridica"
  const nit =
    extra.contratistaTipoDocumento === "NIT" && extra.contratistaNumeroDocumento
      ? `${extra.contratistaNumeroDocumento}${extra.contratistaDv !== null ? `-${extra.contratistaDv}` : ""}`
      : ""
  const tipoDocumento = juridica ? extra.contratistaRepresentanteTipoDocumento : extra.contratistaTipoDocumento
  const ciudadProyecto = extra.proyectoCiudad ?? ""

  return {
    v: VERSION_MINUTA_SERVICIOS,
    ciudadFirma: ciudadProyecto,
    fechaFirma: hoy,
    contratanteNombre: extra.empresaNombre ?? CONTRATANTE_POR_DEFECTO.nombre,
    contratanteNit: extra.empresaNit ?? CONTRATANTE_POR_DEFECTO.nit,
    contratanteRepresentante: "",
    contratanteRepresentanteCedula: "",
    contratanteCorreo: CONTRATANTE_POR_DEFECTO.correo,
    contratistaTipoPersona: juridica ? "juridica" : "natural",
    contratistaNombre: d.contratistaNombre,
    contratistaNit: nit,
    contratistaRepresentante: juridica ? (extra.contratistaRepresentante ?? "") : "",
    contratistaTipoDocumento: TIPOS_DOCUMENTO_ARRENDADOR.some((t) => t.valor === tipoDocumento) ? (tipoDocumento as TipoDocumentoArrendador) : "CC",
    contratistaCedula: juridica ? (extra.contratistaRepresentanteDocumento ?? "") : (extra.contratistaNumeroDocumento ?? ""),
    contratistaCedulaExpedida: extra.contratistaCedulaExpedida ?? "",
    contratistaCorreo: d.correoNotificacion,
    servicio: servicioDesdeObjeto(d.objeto),
    obra: d.proyectoNombre ?? "",
    obligacionesGenerales: [...OBLIGACIONES_GENERALES_SERVICIOS],
    obligacionesEspecificas: [
      ...d.obligaciones.filter((o) => !esNoAplica(o)),
      ...d.entregables.filter((e) => !esNoAplica(e)).map((e) => `Entregar: ${sinPuntoFinal(e)}.`),
    ],
    obligacionesContratante: [...OBLIGACIONES_CONTRATANTE_SERVICIOS],
    plazo: plazoPorDefecto(d),
    fechaInicio: d.fechaInicio ?? "",
    valor: new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(d.valor),
    valorLetras: valorEnLetras(d.valor),
    formaPago: formaPagoPorDefecto(d),
    clausulaPenalPorcentaje: "20",
    municipioEjecucion: ciudadProyecto,
    departamentoEjecucion: d.domicilioDepartamento ?? "",
    domicilioCiudad: ciudadProyecto,
    clausulasAdicionales: [],
  }
}

export function minutaServiciosVacia(): MinutaServicios {
  return {
    v: VERSION_MINUTA_SERVICIOS,
    ciudadFirma: "",
    fechaFirma: "",
    contratanteNombre: "",
    contratanteNit: "",
    contratanteRepresentante: "",
    contratanteRepresentanteCedula: "",
    contratanteCorreo: "",
    contratistaTipoPersona: "natural",
    contratistaNombre: "",
    contratistaNit: "",
    contratistaRepresentante: "",
    contratistaTipoDocumento: "CC",
    contratistaCedula: "",
    contratistaCedulaExpedida: "",
    contratistaCorreo: "",
    servicio: "",
    obra: "",
    obligacionesGenerales: [],
    obligacionesEspecificas: [],
    obligacionesContratante: [],
    plazo: "",
    fechaInicio: "",
    valor: "",
    valorLetras: "",
    formaPago: "",
    clausulaPenalPorcentaje: "",
    municipioEjecucion: "",
    departamentoEjecucion: "",
    domicilioCiudad: "",
    clausulasAdicionales: [],
  }
}

// Lo guardado gana sobre lo calculado, campo por campo; solo campos conocidos
// y del mismo tipo.
export function mezclarMinutaServicios(defecto: MinutaServicios, guardada: unknown): MinutaServicios {
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return defecto
  const g = guardada as Record<string, unknown>
  const r: Record<string, unknown> = { ...defecto }
  for (const clave of Object.keys(defecto) as (keyof MinutaServicios)[]) {
    if (clave === "v" || !(clave in g)) continue
    const base = defecto[clave]
    const valor = g[clave]
    if (clave === "clausulasAdicionales") {
      if (Array.isArray(valor)) {
        r.clausulasAdicionales = valor
          .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
          .map((x) => ({ titulo: String(x.titulo ?? ""), texto: String(x.texto ?? "") }))
      }
    } else if (Array.isArray(base)) {
      if (Array.isArray(valor)) r[clave] = valor.map((x) => String(x ?? ""))
    } else if (clave === "contratistaTipoPersona") {
      if (valor === "natural" || valor === "juridica") r[clave] = valor
    } else if (clave === "contratistaTipoDocumento") {
      if (TIPOS_DOCUMENTO_ARRENDADOR.some((t) => t.valor === valor)) r[clave] = valor
    } else if (typeof valor === "string") {
      r[clave] = valor
    }
  }
  return r as MinutaServicios
}

export function limpiarMinutaServicios(m: MinutaServicios): MinutaServicios {
  const lista = (l: string[]) => l.map((t) => t.trim()).filter(Boolean)
  return {
    ...m,
    v: VERSION_MINUTA_SERVICIOS,
    obligacionesGenerales: lista(m.obligacionesGenerales),
    obligacionesEspecificas: lista(m.obligacionesEspecificas),
    obligacionesContratante: lista(m.obligacionesContratante),
    clausulasAdicionales: m.clausulasAdicionales
      .map((c) => ({ titulo: c.titulo.trim(), texto: c.texto.trim() }))
      .filter((c) => c.titulo || c.texto),
  }
}

export const nombreArchivoMinutaServicios = (numero: number, contratista: string) =>
  `minuta-servicios-${numero}-${contratista
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40)}.pdf`

// ---------------------------------------------------------------- origen de cada dato
const CAMPOS_DE_PLANTILLA = new Set<keyof MinutaServicios>(["contratanteCorreo", "clausulaPenalPorcentaje"])

export function origenCampoServicios(clave: keyof MinutaServicios, actual: string, defecto: MinutaServicios): OrigenDato {
  if (!actual.trim()) return "vacio"
  const inicial = defecto[clave]
  if (typeof inicial !== "string" || actual !== inicial) return "editado"
  if (CAMPOS_DE_PLANTILLA.has(clave)) return "plantilla"
  if (clave === "contratanteNombre") return actual === CONTRATANTE_POR_DEFECTO.nombre ? "plantilla" : "solicitud"
  if (clave === "contratanteNit") return actual === CONTRATANTE_POR_DEFECTO.nit ? "plantilla" : "solicitud"
  return "solicitud"
}
