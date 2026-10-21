// ---------------------------------------------------------------------------
// Minuta del contrato de alquiler de vehículo o maquinaria (formato de
// Jurídica "CONTRATO DE ALQUILER DE VEHICULO O MAQUINARIA", versión 04).
//
// Igual que las demás minutas: todo lo que la plantilla deja en "XXX" es un
// campo de MinutaVehiculo, se llena con los datos de la solicitud
// (minutaVehiculoPorDefecto), Jurídica lo edita en Pre-aprobación y se guarda
// en contratos.minuta_datos. El texto fijo de las cláusulas está en
// components/minuta-vehiculo-pdf.tsx. La empresa del proyecto es EL
// CONTRATANTE y el contratista del directorio EL CONTRATISTA (propietario del
// vehículo o la maquinaria). Sin dependencias de servidor.
// ---------------------------------------------------------------------------

import { esNoAplica, type SolicitudContratoDetalle } from "@/lib/contratos"
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
import type { AmparoGarantia } from "@/lib/minuta-suministro"

export const VERSION_MINUTA_VEHICULO = 1

// Décima quinta: la plantilla trae las dos opciones ("no se exigirá" // "se
// compromete a constituir").
export type GarantiaVehiculo = "" | "no_exige" | "exige"

export type MinutaVehiculo = {
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
  contratistaCorreo: string
  // Primera: objeto
  bien: string // descripción del vehículo o la maquinaria
  bienNombre: string // nombre corto (décima sexta: "La utilización de la …")
  obra: string
  ofertaMercantil: string // número de la oferta (primera, octava y décima octava)
  // Segunda: plazo
  periodo: string // "tres (3) meses"
  horasOperacion: string // opcional: "doscientas (200) horas de operación"
  // Tercera: valor
  valor: string
  valorLetras: string
  detalleValor: string // "correspondiente a: …"
  // Cuarta: anticipo (vacío = sin anticipo)
  anticipo: string
  anticipoLetras: string
  // Quinta: forma de pago
  periodicidadPago: string // "mensuales"
  condicionesPago: string // forma de pago de la solicitud (párrafo aparte)
  // Sexta, séptima y octava: obligaciones
  obligacionesContratante: string[]
  obligacionesGenerales: string[]
  obligacionesEspecificas: string[] // la de la oferta mercantil va siempre al final (PDF)
  // Décima quinta: garantías
  garantia: GarantiaVehiculo
  amparos: AmparoGarantia[]
  // Décima séptima: domicilio
  domicilio: string
  // Vigésima segunda: lugar de ejecución
  ciudadEjecucion: string
  departamentoEjecucion: string
  // Cláusulas agregadas después de la vigésima cuarta
  clausulasAdicionales: ClausulaAdicional[]
}

// ---------------------------------------------------------------- texto de la plantilla
export const OBLIGACIONES_CONTRATANTE_VEHICULO = [
  "Pagar oportunamente el valor del contrato según las condiciones establecidas.",
  "Asumir el valor de las horas extras del operador que sean requeridas por el contratante.",
  "Custodiar y dar uso adecuado, y garantizar que el vehículo / maquinaria permanezca en un lugar adecuadamente resguardado y seguro durante su permanencia en la obra.",
]

export const OBLIGACIONES_GENERALES_VEHICULO = [
  "Cumplir con lo pactado en este negocio jurídico conforme a lo establecido en el objeto del presente contrato y plazo determinado de acuerdo con lo establecido.",
  "Obrar con lealtad y buena fe.",
  "Abstenerse de retirar, trasladar o disponer, total o parcialmente el vehículo / maquinaria puesta a disposición del contratante, antes de la finalización del período de operación contratado, sin autorización previa y expresa del contratante.",
  "Reportar al contratante cualquier novedad o anomalía que impida la normal ejecución del contrato.",
]

// Sin la 7.ª (la de la oferta mercantil): esa lleva el número de la oferta y
// el PDF la pone siempre al final.
export const OBLIGACIONES_ESPECIFICAS_VEHICULO = [
  "Entregar y poner a disposición del contratante el bien objeto de alquiler en condiciones adecuadas de funcionamiento, seguridad y operación.",
  "Suministrar el operador requerido para la operación del vehículo durante la jornada ordinaria pactada de cuarenta y dos (42) horas semanales, de lunes a sábado, en jornada diurna.",
  "Realizar el mantenimiento preventivo y correctivo del bien alquilado necesario para su operación normal, incluyendo los filtros, aceites y mano de obra correspondientes.",
  "Atender las fallas o novedades mecánicas que sean atribuibles al funcionamiento normal del vehículo/maquinaria y efectuar las reparaciones que se encuentren a su cargo.",
  "Informar oportunamente al contratante cualquier falla, daño, novedad mecánica o circunstancia que pueda afectar la disponibilidad o funcionamiento de la maquinaria.",
  "Coordinar con el contratante las actividades de mantenimiento, procurando que estas se desarrollen de manera que afecten lo menos posible la operación del vehículo/maquinaria.",
]

export const obligacionOferta = (oferta: string) =>
  `Cumplir las demás obligaciones técnicas y operativas expresamente establecidas en la Oferta Mercantil No. ${oferta.trim() || "__________"} que correspondan a el contratista.`

export const AMPARO_ANTICIPO_VEHICULO: AmparoGarantia = { amparo: "Buen manejo de anticipo", porcentaje: "100", vigencia: "Término de duración del contrato" }
export const AMPAROS_VEHICULO: AmparoGarantia[] = [
  { amparo: "Cumplimiento", porcentaje: "5", vigencia: "Termino de duración del contrato y 3 meses más" },
  { amparo: "Salarios y prestaciones sociales", porcentaje: "10", vigencia: "Término de duración del contrato y 3 años más" },
]

export const OPCIONES_GARANTIA_VEHICULO: { valor: Exclude<GarantiaVehiculo, "">; titulo: string }[] = [
  { valor: "exige", titulo: "Se exige garantía (tabla de amparos)" },
  { valor: "no_exige", titulo: "No se exigen garantías" },
]

export const DOMICILIO_PLANTILLA = "Barranquilla – Atlántico"

// Títulos de las cláusulas, en el orden y con la numeración de la plantilla.
export const CLAUSULAS_VEHICULO = [
  "PRIMERA. OBJETO",
  "SEGUNDA. PLAZO DEL CONTRATO",
  "TERCERA. VALOR DEL CONTRATO",
  "CUARTA. ANTICIPO",
  "QUINTA. FORMA DE PAGO",
  "SEXTA. OBLIGACIONES DEL CONTRATANTE",
  "SÉPTIMA. OBLIGACIONES GENERALES DEL CONTRATISTA",
  "OCTAVA. OBLIGACIONES ESPECÍFICAS DEL CONTRATISTA",
  "NOVENA. INDEPENDENCIA DEL CONTRATISTA",
  "DÉCIMA. CESIÓN O SUBCONTRATACIÓN DEL OBJETO DEL CONTRATO",
  "DÉCIMA PRIMERA. MANTENIMIENTO Y REPARACIONES",
  "DÉCIMA SEGUNDA. RESPONSABILIDAD",
  "DÉCIMA TERCERA. - MODIFICACIONES",
  "DÉCIMA CUARTA. CAUSALES DE TERMINACIÓN",
  "DÉCIMA QUINTA. GARANTÍAS",
  "DÉCIMA SEXTA. PERÍODOS ADICIONALES Y PRÓRROGA",
  "DÉCIMA SÉPTIMA. DOMICILIO",
  "DÉCIMA OCTAVA. DOCUMENTOS DEL CONTRATO",
  "DÉCIMA NOVENA. SOLUCIÓN DE CONTROVERSIAS",
  "VIGÉSIMA. LIQUIDACIÓN DEL CONTRATO",
  "VIGÉSIMA PRIMERA. SUPERVISIÓN",
  "VIGÉSIMA SEGUNDA- LUGAR DE EJECUCIÓN",
  "VIGÉSIMA TERCERA. – REQUISITOS DE PERFECCIONAMIENTO Y EJECUCIÓN",
  "VIGÉSIMA CUARTA. – NOTIFICACIONES",
]
export const PRIMERA_CLAUSULA_ADICIONAL_VEHICULO = CLAUSULAS_VEHICULO.length + 1

// ---------------------------------------------------------------- valores por defecto
const numeroTexto = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 }).format(n)
const conUnidad = (n: number, singular: string, plural: string) => `${cantidadEnLetras(n)} ${n === 1 ? singular : plural}`

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
function periodoPorDefecto(d: SolicitudContratoDetalle): string {
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

// "correspondiente a: …": el valor mensual y, si la solicitud es por valores
// unitarios, cada línea con su cantidad y valor.
function detalleValorPorDefecto(d: SolicitudContratoDetalle): string {
  const partes: string[] = []
  if (d.valorMensual !== null) partes.push(`un valor mensual de ${valorEnLetras(d.valorMensual)} M/CTE ($${pesosSinSimbolo(d.valorMensual)})`)
  for (const it of d.items) {
    const desc = [it.codigo, it.actividad].filter(Boolean).join(" ")
    partes.push(`${desc}: ${numeroTexto(it.cantidad)} ${it.unidad} a $${pesosSinSimbolo(it.valorUnitario)} cada uno`)
  }
  return partes.length > 0 ? `${partes.join("; ")}.` : ""
}

const sinPuntoFinal = (t: string) => t.trim().replace(/\.$/, "")

// El objeto de la solicitud empieza con un verbo ("Alquilar una
// retroexcavadora..."); en la primera va solo lo que se alquila ("una
// retroexcavadora...").
export function bienDesdeObjeto(objeto: string): string {
  const t = sinPuntoFinal(objeto)
  const sinVerbo = t.replace(/^(alquilar|arrendar|contratar(\s+el\s+alquiler\s+de)?|tomar\s+en\s+alquiler)\s+/i, "")
  return sinVerbo === t ? t : sinVerbo
}

export function minutaVehiculoPorDefecto(d: SolicitudContratoDetalle, extra: DatosExtraMinuta, hoy: string): MinutaVehiculo {
  const juridica = d.contratistaTipoPersona === "juridica"
  const nit =
    extra.contratistaTipoDocumento === "NIT" && extra.contratistaNumeroDocumento
      ? `${extra.contratistaNumeroDocumento}${extra.contratistaDv !== null ? `-${extra.contratistaDv}` : ""}`
      : ""
  const tipoDocumento = juridica ? extra.contratistaRepresentanteTipoDocumento : extra.contratistaTipoDocumento
  const ciudadProyecto = extra.proyectoCiudad ?? ""
  const conAnticipo = d.tieneAnticipo && d.anticipoPorcentaje
  const montoAnticipo = conAnticipo ? Math.round(((d.valor * d.anticipoPorcentaje!) / 100) * 100) / 100 : null

  return {
    v: VERSION_MINUTA_VEHICULO,
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
    contratistaCorreo: d.correoNotificacion,
    bien: bienDesdeObjeto(d.objeto),
    bienNombre: d.datosTipo.bienNombre ?? "",
    obra: d.proyectoNombre ?? "",
    ofertaMercantil: "",
    periodo: periodoPorDefecto(d),
    horasOperacion: "",
    valor: numeroTexto(d.valor),
    valorLetras: valorEnLetras(d.valor),
    detalleValor: detalleValorPorDefecto(d),
    anticipo: montoAnticipo !== null ? numeroTexto(montoAnticipo) : "",
    anticipoLetras: montoAnticipo !== null ? valorEnLetras(montoAnticipo) : "",
    periodicidadPago: d.datosTipo.actas ?? "",
    condicionesPago: d.formaPago.trim(),
    obligacionesContratante: [...OBLIGACIONES_CONTRATANTE_VEHICULO],
    obligacionesGenerales: [...OBLIGACIONES_GENERALES_VEHICULO],
    obligacionesEspecificas: [...OBLIGACIONES_ESPECIFICAS_VEHICULO, ...d.obligaciones.filter((o) => !esNoAplica(o))],
    garantia: d.datosTipo.exigeGarantia === undefined ? "" : d.datosTipo.exigeGarantia ? "exige" : "no_exige",
    amparos: conAnticipo ? [{ ...AMPARO_ANTICIPO_VEHICULO }, ...AMPAROS_VEHICULO.map((a) => ({ ...a }))] : AMPAROS_VEHICULO.map((a) => ({ ...a })),
    domicilio: d.domicilioDepartamento ? [ciudadProyecto, d.domicilioDepartamento].filter(Boolean).join(" – ") : DOMICILIO_PLANTILLA,
    ciudadEjecucion: ciudadProyecto,
    departamentoEjecucion: d.domicilioDepartamento ?? "",
    clausulasAdicionales: [],
  }
}

export function minutaVehiculoVacia(): MinutaVehiculo {
  return {
    v: VERSION_MINUTA_VEHICULO,
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
    contratistaCorreo: "",
    bien: "",
    bienNombre: "",
    obra: "",
    ofertaMercantil: "",
    periodo: "",
    horasOperacion: "",
    valor: "",
    valorLetras: "",
    detalleValor: "",
    anticipo: "",
    anticipoLetras: "",
    periodicidadPago: "",
    condicionesPago: "",
    obligacionesContratante: [],
    obligacionesGenerales: [],
    obligacionesEspecificas: [],
    garantia: "",
    amparos: [],
    domicilio: "",
    ciudadEjecucion: "",
    departamentoEjecucion: "",
    clausulasAdicionales: [],
  }
}

const objetos = (valor: unknown) =>
  Array.isArray(valor) ? valor.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : null

// Lo guardado gana sobre lo calculado, campo por campo; solo campos conocidos
// y del mismo tipo.
export function mezclarMinutaVehiculo(defecto: MinutaVehiculo, guardada: unknown): MinutaVehiculo {
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return defecto
  const g = guardada as Record<string, unknown>
  const r: Record<string, unknown> = { ...defecto }
  for (const clave of Object.keys(defecto) as (keyof MinutaVehiculo)[]) {
    if (clave === "v" || !(clave in g)) continue
    const base = defecto[clave]
    const valor = g[clave]
    if (clave === "amparos") {
      const l = objetos(valor)
      if (l) r.amparos = l.map((x) => ({ amparo: String(x.amparo ?? ""), porcentaje: String(x.porcentaje ?? ""), vigencia: String(x.vigencia ?? "") }))
    } else if (clave === "clausulasAdicionales") {
      const l = objetos(valor)
      if (l) r.clausulasAdicionales = l.map((x) => ({ titulo: String(x.titulo ?? ""), texto: String(x.texto ?? "") }))
    } else if (Array.isArray(base)) {
      if (Array.isArray(valor)) r[clave] = valor.map((x) => String(x ?? ""))
    } else if (clave === "contratistaTipoPersona") {
      if (valor === "natural" || valor === "juridica") r[clave] = valor
    } else if (clave === "contratistaTipoDocumento") {
      if (TIPOS_DOCUMENTO_ARRENDADOR.some((t) => t.valor === valor)) r[clave] = valor
    } else if (clave === "garantia") {
      if (valor === "" || valor === "exige" || valor === "no_exige") r[clave] = valor
    } else if (typeof valor === "string") {
      r[clave] = valor
    }
  }
  return r as MinutaVehiculo
}

export function limpiarMinutaVehiculo(m: MinutaVehiculo): MinutaVehiculo {
  const lista = (l: string[]) => l.map((t) => t.trim()).filter(Boolean)
  return {
    ...m,
    v: VERSION_MINUTA_VEHICULO,
    obligacionesContratante: lista(m.obligacionesContratante),
    obligacionesGenerales: lista(m.obligacionesGenerales),
    obligacionesEspecificas: lista(m.obligacionesEspecificas),
    amparos: m.amparos
      .map((a) => ({ amparo: a.amparo.trim(), porcentaje: a.porcentaje.trim(), vigencia: a.vigencia.trim() }))
      .filter((a) => a.amparo || a.porcentaje || a.vigencia),
    clausulasAdicionales: m.clausulasAdicionales
      .map((c) => ({ titulo: c.titulo.trim(), texto: c.texto.trim() }))
      .filter((c) => c.titulo || c.texto),
  }
}

export const nombreArchivoMinutaVehiculo = (numero: number, contratista: string) =>
  `minuta-alquiler-${numero}-${contratista
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40)}.pdf`

// ---------------------------------------------------------------- origen de cada dato
const CAMPOS_DE_PLANTILLA = new Set<keyof MinutaVehiculo>(["contratanteCorreo", "domicilio"])

export function origenCampoVehiculo(clave: keyof MinutaVehiculo, actual: string, defecto: MinutaVehiculo): OrigenDato {
  if (!actual.trim()) return "vacio"
  const inicial = defecto[clave]
  if (typeof inicial !== "string" || actual !== inicial) return "editado"
  if (CAMPOS_DE_PLANTILLA.has(clave)) return "plantilla"
  if (clave === "contratanteNombre") return actual === CONTRATANTE_POR_DEFECTO.nombre ? "plantilla" : "solicitud"
  if (clave === "contratanteNit") return actual === CONTRATANTE_POR_DEFECTO.nit ? "plantilla" : "solicitud"
  return "solicitud"
}
