// ---------------------------------------------------------------------------
// Minuta del contrato de obra a todo costo (formato de Jurídica "CONTRATO DE
// OBRA TC", versión 04) y del contrato de mano de obra (GJ-F-003 versión 04,
// 9/05/2025): las dos plantillas tienen las mismas 27 cláusulas y casi el
// mismo texto; `variante` dice cuál es. Las minutas de mano de obra hechas con
// la plantilla anterior (versión 01, lib/minuta-mano-obra.ts) no tienen
// `variante` y siguen con su PDF de siempre (esMinutaManoObra04).
//
// Igual que las demás minutas: todo lo que la plantilla deja en "XXX" es un
// campo de MinutaObra, se llena con los datos de la solicitud
// (minutaObraPorDefecto), Jurídica lo edita en Pre-aprobación y se guarda en
// contratos.minuta_datos. El texto fijo de las cláusulas está en
// components/minuta-obra-pdf.tsx. Lleva un anexo N° 1 con las actividades,
// cantidades y valores (como la de mano de obra). Sin dependencias de
// servidor.
// ---------------------------------------------------------------------------

import { esNoAplica, type SolicitudContratoDetalle } from "@/lib/contratos"
import {
  CONTRATANTE_POR_DEFECTO,
  cantidadEnLetras,
  valorEnLetras,
  type ClausulaAdicional,
  type DatosExtraMinuta,
  type ItemAnexoMinuta,
  type OrigenDato,
} from "@/lib/minuta-mano-obra"
import { TIPOS_DOCUMENTO_ARRENDADOR, type TipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"
import type { AmparoGarantia } from "@/lib/minuta-suministro"

export const VERSION_MINUTA_OBRA = 1

export type VarianteMinutaObra = "obra" | "mano_obra"

export type MinutaObra = {
  v: number
  // "obra" = a todo costo; "mano_obra" = solo mano de obra
  variante: VarianteMinutaObra
  // Firma (cierre). Obra: "en el Departamento de …"; mano de obra: "en …"
  departamentoFirma: string
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
  // Primera: objeto y anexo N° 1
  obra: string
  items: ItemAnexoMinuta[]
  // Segunda: plazo ("noventa (90) días" + " calendario")
  plazo: string
  // Tercera: valor
  valor: string
  valorLetras: string
  // Cuarta: anticipo (porcentaje vacío = sin anticipo)
  anticipoPorcentaje: string
  anticipo: string
  anticipoLetras: string
  amortizacion: string // "El Anticipo será amortizado en el …"
  // Quinta: forma de pago
  periodicidadPago: string // "Se pagará cada …"
  retencion: "" | "si" | "no" // ¿hay retención en garantía? (parágrafo tercero)
  retencionGarantia: string // parágrafo tercero: "retención … del … del valor del contrato"
  condicionesPago: string // forma de pago de la solicitud (párrafo aparte)
  // Sexta a octava: obligaciones
  obligacionesContratante: string[]
  obligacionesGenerales: string[]
  obligacionesEspecificas: string[]
  // Décima octava: garantías ("no" solo en mano de obra: no se exigen)
  exigeGarantia: "si" | "no"
  amparos: AmparoGarantia[]
  // Décima novena: domicilio
  domicilioDepartamento: string
  // Vigésima quinta: lugar de ejecución (obra: municipio; mano de obra: departamento)
  municipioEjecucion: string
  // Cláusulas agregadas después de la vigésima séptima
  clausulasAdicionales: ClausulaAdicional[]
}

// ---------------------------------------------------------------- texto de la plantilla
export const OBLIGACIONES_CONTRATANTE_OBRA = [
  "Proporcionar a el contratista toda la información básica para la ejecución del trabajo, que será disponible, fiable, correcta, actualizada y completa.",
  "Pagar cumplidamente el valor del contrato como contraprestación a la elaboración de la mano de obra encargada en la forma y condiciones establecidas en presente contrato.",
  "El contratante se reserva la facultad de dirigir, coordinar y supervisar las actividades de mano de obra a través del supervisor que designe el contratante.",
  "Exigir al contratista la ejecución idónea y oportuna del objeto del contrato.",
  "Realizar los pagos de nóminas, seguridad social y liquidaciones de los trabajadores del contratista, en caso de ser solicitado por este mismo, valores que serán descontados de las cuentas parciales o final.",
  "Designar supervisor para la verificación y seguimiento de los trabajos.",
  "Exigir a el contratista la ejecución idónea y oportuna del objeto contractual.",
]

export const OBLIGACIONES_GENERALES_OBRA = [
  "Cumplir con lo pactado en este negocio jurídico conforme a lo establecido en el objeto del presente contrato y plazo determinado de acuerdo con las actividades establecidas.",
  "Realizar su mejor esfuerzo en la ejecución, terminación y entrega de las actividades de mano de obra contratada de modo diligente y competente, dentro de los plazos acordados.",
  "Obrar con lealtad y buena fe.",
  "Realizar las afiliaciones al sistema de seguridad social de los empleados que disponga para la ejecución del presente contrato.",
  "Reportar al contratante cualquier novedad o anomalía que impida la normal ejecución del contrato.",
  "Responder ante el contratante por la ejecución de actividades que realicen los dependientes del contratista o terceros contratados por éste. El contratista garantizará el trabajo de dichos terceros y de la observancia de los protocolos de salud y seguridad en el trabajo de acuerdo a los reglamentos aplicables al contratante.",
  "Mantener indemne al contratante, por todo daño a terceros y a bienes que puedan realizar los empleados y/o dependientes del contratista.",
  "Realizar de manera cumplida los pagos de seguridad social, salarios, liquidaciones, prestaciones sociales y exámenes médicos.",
  "Aplicar el Sistema Integrado de Gestión como también cumplir con lo estipulado en el reglamento interno de trabajo, código de conducta y obligaciones en materia de seguridad y salud en el trabajo, sin perjuicio del régimen disciplinario laboral que aplique el contratista a sus dependientes.",
  "Suministrar todos los materiales, insumos, herramientas, equipos, maquinaria y demás recursos que sean necesarios para la ejecución de las actividades contratadas, salvo aquellos expresamente asignados a el contratante.",
  "Asumir los costos de transporte, cargue, descargue, almacenamiento y movilización de los elementos que se encuentren a su cargo.",
  "Garantizar la calidad de los materiales y actividades que suministre y ejecute.",
  "Mantener durante toda la ejecución los recursos humanos, técnicos y materiales necesarios para cumplir oportunamente con el objeto contractual.",
]

// La plantilla salta los números 3, 8 y 17: aquí van seguidas.
export const OBLIGACIONES_ESPECIFICAS_OBRA = [
  "Ejecutar las actividades de obra civil asignadas.",
  "Suministrar la totalidad de la mano de obra, materiales, insumos, herramientas, equipos, maquinaria y demás recursos necesarios para la ejecución de las actividades contratadas.",
  "Mantener un registro fotográfico diario del avance.",
  "Presentar mensualmente planillas de seguridad social, relación del personal y asistencia.",
  "No modificar alcances, cantidades o especificaciones sin autorización escrita del supervisor.",
  "Atender oportunamente las garantías por deficiencias en la ejecución.",
  "Mantener un trato respetuoso con los beneficiarios.",
  "Garantizar permanentemente la presencia en obra de un técnico, ingeniero civil, arquitecto o maestro de obra con experiencia.",
  "Mantener las áreas intervenidas en orden y aseo, dejando los escombros debidamente recogidos y acopiados en el sitio indicado por el supervisor para su posterior recolección por el contratante.",
  "Responder por las actuaciones de todo su personal, incluyendo daños, hurtos, negligencia o abandono injustificado de la obra.",
  "Adoptar las medidas necesarias para garantizar la continuidad de las obras en caso de abandono por parte de su personal.",
  "Cumplir las leyes y los reglamentos relativos a Salud Ocupacional y Seguridad Industrial y tomar todas aquellas precauciones necesarias para evitar que se produzcan en las zonas de sus campamentos de trabajo, accidentes o condiciones insalubres, que puedan afectar la integridad del personal de obra, terceros y bienes.",
  "Dotar a su personal de los elementos de protección personal y seguridad industrial (EPP) y asegurar el uso adecuado de los mismos. En el evento en que el personal se encuentre laborando sin haber recibido la dotación o sin hacer uso de ella, ésta será entregada por el contratante, y su valor será descontado al contratista con un 20% adicional por costos de administración, sin perjuicio de incurrir en incumplimientos contractuales que generen imposición de multa.",
  "Mantener una carpeta digital organizada por cada mes de ejecución que contenga las planillas de inducción del personal que ingresa, planillas de entrega de Equipos de Protección Personal (EPP), planillas de afiliación y pago de seguridad social, paz y salvos laborales y registro fotográfico del avance de obra. Esta carpeta debe actualizarse de forma continua y presentarse como soporte documental en cada solicitud de pago parcial.",
  "Atender oportunamente cualquier garantía de los trabajos solicitada por el Contratante, en caso de no atenderla el contratante bajo sus propios medios, buscará subsanar la situación presentada y se descontará del valor por pagar del saldo total a favor del contratista.",
  "Entregar las actividades completamente terminadas y en condiciones de recibo a satisfacción del contratante.",
  "Presentar los soportes de calidad de materiales cuando estos sean requeridos conforme a las especificaciones técnicas del proyecto.",
]

// ---------------------------------------------------------------- mano de obra (GJ-F-003 versión 04)
export const OBLIGACIONES_CONTRATANTE_MANO_OBRA = [
  "Proporcionar a el contratista toda la información necesaria para la adecuada ejecución del objeto contractual.",
  "Pagar oportunamente el valor del contrato, de conformidad con las condiciones establecidas en el presente documento.",
  "El contratante se reserva la facultad de dirigir, coordinar y supervisar las actividades de mano de obra a través del supervisor que designe el contratante.",
  "Exigir al contratista la ejecución idónea y oportuna del objeto del contrato.",
  "Suministrar oportunamente los materiales e insumos principales que, de acuerdo con el objeto contractual, sean de su responsabilidad.",
  "Entregar oportunamente las áreas de trabajo necesarias para la ejecución de las actividades contratadas.",
  "Facilitar la coordinación necesaria para la adecuada ejecución de las actividades.",
  "Recibir y revisar los informes, actas y demás entregables presentados por el contratista.",
]

export const OBLIGACIONES_GENERALES_MANO_OBRA = [
  "Cumplir con lo pactado en este negocio jurídico conforme a lo establecido en el objeto del presente contrato y plazo determinado de acuerdo con las actividades establecidas.",
  "Realizar su mejor esfuerzo en la ejecución, terminación y entrega de las actividades de mano de obra contratada de modo diligente y competente, dentro de los plazos acordados.",
  "Obrar con lealtad y buena fe.",
  "Realizar las afiliaciones al sistema de seguridad social de los empleados que disponga para la ejecución del presente contrato.",
  "Reportar al contratante cualquier novedad o anomalía que impida la normal ejecución del contrato.",
  "Responder ante el contratante por la ejecución de actividades que realicen los dependientes del contratista o terceros contratados por éste. El contratista garantizará el trabajo de dichos terceros y de la observancia de los protocolos de salud y seguridad en el trabajo de acuerdo a los reglamentos aplicables al contratante.",
  "Mantener indemne al contratante, por todo daño a terceros y a bienes que puedan realizar los empleados y/o dependientes del contratista.",
  "Realizar de manera cumplida los pagos de seguridad social, salarios, liquidaciones, prestaciones sociales y exámenes médicos.",
  "Aplicar el Sistema Integrado de Gestión, como también cumplir con lo estipulado en el reglamento interno de trabajo, código de conducta y obligaciones en materia de seguridad y salud en el trabajo, sin perjuicio del régimen disciplinario laboral que aplique el contratista a sus dependientes.",
  "Mantener durante la ejecución del contrato el personal suficiente y técnicamente competente para cumplir oportunamente las actividades contratadas.",
  "Entregar oportunamente los soportes e informes requeridos por el contratante.",
]

export const OBLIGACIONES_ESPECIFICAS_MANO_OBRA = [
  "Ejecutar las actividades de mano de obra correspondientes a las obras civiles objeto del presente contrato.",
  "Suministrar la totalidad de la mano de obra necesaria para la ejecución de las actividades contratadas.",
  "Suministrar las herramientas menores y equipos menores que sean necesarios para la ejecución de las actividades, siempre que estos se encuentren comprendidos dentro del alcance económico pactado.",
  "Ejecutar los trabajos de acuerdo con las cantidades, especificaciones técnicas, diseños, instrucciones y programación aprobados.",
  "Ejecutar las actividades cumpliendo los estándares de calidad, seguridad y oportunidad exigidos para el proyecto.",
  "Mantener un registro fotográfico periódico del avance de las actividades ejecutadas.",
  "Presentar los informes y soportes requeridos por EL CONTRATANTE y/o el supervisor.",
  "Presentar periódicamente las planillas de seguridad social correspondientes al personal que intervenga en la ejecución del contrato.",
  "Presentar la relación actualizada del personal vinculado a la obra.",
  "No modificar cantidades, especificaciones, actividades o alcances sin autorización previa y escrita del supervisor o de EL CONTRATANTE.",
  "Utilizar de manera adecuada y eficiente los materiales suministrados por EL CONTRATANTE.",
  "Responder por pérdidas, daños o desperdicios de materiales cuando estos sean imputables a EL CONTRATISTA, sus trabajadores o dependientes.",
  "Atender oportunamente las deficiencias de ejecución que sean atribuibles a EL CONTRATISTA.",
  "Mantener un trato respetuoso con los beneficiarios, trabajadores, funcionarios, supervisores y demás personas relacionadas con el proyecto.",
  "Garantizar permanentemente la presencia en obra de un técnico, ingeniero civil, arquitecto, maestro de obra o persona con experiencia suficiente para coordinar las actividades de mano de obra, según las necesidades del proyecto.",
  "Mantener las áreas intervenidas en condiciones adecuadas de orden y aseo.",
  "Recoger y acopiar los escombros generados por las actividades ejecutadas en los lugares indicados por el supervisor, para su posterior manejo conforme a las instrucciones del proyecto.",
  "Responder por las actuaciones de su personal, incluyendo daños, hurtos, negligencia o abandono injustificado de las actividades.",
  "Adoptar las medidas necesarias para garantizar la continuidad de las actividades en caso de ausencia o retiro de alguno de sus trabajadores.",
  "Cumplir las normas de Seguridad y Salud en el Trabajo.",
  "Acatar las instrucciones técnicas y administrativas impartidas por el supervisor, siempre que estas se encuentren relacionadas con el objeto contractual.",
  "Informar inmediatamente cualquier inconsistencia, defecto o insuficiencia que advierta en los materiales suministrados por EL CONTRATANTE que pueda afectar la calidad o correcta ejecución de los trabajos.",
  "No adquirir materiales por cuenta de EL CONTRATANTE sin autorización previa y escrita de este.",
]

export const AMPARO_ANTICIPO_OBRA: AmparoGarantia = { amparo: "Buen manejo de anticipo", porcentaje: "100", vigencia: "Término de duración del contrato" }
export const AMPAROS_OBRA: AmparoGarantia[] = [
  { amparo: "Cumplimiento", porcentaje: "5", vigencia: "Termino de duración del contrato y 3 meses más" },
  { amparo: "Salarios y prestaciones sociales", porcentaje: "10", vigencia: "Término de duración del contrato y 3 años más" },
]

export const DOMICILIO_PLANTILLA_OBRA = "Arauca"

// Títulos de las cláusulas, en el orden y con la numeración de la plantilla.
export const CLAUSULAS_OBRA = [
  "PRIMERA. OBJETO",
  "SEGUNDA. PLAZO DE EJECUCIÓN",
  "TERCERA. VALOR DEL CONTRATO",
  "CUARTA. ANTICIPO",
  "QUINTA. FORMA DE PAGO",
  "SEXTA. OBLIGACIONES DEL CONTRATANTE",
  "SEPTIMA. OBLIGACIONES GENERALES DEL CONTRATISTA",
  "OCTAVA. OBLIGACIONES ESPECIFICAS DEL CONTRATISTA",
  "NOVENA. INDEPENDENCIA DEL CONTRATISTA",
  "DECIMA. CESIÓN O SUBCONTRATACIÓN DEL OBJETO DEL CONTRATO",
  "DECIMA PRIMERA. CONTRATACIÓN DE PERSONAL",
  "DECIMA SEGUNDA. CLAUSULA PENAL",
  "DECIMA TERCERA. MULTA",
  "DECIMA CUARTA. RESPONSABILIDAD",
  "DECIMA QUINTA. INDEMNIDAD",
  "DECIMA SEXTA. - MODIFICACIONES",
  "DECIMA SEPTIMA. CAUSALES DE TERMINACIÓN",
  "DECIMA OCTAVA. GARANTIAS",
  "DECIMA NOVENA. DOMICILIO",
  "VIGESIMA. DOCUMENTOS DEL CONTRATO",
  "VIGESIMA PRIMERA. SOLUCION DE CONTROVERSIAS",
  "VIGESIMA SEGUNDA. LIQUIDACIÓN DEL CONTRATO",
  "VIGESIMA TERCERA. SUPERVISIÓN",
  "VIGESIMA CUARTA. ENTREGABLES",
  "VIGESIMA QUINTA. - LUGAR DE EJECUCIÓN",
  "VIGESIMA SEXTA. – REQUISITOS DE PERFECCIONAMIENTO Y EJECUCIÓN",
  "VIGESIMA SEPTIMA. – NOTIFICACIONES",
]
export const PRIMERA_CLAUSULA_ADICIONAL_OBRA = CLAUSULAS_OBRA.length + 1

// ---------------------------------------------------------------- valores por defecto
const numeroTexto = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 }).format(n)
const conUnidad = (n: number, singular: string, plural: string) => `${cantidadEnLetras(n)} ${n === 1 ? singular : plural}`
const sinPuntoFinal = (t: string) => t.trim().replace(/\.$/, "")

function diasEntre(inicio: string, fin: string): number | null {
  const a = Date.parse(`${inicio}T00:00:00Z`)
  const b = Date.parse(`${fin}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b <= a) return null
  return Math.round((b - a) / 86_400_000)
}

// "noventa (90) días" (el PDF agrega "calendario"): por duración, o los días
// entre las fechas de la solicitud.
function plazoPorDefecto(d: SolicitudContratoDetalle): string {
  if (d.plazoTipo === "duracion" && d.duracionCantidad) {
    return d.duracionUnidad === "dias" ? conUnidad(d.duracionCantidad, "día", "días") : conUnidad(d.duracionCantidad, "mes", "meses")
  }
  if (d.fechaInicio && d.fechaFin) {
    const dias = diasEntre(d.fechaInicio, d.fechaFin)
    if (dias) return conUnidad(dias, "día", "días")
  }
  return ""
}

const numeroPorcentaje = (p: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(p)

export function minutaObraPorDefecto(d: SolicitudContratoDetalle, extra: DatosExtraMinuta, hoy: string): MinutaObra {
  const variante: VarianteMinutaObra = d.tipo === "mano_obra" ? "mano_obra" : "obra"
  const manoObra = variante === "mano_obra"
  const juridica = d.contratistaTipoPersona === "juridica"
  const nit =
    extra.contratistaTipoDocumento === "NIT" && extra.contratistaNumeroDocumento
      ? `${extra.contratistaNumeroDocumento}${extra.contratistaDv !== null ? `-${extra.contratistaDv}` : ""}`
      : ""
  const tipoDocumento = juridica ? extra.contratistaRepresentanteTipoDocumento : extra.contratistaTipoDocumento
  const ciudadProyecto = extra.proyectoCiudad ?? ""
  const pct = d.tieneAnticipo && d.anticipoPorcentaje ? d.anticipoPorcentaje : null
  const monto = pct !== null ? Math.round(((d.valor * pct) / 100) * 100) / 100 : null

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
    v: VERSION_MINUTA_OBRA,
    variante,
    // Mano de obra: "se firma en <ciudad>"; obra: "en el Departamento de …".
    departamentoFirma: manoObra ? ciudadProyecto : (d.domicilioDepartamento ?? ""),
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
    obra: d.proyectoNombre ?? "",
    items,
    plazo: plazoPorDefecto(d),
    valor: numeroTexto(d.valor),
    valorLetras: valorEnLetras(d.valor),
    anticipoPorcentaje: pct !== null ? numeroPorcentaje(pct) : "",
    anticipo: monto !== null ? numeroTexto(monto) : "",
    anticipoLetras: monto !== null ? valorEnLetras(monto) : "",
    amortizacion: pct !== null ? `${numeroPorcentaje(pct)}%` : "",
    periodicidadPago: d.datosTipo.pagoCadaDias ? conUnidad(d.datosTipo.pagoCadaDias, "día", "días") : "",
    retencion: d.datosTipo.retencionGarantia === undefined ? "" : d.datosTipo.retencionGarantia ? "si" : "no",
    retencionGarantia: d.datosTipo.retencionGarantia && d.datosTipo.retencionPorcentaje ? `${numeroPorcentaje(d.datosTipo.retencionPorcentaje)}%` : "",
    condicionesPago: d.formaPago.trim(),
    obligacionesContratante: [...(manoObra ? OBLIGACIONES_CONTRATANTE_MANO_OBRA : OBLIGACIONES_CONTRATANTE_OBRA)],
    obligacionesGenerales: [...(manoObra ? OBLIGACIONES_GENERALES_MANO_OBRA : OBLIGACIONES_GENERALES_OBRA)],
    obligacionesEspecificas: [
      ...(manoObra ? OBLIGACIONES_ESPECIFICAS_MANO_OBRA : OBLIGACIONES_ESPECIFICAS_OBRA),
      ...d.obligaciones.filter((o) => !esNoAplica(o)),
      ...d.entregables.filter((e) => !esNoAplica(e)).map((e) => `Entregar: ${sinPuntoFinal(e)}.`),
    ],
    // Obra: siempre hay garantías. Mano de obra: lo dice la solicitud.
    exigeGarantia: manoObra && d.datosTipo.exigeGarantia === false ? "no" : "si",
    amparos: pct !== null ? [{ ...AMPARO_ANTICIPO_OBRA }, ...AMPAROS_OBRA.map((a) => ({ ...a }))] : AMPAROS_OBRA.map((a) => ({ ...a })),
    domicilioDepartamento: d.domicilioDepartamento ?? DOMICILIO_PLANTILLA_OBRA,
    // Mano de obra: "en el Departamento de …"; obra: "en el municipio de …".
    municipioEjecucion: manoObra ? (d.domicilioDepartamento ?? "") : ciudadProyecto,
    clausulasAdicionales: [],
  }
}

export function minutaObraVacia(): MinutaObra {
  return {
    v: VERSION_MINUTA_OBRA,
    variante: "obra",
    departamentoFirma: "",
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
    obra: "",
    items: [],
    plazo: "",
    valor: "",
    valorLetras: "",
    anticipoPorcentaje: "",
    anticipo: "",
    anticipoLetras: "",
    amortizacion: "",
    periodicidadPago: "",
    retencion: "",
    retencionGarantia: "",
    condicionesPago: "",
    obligacionesContratante: [],
    obligacionesGenerales: [],
    obligacionesEspecificas: [],
    exigeGarantia: "si",
    amparos: [],
    domicilioDepartamento: "",
    municipioEjecucion: "",
    clausulasAdicionales: [],
  }
}

const objetos = (valor: unknown) =>
  Array.isArray(valor) ? valor.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object") : null

// Lo guardado gana sobre lo calculado, campo por campo; solo campos conocidos
// y del mismo tipo.
export function mezclarMinutaObra(defecto: MinutaObra, guardada: unknown): MinutaObra {
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return defecto
  const g = guardada as Record<string, unknown>
  const r: Record<string, unknown> = { ...defecto }
  for (const clave of Object.keys(defecto) as (keyof MinutaObra)[]) {
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
    } else if (clave === "retencion") {
      if (valor === "" || valor === "si" || valor === "no") r[clave] = valor
    } else if (clave === "exigeGarantia") {
      if (valor === "si" || valor === "no") r[clave] = valor
    } else if (clave === "variante") {
      if (valor === "obra" || valor === "mano_obra") r[clave] = valor
    } else if (typeof valor === "string") {
      r[clave] = valor
    }
  }
  return r as MinutaObra
}

export function limpiarMinutaObra(m: MinutaObra): MinutaObra {
  const lista = (l: string[]) => l.map((t) => t.trim()).filter(Boolean)
  return {
    ...m,
    v: VERSION_MINUTA_OBRA,
    obligacionesContratante: lista(m.obligacionesContratante),
    obligacionesGenerales: lista(m.obligacionesGenerales),
    obligacionesEspecificas: lista(m.obligacionesEspecificas),
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

export const nombreArchivoMinutaObra = (numero: number, contratista: string, variante: VarianteMinutaObra = "obra") =>
  `minuta-${variante === "mano_obra" ? "mano-obra" : "obra"}-${numero}-${contratista
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40)}.pdf`

// ---------------------------------------------------------------- origen de cada dato
const CAMPOS_DE_PLANTILLA = new Set<keyof MinutaObra>(["contratanteCorreo", "domicilioDepartamento"])

export function origenCampoObra(clave: keyof MinutaObra, actual: string, defecto: MinutaObra): OrigenDato {
  if (!actual.trim()) return "vacio"
  const inicial = defecto[clave]
  if (typeof inicial !== "string" || actual !== inicial) return "editado"
  if (CAMPOS_DE_PLANTILLA.has(clave)) return "plantilla"
  if (clave === "contratanteNombre") return actual === CONTRATANTE_POR_DEFECTO.nombre ? "plantilla" : "solicitud"
  if (clave === "contratanteNit") return actual === CONTRATANTE_POR_DEFECTO.nit ? "plantilla" : "solicitud"
  return "solicitud"
}

// ---------------------------------------------------------------- mano de obra: plantilla vieja o nueva
// Datos de minuta de mano de obra hechos con la plantilla nueva (versión 04).
// Los de la plantilla vieja (lib/minuta-mano-obra.ts) no traen `variante`.
export const esMinutaManoObra04 = (datos: unknown): boolean =>
  Boolean(datos) && typeof datos === "object" && (datos as Record<string, unknown>).variante === "mano_obra"

// Qué plantilla usa un contrato de mano de obra: la vieja solo si su minuta ya
// se envió a Subgerencia o se aprobó con ella (no se le cambia el texto a un
// contrato aprobado); todo lo demás va con la nueva.
export function usaPlantillaManoObra04(minutaEstado: string | null | undefined, datosGuardados: unknown): boolean {
  if (esMinutaManoObra04(datosGuardados)) return true
  return !(minutaEstado === "en_revision" || minutaEstado === "aprobada")
}
