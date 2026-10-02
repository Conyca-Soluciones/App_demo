// ---------------------------------------------------------------------------
// Minuta del contrato de mano de obra (formato GJ-F-003 de Jurídica).
//
// Todo lo que la plantilla deja en "XXX" es un campo de MinutaManoObra: se
// llena con los datos de la solicitud (minutaPorDefecto), Jurídica lo edita en
// Pre-aprobación y se guarda en contratos.minuta_datos. El PDF
// (components/minuta-mano-obra-pdf.tsx) arma el texto fijo de la plantilla con
// estos campos. Sin dependencias de servidor: lo usan el editor y la ruta del
// PDF.
// ---------------------------------------------------------------------------

import { numeroALetrasCOP } from "@/lib/numero-a-letras"
import { leerNumero, type SolicitudContratoDetalle } from "@/lib/contratos"

export const VERSION_MINUTA = 1

export type ItemAnexoMinuta = { actividad: string; unidad: string; cantidad: string; valorUnitario: string }

export type MinutaManoObra = {
  v: number
  // Firma (encabezado y cierre)
  ciudadFirma: string
  fechaFirma: string // AAAA-MM-DD
  // Contratante
  contratanteNombre: string
  contratanteNit: string
  contratanteRepresentante: string
  contratanteRepresentanteCedula: string
  contratanteRepresentanteExpedida: string
  contratanteCorreo: string
  // Contratista
  contratistaTipoPersona: "natural" | "juridica"
  contratistaNombre: string // persona natural o razón social
  contratistaNit: string // NIT de la empresa (jurídica)
  contratistaRepresentante: string // quien firma (jurídica: representante legal)
  contratistaCedula: string
  contratistaCedulaExpedida: string
  contratistaCiudad: string // domicilio
  contratistaCorreo: string
  // Primera: objeto
  objeto: string
  obra: string
  // Segunda: obligaciones
  obligacionesContratante: string[]
  obligacionesContratista: string[]
  plazoSolicitudCorreccion: string
  plazoAjustes: string
  plazoSilencio: string
  // Tercera: duración ("dentro de un plazo ...": "de tres (3) meses contados...")
  plazo: string
  // Cuarta: precio y forma de pago
  valor: string
  valorLetras: string
  formaPago: string
  requisitosPago: string[]
  // Quinta: lugar de ejecución
  municipioEjecucion: string
  // Octava / décima primera / décima sexta
  clausulaPenalPorcentaje: string
  polizaPorcentaje: string
  // Décima segunda: domicilio
  domicilioMunicipio: string
  domicilioDepartamento: string
  // Décima tercera: documentos del contrato
  anexos: string
  // Décima quinta: arbitramento
  ciudadArbitramento: string
  // Anexo N° 1
  items: ItemAnexoMinuta[]
}

// Datos que no están en la solicitud pero ayudan a prellenar la minuta.
export type DatosExtraMinuta = {
  proyectoCiudad: string | null
  empresaNombre: string | null
  empresaNit: string | null
  contratistaTipoDocumento: string | null
  contratistaNumeroDocumento: string | null
  contratistaDv: number | null
  contratistaRepresentante: string | null
  contratistaRepresentanteDocumento: string | null
  contratistaCiudad: string | null
}

export const CONTRATANTE_POR_DEFECTO = { nombre: "CONYCA SOLUCIONES S.A.S", nit: "900.701.968-7", correo: "gerencia@conycasoluciones.com" }

export const OBLIGACIONES_CONTRATANTE = [
  "Proporcionar a EL CONTRATISTA toda la información básica para la ejecución del trabajo, que será disponible, fiable, correcta, actualizada y completa.",
  "Pagar cumplidamente el valor del contrato como contraprestación a la elaboración de la obra encargada.",
  "Entregar en tiempo la información necesaria para la realización de la obra.",
]

// Sin la de corrección de actividades: esa tiene sus plazos en campos propios
// y el PDF la pone siempre en el 5.º lugar (como en la plantilla).
export const OBLIGACIONES_CONTRATISTA = [
  "Cumplir con lo pactado en este negocio jurídico conforme a las especificaciones técnicas previstas en anexo N°1 del presente contrato.",
  "Realizar su mejor esfuerzo en la ejecución, terminación y entrega de la obra contratada de modo diligente y competente, dentro de los plazos acordados.",
  "Obrar con lealtad y buena fe.",
  "Reportar al contratante cualquier novedad o anomalía que impida la normal ejecución del contrato.",
  "En el caso de subcontratación puntual de alguna actividad por parte de EL CONTRATISTA a un tercero, EL CONTRATISTA garantizará y será responsable del resultado final del trabajo de dichos terceros y de la observancia de los derechos de autor involucrados.",
  "Mantener indemne al contratante, por todo daño que puedan realizar los dependientes del contratista.",
]
// Posición (0-based) de la obligación de corrección dentro de la lista del contratista.
export const POSICION_OBLIGACION_CORRECCION = 4

export const REQUISITOS_PAGO = [
  "Factura por el valor del total del contrato y que contenga la relación de los ítems de actividades ejecutadas y entregadas al CONTRATANTE.",
  "Acta de recibido a satisfacción de los ítems entregados al CONTRATANTE.",
]

export const obligacionCorreccion = (m: Pick<MinutaManoObra, "plazoSolicitudCorreccion" | "plazoAjustes" | "plazoSilencio">) =>
  `Corregir las actividades cuando ésta incumpla el encargo, siempre y cuando EL CONTRATANTE, solicite a EL CONTRATISTA por escrito dicha corrección, en un plazo de ${blanco(m.plazoSolicitudCorreccion)} a partir de la entrega de la obra, estableciéndose un plazo máximo de ajustes, arreglos o correcciones de otros ${blanco(m.plazoAjustes)}, dependiendo de la gravedad o complejidad de la enmienda o corrección. Si transcurridos ${blanco(m.plazoSilencio)} desde la posterior entrega corregida, sin que hubiera habido comunicación de EL CONTRATANTE, se entenderá dicho silencio como aceptación de la obra con los arreglos o correcciones.`

// Un campo vacío sale como raya para llenar a mano.
export const blanco = (t: string | null | undefined) => (t && t.trim() ? t.trim() : "__________")

// ---------------------------------------------------------------- números y fechas en letras
const UNIDADES = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte",
  "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
]
const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]

// 0..99 en letras ("treinta y uno"). Para días, meses de plazo y porcentajes.
export function enteroEnLetras(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n)
  if (n < 30) return UNIDADES[n]
  const d = Math.floor(n / 10)
  const u = n % 10
  return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${UNIDADES[u]}`
}

// "tres (3)"
export const cantidadEnLetras = (n: number) => `${enteroEnLetras(n)} (${n})`

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

export function partesFecha(iso: string): { dia: number; mes: string; anio: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso?.trim() ?? "")
  if (!m) return null
  const mes = MESES[Number(m[2]) - 1]
  return mes ? { dia: Number(m[3]), mes, anio: Number(m[1]) } : null
}

// "5 de octubre de 2026"
export function fechaLarga(iso: string | null | undefined): string {
  const p = partesFecha(iso ?? "")
  return p ? `${p.dia} de ${p.mes} de ${p.anio}` : blanco(null)
}

// Valor en letras como lo pide la plantilla: "XXX ($XXX) M/CTE" -- el M/CTE
// ya lo pone el texto fijo.
export const valorEnLetras = (valor: number) => numeroALetrasCOP(valor).replace(/\s*M\/CTE$/, "")

const formatoPesos = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2, minimumFractionDigits: 0 })
export const pesosSinSimbolo = (n: number) => formatoPesos.format(n)

export function totalItemsMinuta(items: ItemAnexoMinuta[]): number {
  let total = 0
  for (const it of items) {
    const c = leerNumero(it.cantidad)
    const v = leerNumero(it.valorUnitario)
    if (c !== null && v !== null) total += Math.round(c * v * 100) / 100
  }
  return Math.round(total * 100) / 100
}

// ---------------------------------------------------------------- valores por defecto
const primeraMinuscula = (t: string) => (t ? t.charAt(0).toLocaleLowerCase("es-CO") + t.slice(1) : t)
const numeroTexto = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 }).format(n)

function plazoPorDefecto(d: SolicitudContratoDetalle): string {
  if (d.plazoTipo === "duracion" && d.duracionCantidad) {
    const n = d.duracionCantidad
    const unidad = d.duracionUnidad === "dias" ? (n === 1 ? "día" : "días") : n === 1 ? "mes" : "meses"
    return `de ${cantidadEnLetras(n)} ${unidad} contados a partir de la firma de este`
  }
  if (d.fechaInicio && d.fechaFin) return `comprendido entre el ${fechaLarga(d.fechaInicio)} y el ${fechaLarga(d.fechaFin)}`
  return ""
}

export function minutaPorDefecto(d: SolicitudContratoDetalle, extra: DatosExtraMinuta, hoy: string): MinutaManoObra {
  const juridica = d.contratistaTipoPersona === "juridica"
  const nit =
    extra.contratistaTipoDocumento === "NIT" && extra.contratistaNumeroDocumento
      ? `${extra.contratistaNumeroDocumento}${extra.contratistaDv !== null ? `-${extra.contratistaDv}` : ""}`
      : ""
  const ciudadProyecto = extra.proyectoCiudad ?? ""

  const formaPago = [
    d.formaPago.trim(),
    d.tieneAnticipo && d.anticipoPorcentaje
      ? `Se entregará un anticipo del ${numeroTexto(d.anticipoPorcentaje)} % del valor del contrato.`
      : "",
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
      : [{ actividad: d.objeto, unidad: "GL", cantidad: "1", valorUnitario: numeroTexto(d.valor) }]

  return {
    v: VERSION_MINUTA,
    ciudadFirma: ciudadProyecto,
    fechaFirma: hoy,
    contratanteNombre: extra.empresaNombre ?? CONTRATANTE_POR_DEFECTO.nombre,
    contratanteNit: extra.empresaNit ?? CONTRATANTE_POR_DEFECTO.nit,
    contratanteRepresentante: "",
    contratanteRepresentanteCedula: "",
    contratanteRepresentanteExpedida: "",
    contratanteCorreo: CONTRATANTE_POR_DEFECTO.correo,
    contratistaTipoPersona: juridica ? "juridica" : "natural",
    contratistaNombre: d.contratistaNombre,
    contratistaNit: nit,
    contratistaRepresentante: juridica ? (extra.contratistaRepresentante ?? "") : d.contratistaNombre,
    contratistaCedula: juridica ? (extra.contratistaRepresentanteDocumento ?? "") : (extra.contratistaNumeroDocumento ?? ""),
    contratistaCedulaExpedida: "",
    contratistaCiudad: extra.contratistaCiudad ?? "",
    contratistaCorreo: d.correoNotificacion,
    objeto: `${primeraMinuscula(d.objeto.trim().replace(/\.$/, ""))}, conforme a las actividades descritas en el anexo N° 1 del presente contrato`,
    obra: d.proyectoNombre ?? "",
    obligacionesContratante: [...OBLIGACIONES_CONTRATANTE],
    obligacionesContratista: [...OBLIGACIONES_CONTRATISTA, ...d.obligaciones],
    plazoSolicitudCorreccion: "",
    plazoAjustes: "",
    plazoSilencio: "siete (7) días hábiles",
    plazo: plazoPorDefecto(d),
    valor: numeroTexto(d.valor),
    valorLetras: valorEnLetras(d.valor),
    formaPago,
    requisitosPago: [...REQUISITOS_PAGO],
    municipioEjecucion: ciudadProyecto,
    clausulaPenalPorcentaje: "10",
    polizaPorcentaje: "20",
    domicilioMunicipio: ciudadProyecto,
    domicilioDepartamento: "",
    anexos: "N° 1 (actividades, cantidades y valores)",
    ciudadArbitramento: ciudadProyecto,
    items,
  }
}

// Todos los campos vacíos: base para validar una minuta que llega de afuera
// (mezclarMinuta(minutaVacia(), datos)).
export function minutaVacia(): MinutaManoObra {
  return {
    v: VERSION_MINUTA,
    ciudadFirma: "",
    fechaFirma: "",
    contratanteNombre: "",
    contratanteNit: "",
    contratanteRepresentante: "",
    contratanteRepresentanteCedula: "",
    contratanteRepresentanteExpedida: "",
    contratanteCorreo: "",
    contratistaTipoPersona: "natural",
    contratistaNombre: "",
    contratistaNit: "",
    contratistaRepresentante: "",
    contratistaCedula: "",
    contratistaCedulaExpedida: "",
    contratistaCiudad: "",
    contratistaCorreo: "",
    objeto: "",
    obra: "",
    obligacionesContratante: [],
    obligacionesContratista: [],
    plazoSolicitudCorreccion: "",
    plazoAjustes: "",
    plazoSilencio: "",
    plazo: "",
    valor: "",
    valorLetras: "",
    formaPago: "",
    requisitosPago: [],
    municipioEjecucion: "",
    clausulaPenalPorcentaje: "",
    polizaPorcentaje: "",
    domicilioMunicipio: "",
    domicilioDepartamento: "",
    anexos: "",
    ciudadArbitramento: "",
    items: [],
  }
}

// Lo guardado gana sobre lo calculado, campo por campo (si la plantilla gana
// un campo nuevo, las minutas viejas lo toman del valor por defecto). Solo se
// aceptan campos conocidos y del mismo tipo.
export function mezclarMinuta(defecto: MinutaManoObra, guardada: unknown): MinutaManoObra {
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return defecto
  const g = guardada as Record<string, unknown>
  const r: Record<string, unknown> = { ...defecto }
  for (const clave of Object.keys(defecto) as (keyof MinutaManoObra)[]) {
    if (clave === "v" || !(clave in g)) continue
    const base = defecto[clave]
    const valor = g[clave]
    if (clave === "items") {
      if (Array.isArray(valor)) {
        r.items = valor
          .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
          .map((x) => ({
            actividad: String(x.actividad ?? ""),
            unidad: String(x.unidad ?? ""),
            cantidad: String(x.cantidad ?? ""),
            valorUnitario: String(x.valorUnitario ?? ""),
          }))
      }
    } else if (Array.isArray(base)) {
      if (Array.isArray(valor)) r[clave] = valor.map((x) => String(x ?? ""))
    } else if (clave === "contratistaTipoPersona") {
      if (valor === "natural" || valor === "juridica") r[clave] = valor
    } else if (typeof valor === "string") {
      r[clave] = valor
    }
  }
  return r as MinutaManoObra
}

// Limpia la minuta antes de guardarla o pintarla: quita líneas vacías de las
// listas y espacios sobrantes.
export function limpiarMinuta(m: MinutaManoObra): MinutaManoObra {
  const lista = (l: string[]) => l.map((t) => t.trim()).filter(Boolean)
  return {
    ...m,
    v: VERSION_MINUTA,
    obligacionesContratante: lista(m.obligacionesContratante),
    obligacionesContratista: lista(m.obligacionesContratista),
    requisitosPago: lista(m.requisitosPago),
    items: m.items
      .map((it) => ({
        actividad: it.actividad.trim(),
        unidad: it.unidad.trim(),
        cantidad: it.cantidad.trim(),
        valorUnitario: it.valorUnitario.trim(),
      }))
      .filter((it) => it.actividad || it.cantidad || it.valorUnitario),
  }
}

export const nombreArchivoMinuta = (numero: number, contratista: string) =>
  `minuta-contrato-${numero}-${contratista
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 40)}.pdf`
