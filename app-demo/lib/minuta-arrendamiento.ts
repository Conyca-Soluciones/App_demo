// ---------------------------------------------------------------------------
// Minuta del contrato de arrendamiento (formato GJ-F-014 de Jurídica).
//
// Igual que la de mano de obra (lib/minuta-mano-obra.ts): todo lo que la
// plantilla deja en "XXX" es un campo de MinutaArrendamiento, se llena con los
// datos de la solicitud (minutaArrendamientoPorDefecto), Jurídica lo edita en
// Pre-aprobación y se guarda en contratos.minuta_datos. El texto fijo de las
// cláusulas está en components/minuta-arrendamiento-pdf.tsx.
//
// Las partes van al revés que en mano de obra: el contratista del directorio
// es el ARRENDADOR (propietario del inmueble) y la empresa del proyecto es el
// ARRENDATARIO. Sin dependencias de servidor.
// ---------------------------------------------------------------------------

import { anticipoEnLetras, esNoAplica, type SolicitudContratoDetalle } from "@/lib/contratos"
import {
  CONTRATANTE_POR_DEFECTO,
  cantidadEnLetras,
  valorEnLetras,
  type ClausulaAdicional,
  type DatosExtraMinuta,
  type OrigenDato,
} from "@/lib/minuta-mano-obra"

export const VERSION_MINUTA_ARRENDAMIENTO = 1

export type IvaCanon = "" | "mas_iva" | "incluido"
export type ServiciosPublicos = "" | "arrendatario" | "incluidos"

export type MinutaArrendamiento = {
  v: number
  // Firma (cierre)
  ciudadFirma: string
  fechaFirma: string // AAAA-MM-DD
  // Arrendador: el contratista, propietario del inmueble
  arrendadorTipoPersona: "natural" | "juridica"
  arrendadorNombre: string // persona natural o razón social
  arrendadorNit: string // jurídica
  arrendadorRepresentante: string // jurídica: representante legal
  arrendadorCedula: string // natural: su cédula; jurídica: la del representante
  arrendadorCedulaExpedida: string
  arrendadorCorreo: string
  // Arrendatario: la empresa del proyecto
  arrendatarioNombre: string
  arrendatarioNit: string
  arrendatarioRepresentante: string
  arrendatarioCedula: string
  arrendatarioCorreo: string
  // Primera: objeto
  inmuebleDireccion: string
  inmuebleCiudad: string
  // Segunda: destinación
  destinacion: string
  // Tercera: canon
  canon: string
  canonLetras: string
  iva: IvaCanon
  correoFacturacion: string
  condicionesPago: string // forma de pago y anticipo de la solicitud (párrafo aparte)
  paragrafoAdministracion: string // parágrafo segundo (propiedad horizontal)
  // Cuarta: término
  plazo: string // "doce (12) meses"
  fechaInicio: string // AAAA-MM-DD
  serviciosPublicos: ServiciosPublicos
  // Quinta: obligaciones
  obligacionesArrendador: string[]
  obligacionesArrendatario: string[]
  // Décima tercera: causales de terminación
  causalesTerminacion: string[]
  // Cláusulas agregadas después de la décima novena
  clausulasAdicionales: ClausulaAdicional[]
}

// ---------------------------------------------------------------- texto de la plantilla
export const OBLIGACIONES_ARRENDADOR = [
  "Entregar en calidad de arriendo el INMUEBLE objeto del presente Contrato en buen estado de servicio, infraestructura y sanidad, junto con los servicios, cosas o usos conexos para el fin convenido, servicios públicos básicos al día, mediante la suscripción de un ACTA DE ENTREGA y en cumplimiento de las condiciones y especificaciones definidas en la negociación.",
  "Mantener en el inmueble los servicios, las cosas y los usos conexos y adicionales en buen estado de servir para el fin convenido en el contrato.",
  "Permitir y garantizar a EL ARRENDATARIO el uso y goce pacífico e ininterrumpido del inmueble.",
  "Librar a EL ARRENDATARIO de toda turbación u obstrucción del goce de la cosa arrendada.",
  "Permitir que EL ARRENDATARIO realice las adecuaciones, modificaciones y mejoras necesarias para la ejecución de las actividades propias de su objeto social, siempre que las mismas no pongan en riesgo la estabilidad del INMUEBLE y cumplan con todas las normas en la materia.",
  "Generar las reparaciones necesarias a que haya lugar, ejecutando las acciones idóneas y requeridas para subsanar tales novedades.",
  "Las demás establecidas en la ley.",
]

export const OBLIGACIONES_ARRENDATARIO = [
  "Pagar el canon de arrendamiento, así como los servicios públicos que se causen mientras sea tenedor del INMUEBLE.",
  "Usar el bien en los términos aquí estipulados y destinarlo única y exclusivamente para el fin que fue arrendado.",
  "Conservar y mantener el bien en buenas condiciones, así como realizar las reparaciones locativas a que haya lugar que no le correspondan por su naturaleza al ARRENDADOR.",
  "Restituir el INMUEBLE al momento de la terminación del Contrato, en el estado en que fue entregado salvo el deterioro natural por el uso y el paso del tiempo.",
  "Informar a EL ARRENDADOR de cualquier novedad sobre el desarrollo, ejecución del Contrato, estado del bien, y demás circunstancias que EL ARRENDATARIO considere relevantes.",
]

export const CAUSALES_TERMINACION = [
  "Por mutuo acuerdo en cualquier momento de ejecución del Contrato.",
  "Por vencimiento del término inicial.",
  "La destinación por parte del ARRENDATARIO del INMUEBLE para fines ilícitos o contrarios a las buenas costumbres, que representen peligro para el inmueble o para la salubridad de sus habitantes.",
  "La mora injustificada en el pago de un canon de arrendamiento por parte de EL ARRENDATARIO. Esta causal solo podrá ser alegada por parte del ARRENDATARIO.",
  "En caso que el ARRENDADOR, o el ARRENDATARIO, sus accionistas o administradores, sean incluidos en listas para el control de lavado de activos y financiación del terrorismo administradas por cualquier autoridad nacional o extranjera, o figuren en cualquier tipo de investigación o proceso relacionado con delitos fuentes de lavado de activos y financiación del terrorismo (LAFT) o con la administración de recursos relacionados con dichas actividades y demás señaladas en la cláusula denominada Origen de Ingresos y de conformidad con lo establecido en la Cláusula SARLAFT.",
  "Por las demás establecidas en el presente Contrato o en la ley.",
  "Por el incumplimiento de cualquiera de las obligaciones contractuales o legales a cargo de cualquiera de las Partes.",
  "Cuando el PROPIETARIO O POSEEDOR necesite el inmueble para ocuparlo en actividades diferentes al objeto social del arrendatario o cuando el inmueble haya que demolerse para efectuar una nueva construcción o cuando se requiere desocuparlo con el fin de ejecutar obras indispensables para su reparación, siempre y cuando se sigan las estipulaciones consagradas en el artículo 528 del Código de Comercio y subsiguientes.",
  "En cualquier momento mediante aviso escrito del Arrendatario al Arrendador, generando el pago de la cláusula penal por la suma de uno (1) cánon de arrendamientos vigentes.",
]

export const PARAGRAFO_ADMINISTRACION =
  "Teniendo en cuenta que, al momento de la suscripción del presente contrato, el bien inmueble no está sujeto a régimen de propiedad horizontal, las partes estipulan que durante la vigencia de esta relación contractual no se generarán cobros por concepto de administración o similares a cargo del ARRENDATARIO."

export const OPCIONES_IVA: { valor: Exclude<IvaCanon, "">; titulo: string }[] = [
  { valor: "mas_iva", titulo: "Más IVA" },
  { valor: "incluido", titulo: "Incluido el IVA" },
]

export const OPCIONES_SERVICIOS: { valor: Exclude<ServiciosPublicos, "">; titulo: string; texto: string }[] = [
  {
    valor: "arrendatario",
    titulo: "Los paga el arrendatario",
    texto:
      "EL ARRENDATARIO se obligará a cancelar los correspondientes servicios públicos, y todos los gastos o costos en que incurran y se causen desde la fecha de entrega material del inmueble.",
  },
  { valor: "incluidos", titulo: "Incluidos en el canon", texto: "Los servicios públicos se encuentran incluidos en el valor del canon." },
]

// Títulos de las cláusulas, en el orden y con la numeración de la plantilla
// (la plantilla salta de la décima cuarta a la décima séptima).
export const CLAUSULAS_ARRENDAMIENTO = [
  "PRIMERA. - OBJETO",
  "SEGUNDA. - DESTINACIÓN",
  "TERCERA. - CANON DE ARRENDAMIENTO",
  "CUARTA. - TÉRMINO DE DURACIÓN DEL ARRENDAMIENTO",
  "QUINTA. - OBLIGACIONES DE LAS PARTES",
  "SEXTA. REAJUSTE DEL CANON DE ARRENDAMIENTO",
  "SEPTIMA. - ENTREGA DEL INMUEBLE",
  "OCTAVA. - REPARACIONES Y MEJORAS",
  "NOVENA. - INSPECCIÓN",
  "DECIMA. - SERVICIOS PÚBLICOS",
  "DÉCIMA PRIMERA. - CESIÓN DEL CONTRATO",
  "DÉCIMA SEGUNDA. - DEVOLUCIÓN SATISFACTORIA DEL INMUEBLE",
  "DÉCIMA TERCERA. CAUSALES DE TERMINACIÓN DEL CONTRATO",
  "DÉCIMA CUARTA. - SOLUCIÓN DE CONFLICTOS",
  "DÉCIMA SEPTIMA. INDEMNIDAD",
  "DÉCIMA OCTAVA. PERFECCIONAMIENTO Y EJECUCIÓN",
  "DÉCIMA NOVENA. NOTIFICACIONES",
]
// Las adicionales siguen después de la décima novena.
export const PRIMERA_CLAUSULA_ADICIONAL_ARRENDAMIENTO = 20

// ---------------------------------------------------------------- valores por defecto
const numeroTexto = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 }).format(n)

// Meses completos entre dos fechas AAAA-MM-DD si caen el mismo día del mes
// (1 de enero -> 1 de julio = 6); si no, null.
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

const conUnidad = (n: number, singular: string, plural: string) => `${cantidadEnLetras(n)} ${n === 1 ? singular : plural}`

// "doce (12) meses": por duración, o los meses (o días) entre las fechas.
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

export function minutaArrendamientoPorDefecto(d: SolicitudContratoDetalle, extra: DatosExtraMinuta, hoy: string): MinutaArrendamiento {
  const juridica = d.contratistaTipoPersona === "juridica"
  const nit =
    extra.contratistaTipoDocumento === "NIT" && extra.contratistaNumeroDocumento
      ? `${extra.contratistaNumeroDocumento}${extra.contratistaDv !== null ? `-${extra.contratistaDv}` : ""}`
      : ""
  const ciudadProyecto = extra.proyectoCiudad ?? ""
  const condicionesPago = [
    d.formaPago.trim(),
    d.tieneAnticipo && d.anticipoPorcentaje ? `Se entregará un anticipo del ${anticipoEnLetras(d.anticipoPorcentaje, d.valor)}.` : "",
  ]
    .filter(Boolean)
    .join(" ")

  return {
    v: VERSION_MINUTA_ARRENDAMIENTO,
    ciudadFirma: ciudadProyecto,
    fechaFirma: hoy,
    arrendadorTipoPersona: juridica ? "juridica" : "natural",
    arrendadorNombre: d.contratistaNombre,
    arrendadorNit: nit,
    arrendadorRepresentante: juridica ? (extra.contratistaRepresentante ?? "") : "",
    arrendadorCedula: juridica ? (extra.contratistaRepresentanteDocumento ?? "") : (extra.contratistaNumeroDocumento ?? ""),
    arrendadorCedulaExpedida: "",
    arrendadorCorreo: d.correoNotificacion,
    arrendatarioNombre: extra.empresaNombre ?? CONTRATANTE_POR_DEFECTO.nombre,
    arrendatarioNit: extra.empresaNit ?? CONTRATANTE_POR_DEFECTO.nit,
    arrendatarioRepresentante: "",
    arrendatarioCedula: "",
    arrendatarioCorreo: CONTRATANTE_POR_DEFECTO.correo,
    inmuebleDireccion: "",
    inmuebleCiudad: ciudadProyecto,
    destinacion: "",
    canon: d.valorMensual !== null ? numeroTexto(d.valorMensual) : "",
    canonLetras: d.valorMensual !== null ? valorEnLetras(d.valorMensual) : "",
    iva: "",
    correoFacturacion: "",
    condicionesPago,
    paragrafoAdministracion: PARAGRAFO_ADMINISTRACION,
    plazo: plazoPorDefecto(d),
    fechaInicio: d.fechaInicio ?? "",
    serviciosPublicos: "",
    obligacionesArrendador: [...OBLIGACIONES_ARRENDADOR, ...d.obligaciones.filter((o) => !esNoAplica(o))],
    obligacionesArrendatario: [...OBLIGACIONES_ARRENDATARIO],
    causalesTerminacion: [...CAUSALES_TERMINACION],
    clausulasAdicionales: [],
  }
}

export function minutaArrendamientoVacia(): MinutaArrendamiento {
  return {
    v: VERSION_MINUTA_ARRENDAMIENTO,
    ciudadFirma: "",
    fechaFirma: "",
    arrendadorTipoPersona: "natural",
    arrendadorNombre: "",
    arrendadorNit: "",
    arrendadorRepresentante: "",
    arrendadorCedula: "",
    arrendadorCedulaExpedida: "",
    arrendadorCorreo: "",
    arrendatarioNombre: "",
    arrendatarioNit: "",
    arrendatarioRepresentante: "",
    arrendatarioCedula: "",
    arrendatarioCorreo: "",
    inmuebleDireccion: "",
    inmuebleCiudad: "",
    destinacion: "",
    canon: "",
    canonLetras: "",
    iva: "",
    correoFacturacion: "",
    condicionesPago: "",
    paragrafoAdministracion: "",
    plazo: "",
    fechaInicio: "",
    serviciosPublicos: "",
    obligacionesArrendador: [],
    obligacionesArrendatario: [],
    causalesTerminacion: [],
    clausulasAdicionales: [],
  }
}

// Lo guardado gana sobre lo calculado, campo por campo; solo campos conocidos
// y del mismo tipo (como mezclarMinuta de mano de obra).
export function mezclarMinutaArrendamiento(defecto: MinutaArrendamiento, guardada: unknown): MinutaArrendamiento {
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return defecto
  const g = guardada as Record<string, unknown>
  const r: Record<string, unknown> = { ...defecto }
  for (const clave of Object.keys(defecto) as (keyof MinutaArrendamiento)[]) {
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
    } else if (clave === "arrendadorTipoPersona") {
      if (valor === "natural" || valor === "juridica") r[clave] = valor
    } else if (clave === "iva") {
      if (valor === "" || valor === "mas_iva" || valor === "incluido") r[clave] = valor
    } else if (clave === "serviciosPublicos") {
      if (valor === "" || valor === "arrendatario" || valor === "incluidos") r[clave] = valor
    } else if (typeof valor === "string") {
      r[clave] = valor
    }
  }
  return r as MinutaArrendamiento
}

export function limpiarMinutaArrendamiento(m: MinutaArrendamiento): MinutaArrendamiento {
  const lista = (l: string[]) => l.map((t) => t.trim()).filter(Boolean)
  return {
    ...m,
    v: VERSION_MINUTA_ARRENDAMIENTO,
    obligacionesArrendador: lista(m.obligacionesArrendador),
    obligacionesArrendatario: lista(m.obligacionesArrendatario),
    causalesTerminacion: lista(m.causalesTerminacion),
    clausulasAdicionales: m.clausulasAdicionales
      .map((c) => ({ titulo: c.titulo.trim(), texto: c.texto.trim() }))
      .filter((c) => c.titulo || c.texto),
  }
}

export const nombreArchivoMinutaArrendamiento = (numero: number, arrendador: string) =>
  `minuta-arrendamiento-${numero}-${arrendador
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40)}.pdf`

// ---------------------------------------------------------------- origen de cada dato
// Campos cuyo valor inicial es texto de la plantilla (los demás salen de la
// solicitud, el contratista o el proyecto).
const CAMPOS_DE_PLANTILLA = new Set<keyof MinutaArrendamiento>(["arrendatarioCorreo", "paragrafoAdministracion"])

export function origenCampoArrendamiento(clave: keyof MinutaArrendamiento, actual: string, defecto: MinutaArrendamiento): OrigenDato {
  if (!actual.trim()) return "vacio"
  const inicial = defecto[clave]
  if (typeof inicial !== "string" || actual !== inicial) return "editado"
  if (CAMPOS_DE_PLANTILLA.has(clave)) return "plantilla"
  if (clave === "arrendatarioNombre") return actual === CONTRATANTE_POR_DEFECTO.nombre ? "plantilla" : "solicitud"
  if (clave === "arrendatarioNit") return actual === CONTRATANTE_POR_DEFECTO.nit ? "plantilla" : "solicitud"
  return "solicitud"
}
