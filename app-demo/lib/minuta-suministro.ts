// ---------------------------------------------------------------------------
// Minuta del contrato de suministro (formato GJ-F-012 de Jurídica), para las
// solicitudes de "Suministro e instalación".
//
// Igual que las de mano de obra y arrendamiento: todo lo que la plantilla deja
// en "XXX" es un campo de MinutaSuministro, se llena con los datos de la
// solicitud (minutaSuministroPorDefecto), Jurídica lo edita en Pre-aprobación
// y se guarda en contratos.minuta_datos. El texto fijo de las cláusulas está
// en components/minuta-suministro-pdf.tsx. La empresa del proyecto es el
// CONTRATANTE y el contratista del directorio el CONTRATISTA. Sin
// dependencias de servidor.
// ---------------------------------------------------------------------------

import { esNoAplica, porcentajeEnLetras, type SolicitudContratoDetalle } from "@/lib/contratos"
import {
  CONTRATANTE_POR_DEFECTO,
  cantidadEnLetras,
  pesosSinSimbolo,
  valorEnLetras,
  type ClausulaAdicional,
  type DatosExtraMinuta,
  type ItemAnexoMinuta,
  type OrigenDato,
} from "@/lib/minuta-mano-obra"
import { TIPOS_DOCUMENTO_ARRENDADOR, type TipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"

export const VERSION_MINUTA_SUMINISTRO = 1

// Garantía de la novena: una fila de la tabla de amparos.
export type AmparoGarantia = { amparo: string; porcentaje: string; vigencia: string }

export type MinutaSuministro = {
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
  contratistaNombre: string // persona natural o razón social
  contratistaNit: string // jurídica
  contratistaRepresentante: string // jurídica: representante legal
  contratistaTipoDocumento: TipoDocumentoArrendador // natural: el suyo; jurídica: el del representante
  contratistaCedula: string // número de ese documento
  contratistaCedulaExpedida: string
  contratistaCiudad: string // domicilio
  contratistaCorreo: string
  // Primera: objeto y especificaciones
  objeto: string
  obra: string
  items: ItemAnexoMinuta[]
  // Segunda: valor y forma de pago
  valor: string
  valorLetras: string
  formaPago: string
  // Tercera: plazo
  plazo: string // "treinta (30) días calendario"
  // Cuarta y quinta: obligaciones
  obligacionesContratante: string[]
  obligacionesContratista: string[]
  // Séptima: lugar de ejecución
  ciudadEjecucion: string
  // Novena: garantía
  amparos: AmparoGarantia[]
  // Décima: cláusula penal y multas
  clausulaPenalPorcentaje: string
  multaDiariaPorcentaje: string
  // Décima cuarta: domicilio
  domicilioCiudad: string
  // Cláusulas agregadas después de la décima octava
  clausulasAdicionales: ClausulaAdicional[]
}

// ---------------------------------------------------------------- texto de la plantilla
export const OBLIGACIONES_CONTRATANTE_SUMINISTRO = [
  "Contar los recursos necesarios para cumplir cabalmente el pago de los bienes que el Contratista haya entregado a este con base en el presente contrato.",
  "Suministrar la información que sea requerida por el contratista para la correcta ejecución del contrato.",
  "Realizar la supervisión del contrato a través del funcionario designado por la gerencia.",
  "Pagar oportunamente el valor de los bienes y/o servicios, dentro de los plazos fijados en el contrato.",
]

export const OBLIGACIONES_CONTRATISTA_SUMINISTRO = [
  "Cumplir con el objeto y especificaciones técnicas del contrato en el plazo estipulado.",
  "Realizar la entrega de los materiales de construcción objeto del contrato dentro del término establecido y con las especificaciones requeridas.",
  "Garantizar la calidad y mantener el precio de los materiales de construcción, a entregar de conformidad con lo acordado en el contrato y la cotización presentada.",
  "Acatar las directrices que durante el desarrollo del contrato le imparta el CONTRATANTE.",
  "Estar al día con el pago de la seguridad social (Salud, Pensión, Riesgos laborales) y parafiscales del personal que disponga para la ejecución del presente contrato.",
  "Asumir de manera total y exclusiva, la responsabilidad derivada de la calidad e idoneidad de los items objeto del contrato, así como de los actos u omisiones del personal a su cargo. En consecuencia, se compromete a mantener libre al CONTRATANTE de cualquier responsabilidad por este aspecto.",
  "Las demás que se requieran para el cabal cumplimiento del objeto contractual.",
]

export const PAGO_PERIODICO =
  "Se efectuarán pagos periódicos por cantidad de elementos suministrados sin superar el valor definido para el presente contrato."

export const AMPARO_ANTICIPO: AmparoGarantia = { amparo: "Buen manejo de anticipo", porcentaje: "100", vigencia: "Término de duración del contrato" }
export const AMPAROS_PLANTILLA: AmparoGarantia[] = [
  { amparo: "Cumplimiento", porcentaje: "20", vigencia: "Termino de duración del contrato y 3 meses más" },
  { amparo: "Calidad de los bienes", porcentaje: "10", vigencia: "Término de duración del contrato y 2 años más" },
]

// Títulos de las cláusulas, en el orden y con la numeración de la plantilla.
export const CLAUSULAS_SUMINISTRO = [
  "PRIMERA. – OBJETO",
  "SEGUNDO. - VALOR Y FORMA DE PAGO",
  "TERCERA. - PLAZO DEL CONTRATO",
  "CUARTA. - OBLIGACIONES DEL CONTRATANTE",
  "QUINTA - OBLIGACIONES DEL CONTRATISTA",
  "SEXTA - SUPERVISIÓN",
  "SEPTIMA. - LUGAR DE EJECUCIÓN",
  "OCTAVA - SOLUCION DIRECTA DE LAS CONTROVERSIAS CONTRACTUALES",
  "NOVENA - GARANTIA",
  "DECIMA. – CLAUSULA PENAL Y MULTAS",
  "DECIMA PRIMERA. - MODIFICACIONES",
  "DÉCIMO SEGUNDA - CESIÓN",
  "DECIMA TERCERA. - CAUSALES DE TERMINACIÓN",
  "DECIMA CUARTA. - DOMICILIO",
  "DECIMA QUINTA. - DOCUMENTOS DEL CONTRATO",
  "DECIMA SEXTA. - CONFIDENCIALIDAD",
  "DECIMA SEPTIMA. – PERFECCIONAMIENTO",
  "DECIMA OCTAVA. – NOTIFICACIONES",
]
export const PRIMERA_CLAUSULA_ADICIONAL_SUMINISTRO = CLAUSULAS_SUMINISTRO.length + 1

// ---------------------------------------------------------------- valores por defecto
const numeroTexto = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 }).format(n)
const conUnidad = (n: number, singular: string, plural: string) => `${cantidadEnLetras(n)} ${n === 1 ? singular : plural}`

function diasEntre(inicio: string, fin: string): number | null {
  const a = Date.parse(`${inicio}T00:00:00Z`)
  const b = Date.parse(`${fin}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null
  return Math.round((b - a) / 86_400_000)
}

// "treinta (30) días calendario" (la plantilla cuenta en días calendario):
// por duración, o los días entre las fechas de la solicitud.
function plazoPorDefecto(d: SolicitudContratoDetalle): string {
  if (d.plazoTipo === "duracion" && d.duracionCantidad) {
    return d.duracionUnidad === "dias"
      ? conUnidad(d.duracionCantidad, "día calendario", "días calendario")
      : conUnidad(d.duracionCantidad, "mes", "meses")
  }
  if (d.fechaInicio && d.fechaFin) {
    const dias = diasEntre(d.fechaInicio, d.fechaFin)
    if (dias) return conUnidad(dias, "día calendario", "días calendario")
  }
  return ""
}

// Anticipo como lo escribe la plantilla: "del 30% correspondiente a TRES
// MILLONES DE PESOS ($3.000.000) M/CTE".
export function textoAnticipo(porcentaje: number, valor: number): string {
  const monto = Math.round(((valor * porcentaje) / 100) * 100) / 100
  return `Se entregará un anticipo del ${porcentajeEnLetras(porcentaje)} correspondiente a ${valorEnLetras(monto)} ($${pesosSinSimbolo(monto)}) M/CTE, el cual se amortizará de manera proporcional en cada cuanta de cobro parcial hasta cubrir la totalidad del anticipo.`
}

const sinPuntoFinal = (t: string) => t.trim().replace(/\.$/, "")

export function minutaSuministroPorDefecto(d: SolicitudContratoDetalle, extra: DatosExtraMinuta, hoy: string): MinutaSuministro {
  const juridica = d.contratistaTipoPersona === "juridica"
  const nit =
    extra.contratistaTipoDocumento === "NIT" && extra.contratistaNumeroDocumento
      ? `${extra.contratistaNumeroDocumento}${extra.contratistaDv !== null ? `-${extra.contratistaDv}` : ""}`
      : ""
  const tipoDocumento = juridica ? extra.contratistaRepresentanteTipoDocumento : extra.contratistaTipoDocumento
  const ciudadProyecto = extra.proyectoCiudad ?? ""
  const formaPago = [
    PAGO_PERIODICO,
    d.tieneAnticipo && d.anticipoPorcentaje ? textoAnticipo(d.anticipoPorcentaje, d.valor) : "",
    d.formaPago.trim(),
  ]
    .filter(Boolean)
    .join(" ")

  const items: ItemAnexoMinuta[] =
    d.items.length > 0
      ? d.items.map((it) => ({
          actividad: [it.codigo, it.actividad].filter(Boolean).join(" "),
          unidad: it.unidad,
          cantidad: numeroTexto(it.cantidad),
          valorUnitario: numeroTexto(it.valorUnitario),
        }))
      : [{ actividad: sinPuntoFinal(d.objeto), unidad: "GL", cantidad: "1", valorUnitario: numeroTexto(d.valor) }]

  return {
    v: VERSION_MINUTA_SUMINISTRO,
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
    contratistaCedulaExpedida: "",
    contratistaCiudad: extra.contratistaCiudad ?? "",
    contratistaCorreo: d.correoNotificacion,
    objeto: sinPuntoFinal(d.objeto),
    obra: d.proyectoNombre ?? "",
    items,
    valor: numeroTexto(d.valor),
    valorLetras: valorEnLetras(d.valor),
    formaPago,
    plazo: plazoPorDefecto(d),
    obligacionesContratante: [...OBLIGACIONES_CONTRATANTE_SUMINISTRO],
    obligacionesContratista: [...OBLIGACIONES_CONTRATISTA_SUMINISTRO, ...d.obligaciones.filter((o) => !esNoAplica(o))],
    ciudadEjecucion: ciudadProyecto,
    amparos: d.tieneAnticipo ? [{ ...AMPARO_ANTICIPO }, ...AMPAROS_PLANTILLA.map((a) => ({ ...a }))] : AMPAROS_PLANTILLA.map((a) => ({ ...a })),
    clausulaPenalPorcentaje: "10",
    multaDiariaPorcentaje: "0,2",
    domicilioCiudad: ciudadProyecto,
    clausulasAdicionales: [],
  }
}

export function minutaSuministroVacia(): MinutaSuministro {
  return {
    v: VERSION_MINUTA_SUMINISTRO,
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
    contratistaCiudad: "",
    contratistaCorreo: "",
    objeto: "",
    obra: "",
    items: [],
    valor: "",
    valorLetras: "",
    formaPago: "",
    plazo: "",
    obligacionesContratante: [],
    obligacionesContratista: [],
    ciudadEjecucion: "",
    amparos: [],
    clausulaPenalPorcentaje: "",
    multaDiariaPorcentaje: "",
    domicilioCiudad: "",
    clausulasAdicionales: [],
  }
}

const objetos = (valor: unknown) =>
  Array.isArray(valor) ? valor.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : null

// Lo guardado gana sobre lo calculado, campo por campo; solo campos conocidos
// y del mismo tipo.
export function mezclarMinutaSuministro(defecto: MinutaSuministro, guardada: unknown): MinutaSuministro {
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return defecto
  const g = guardada as Record<string, unknown>
  const r: Record<string, unknown> = { ...defecto }
  for (const clave of Object.keys(defecto) as (keyof MinutaSuministro)[]) {
    if (clave === "v" || !(clave in g)) continue
    const base = defecto[clave]
    const valor = g[clave]
    if (clave === "items") {
      const l = objetos(valor)
      if (l)
        r.items = l.map((x) => ({
          actividad: String(x.actividad ?? ""),
          unidad: String(x.unidad ?? ""),
          cantidad: String(x.cantidad ?? ""),
          valorUnitario: String(x.valorUnitario ?? ""),
        }))
    } else if (clave === "amparos") {
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
    } else if (typeof valor === "string") {
      r[clave] = valor
    }
  }
  return r as MinutaSuministro
}

export function limpiarMinutaSuministro(m: MinutaSuministro): MinutaSuministro {
  const lista = (l: string[]) => l.map((t) => t.trim()).filter(Boolean)
  return {
    ...m,
    v: VERSION_MINUTA_SUMINISTRO,
    obligacionesContratante: lista(m.obligacionesContratante),
    obligacionesContratista: lista(m.obligacionesContratista),
    items: m.items
      .map((it) => ({ actividad: it.actividad.trim(), unidad: it.unidad.trim(), cantidad: it.cantidad.trim(), valorUnitario: it.valorUnitario.trim() }))
      .filter((it) => it.actividad || it.cantidad || it.valorUnitario),
    amparos: m.amparos
      .map((a) => ({ amparo: a.amparo.trim(), porcentaje: a.porcentaje.trim(), vigencia: a.vigencia.trim() }))
      .filter((a) => a.amparo || a.porcentaje || a.vigencia),
    clausulasAdicionales: m.clausulasAdicionales
      .map((c) => ({ titulo: c.titulo.trim(), texto: c.texto.trim() }))
      .filter((c) => c.titulo || c.texto),
  }
}

export const nombreArchivoMinutaSuministro = (numero: number, contratista: string) =>
  `minuta-suministro-${numero}-${contratista
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40)}.pdf`

// ---------------------------------------------------------------- origen de cada dato
const CAMPOS_DE_PLANTILLA = new Set<keyof MinutaSuministro>(["contratanteCorreo", "clausulaPenalPorcentaje", "multaDiariaPorcentaje"])

export function origenCampoSuministro(clave: keyof MinutaSuministro, actual: string, defecto: MinutaSuministro): OrigenDato {
  if (!actual.trim()) return "vacio"
  const inicial = defecto[clave]
  if (typeof inicial !== "string" || actual !== inicial) return "editado"
  if (CAMPOS_DE_PLANTILLA.has(clave)) return "plantilla"
  if (clave === "contratanteNombre") return actual === CONTRATANTE_POR_DEFECTO.nombre ? "plantilla" : "solicitud"
  if (clave === "contratanteNit") return actual === CONTRATANTE_POR_DEFECTO.nit ? "plantilla" : "solicitud"
  return "solicitud"
}
