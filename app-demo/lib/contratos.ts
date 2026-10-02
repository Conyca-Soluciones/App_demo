// ---------------------------------------------------------------------------
// Contratos: tipos, documentos específicos por tipo y validación de la
// solicitud. Sin dependencias de servidor (lo usan el formulario y la Server
// Action). La base repite las reglas en sus CHECK, en
// documentos_tipo_contrato y en crear_solicitud_contrato
// (20261012000000_solicitud_contratos.sql): si cambia el catálogo, cambiar
// los dos lados.
// ---------------------------------------------------------------------------

import type { TipoDocumentoContratista, TipoPersona } from "@/lib/contratistas"
import { numeroALetrasCOP, numeroATexto } from "@/lib/numero-a-letras"

export type TipoContrato =
  | "mano_obra"
  | "obra"
  | "arrendamiento"
  | "alquiler_vehiculo"
  | "prestacion_servicios"
  | "suministro_instalacion"

export type TipoDocumentoContrato =
  | "planilla_seguridad_social"
  | "certificado_alturas"
  | "certificado_competencia_laboral"
  | "cronograma_actividades"
  | "cotizacion_aprobada"
  | "polizas"
  | "relacion_personal"
  | "certificado_tradicion_libertad"
  | "autorizacion_propietario"
  | "tarjeta_propiedad"
  | "revision_tecnicomecanica"
  | "soat"
  | "licencia_conduccion"
  | "tarjeta_profesional"
  | "certificado_eps"
  | "cotizacion"

export type DocumentoContratoRequerido = { tipo: TipoDocumentoContrato; titulo: string; obligatorio: boolean }

// Tabla de Jurídica: "Documentos específicos según el tipo de contrato".
// obligatorio = false para los que dicen "si aplica".
export const TIPOS_CONTRATO: { valor: TipoContrato; titulo: string; documentos: DocumentoContratoRequerido[] }[] = [
  {
    valor: "mano_obra",
    titulo: "Mano de obra",
    documentos: [
      { tipo: "planilla_seguridad_social", titulo: "Planilla de seguridad social", obligatorio: true },
      { tipo: "certificado_alturas", titulo: "Certificado de trabajo en alturas (si aplica)", obligatorio: false },
      { tipo: "certificado_competencia_laboral", titulo: "Certificado de capacitación o competencia laboral (si aplica)", obligatorio: false },
    ],
  },
  {
    valor: "obra",
    titulo: "Obra",
    documentos: [
      { tipo: "cronograma_actividades", titulo: "Cronograma de actividades", obligatorio: true },
      { tipo: "cotizacion_aprobada", titulo: "Cotización aprobada", obligatorio: true },
      { tipo: "polizas", titulo: "Pólizas (cuando sean exigidas)", obligatorio: false },
      { tipo: "relacion_personal", titulo: "Relación del personal que ejecutará la obra (si aplica)", obligatorio: false },
    ],
  },
  {
    valor: "arrendamiento",
    titulo: "Arrendamiento",
    documentos: [
      { tipo: "certificado_tradicion_libertad", titulo: "Certificado de tradición y libertad", obligatorio: true },
      { tipo: "autorizacion_propietario", titulo: "Autorización o poder del propietario (si no es el propietario)", obligatorio: false },
    ],
  },
  {
    valor: "alquiler_vehiculo",
    titulo: "Alquiler de vehículo",
    documentos: [
      { tipo: "tarjeta_propiedad", titulo: "Tarjeta de propiedad", obligatorio: true },
      { tipo: "revision_tecnicomecanica", titulo: "Revisión técnico-mecánica vigente", obligatorio: true },
      { tipo: "soat", titulo: "SOAT vigente", obligatorio: true },
      { tipo: "licencia_conduccion", titulo: "Licencia de conducción del conductor", obligatorio: true },
    ],
  },
  {
    valor: "prestacion_servicios",
    titulo: "Prestación de servicios",
    documentos: [
      { tipo: "tarjeta_profesional", titulo: "Tarjeta profesional (si aplica)", obligatorio: false },
      { tipo: "certificado_eps", titulo: "Certificación de afiliación a EPS", obligatorio: true },
      { tipo: "cotizacion", titulo: "Cotización", obligatorio: true },
    ],
  },
  {
    valor: "suministro_instalacion",
    titulo: "Suministro e instalación",
    documentos: [
      { tipo: "planilla_seguridad_social", titulo: "Planilla de seguridad social", obligatorio: true },
      { tipo: "certificado_alturas", titulo: "Certificado de trabajo en alturas (si aplica)", obligatorio: false },
      { tipo: "tarjeta_profesional", titulo: "Tarjeta profesional", obligatorio: true },
    ],
  },
]

export const TIPO_CONTRATO_POR_VALOR = new Map(TIPOS_CONTRATO.map((t) => [t.valor, t]))

// Tipos que, además del valor del contrato, llevan un valor de pago mensual
// obligatorio (la base repite la regla en _guardar_solicitud_contrato,
// 20261016000000_solicitud_valor_mensual.sql).
export const TIPOS_CON_PAGO_MENSUAL: TipoContrato[] = ["prestacion_servicios", "alquiler_vehiculo", "arrendamiento"]
export const pideValorMensual = (tipo: TipoContrato | "" | null | undefined) => Boolean(tipo && TIPOS_CON_PAGO_MENSUAL.includes(tipo))

// Solicitud tal como la leen las pantallas (la arma lib/contratos-db.ts en el
// servidor). Aquí y no allá: los componentes de cliente no deben importar
// nada de un archivo que toca el servidor (ver CLAUDE.md, boundary).
export type SolicitudContratoFila = {
  id: string
  numero: number
  proyectoId: string
  proyectoCodigo: string | null
  proyectoNombre: string | null
  tipo: TipoContrato
  estado: EstadoContrato
  contratistaNombre: string
  contratistaDocumento: string
  objeto: string
  valor: number
  plazoTipo: "fechas" | "duracion"
  fechaInicio: string | null
  fechaFin: string | null
  duracionCantidad: number | null
  duracionUnidad: "dias" | "meses" | null
  solicitadoPorNombre: string | null
  createdAt: string
  enviadoAt: string
  motivoResolucion: string | null
  resueltoPorNombre: string | null
  resueltoAt: string | null
}

export type SolicitudContratoDetalle = SolicitudContratoFila & {
  contratistaId: string
  contratistaCorreo: string
  contratistaTipoPersona: TipoPersona
  contratistaDocumentos: { id: string; tipo: TipoDocumentoContratista; nombreArchivo: string; mime: string }[]
  anexoTipo: "valor_global" | "valores_unitarios"
  valorMensual: number | null
  tieneAnticipo: boolean
  anticipoPorcentaje: number | null
  formaPago: string
  correoNotificacion: string
  observaciones: string | null
  obligaciones: string[]
  entregables: string[]
  items: {
    presupuestoItemId: string
    codigo: string | null
    actividad: string
    unidad: string
    cantidad: number
    valorUnitario: number
  }[]
  documentos: { id: string; tipo: TipoDocumentoContrato; nombreArchivo: string; mime: string; ruta: string; tamano: number }[]
}


export type EstadoContrato = "pre_aprobacion" | "devuelta" | "rechazada" | "aprobada"
export const ETIQUETA_ESTADO_CONTRATO: Record<EstadoContrato, string> = {
  pre_aprobacion: "En pre-aprobación",
  devuelta: "Devuelta",
  rechazada: "Rechazada",
  aprobada: "Pre-aprobada",
}
// Ámbar = esperando a alguien; rojo = devuelta/rechazada; verde = aprobada.
export const CLASE_ESTADO_CONTRATO: Record<EstadoContrato, string> = {
  pre_aprobacion: "border-transparent bg-amber-100 text-amber-800",
  devuelta: "border-transparent bg-orange-100 text-orange-800",
  rechazada: "border-transparent bg-red-100 text-red-800",
  aprobada: "border-transparent bg-emerald-100 text-emerald-800",
}

// ---------------------------------------------------------------- números
// Formato colombiano: punto de miles y coma decimal ("1.500.000,50"). Un punto
// seguido de grupos de exactamente 3 dígitos es de miles; si no, es decimal
// ("2.5" = 2,5). Devuelve null si no es un número.
export function leerNumero(texto: string): number | null {
  const t = texto.trim().replace(/\s|\$/g, "")
  if (t === "") return null
  let normal: string
  if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".")
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "")
  else normal = t
  if (!/^\d+(\.\d+)?$/.test(normal)) return null
  const n = Number(normal)
  return Number.isFinite(n) ? n : null
}

const formatoPesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 })
export const pesos = (n: number) => formatoPesos.format(n)
const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 })
export const numero = (n: number) => formatoNumero.format(n)

// Redondeo a centavos igual que la base (round(x, 2)).
export const aCentavos = (n: number) => Math.round(n * 100) / 100

// ---------------------------------------------------------------- formulario
// Anexo de valores unitarios: cada línea es un ítem del presupuesto vigente
// del proyecto (la descripción y la unidad salen de ahí).
export type ItemAnexoForm = { presupuestoItemId: string; cantidad: string; valorUnitario: string }

// Ítem del presupuesto vigente que se puede contratar (items_presupuesto_para_contrato).
export type ItemPresupuestoContrato = {
  id: string
  codigo: string
  descripcion: string
  unidad: string | null
  cantidad: number // presupuestada
  valorUnitario: number // del presupuesto: tope del valor unitario contratado
  contratado: number // ya en otros contratos
  disponible: number // tope de la cantidad
}

export type SolicitudContratoForm = {
  tipo: TipoContrato | ""
  contratistaId: string
  objeto: string
  anexoTipo: "valor_global" | "valores_unitarios"
  valor: string
  valorMensual: string
  items: ItemAnexoForm[]
  tieneAnticipo: boolean
  anticipoPorcentaje: string
  formaPago: string
  plazoTipo: "fechas" | "duracion"
  fechaInicio: string
  fechaFin: string
  duracionCantidad: string
  duracionUnidad: "dias" | "meses"
  obligaciones: string[]
  entregables: string[]
  correoNotificacion: string
  observaciones: string
}

export type CampoSolicitud =
  | "tipo"
  | "contratistaId"
  | "objeto"
  | "valor"
  | "valorMensual"
  | "items"
  | "anticipoPorcentaje"
  | "formaPago"
  | "plazo"
  | "correoNotificacion"
  | "obligaciones"
  | "entregables"

// Lo que se manda a crear_solicitud_contrato, ya limpio.
export type SolicitudContratoValida = {
  tipo: TipoContrato
  contratistaId: string
  objeto: string
  anexoTipo: "valor_global" | "valores_unitarios"
  valor: number
  valorMensual: number | null
  items: { presupuestoItemId: string; cantidad: number; valorUnitario: number }[]
  tieneAnticipo: boolean
  anticipoPorcentaje: number | null
  formaPago: string
  plazoTipo: "fechas" | "duracion"
  fechaInicio: string | null
  fechaFin: string | null
  duracionCantidad: number | null
  duracionUnidad: "dias" | "meses" | null
  obligaciones: string[]
  entregables: string[]
  correoNotificacion: string
  observaciones: string | null
}

// El objeto empieza por un verbo en infinitivo ("Desarrollar", "Ejecutar"...).
export const empiezaConVerbo = (texto: string) => /^\s*[a-záéíóúñü]+(ar|er|ir)(?![a-záéíóúñü])/i.test(texto)

export function totalAnexo(items: ItemAnexoForm[]): number {
  let total = 0
  for (const it of items) {
    const c = leerNumero(it.cantidad)
    const v = leerNumero(it.valorUnitario)
    if (c !== null && v !== null) total += aCentavos(c * v)
  }
  return aCentavos(total)
}

export type ResultadoSolicitud =
  | { ok: true; datos: SolicitudContratoValida }
  | { ok: false; errores: Partial<Record<CampoSolicitud, string>> }

// `catalogo` (ítems del presupuesto) permite revisar los topes en el
// formulario; la base los vuelve a revisar al crear (crear_solicitud_contrato).
export function validarSolicitud(
  f: SolicitudContratoForm,
  catalogo?: Map<string, ItemPresupuestoContrato>
): ResultadoSolicitud {
  const errores: Partial<Record<CampoSolicitud, string>> = {}

  if (!f.tipo || !TIPO_CONTRATO_POR_VALOR.has(f.tipo)) errores.tipo = "Elige el tipo de contrato."
  if (!f.contratistaId) errores.contratistaId = "Elige el contratista."

  const objeto = f.objeto.trim().replace(/\s+/g, " ")
  if (objeto.length < 10) errores.objeto = "Describe el objeto del contrato."
  else if (!empiezaConVerbo(objeto)) {
    errores.objeto = 'Empieza con un verbo en infinitivo, por ejemplo "Desarrollar", "Ejecutar" o "Suministrar".'
  }

  // Valor: en valores unitarios es la suma del anexo.
  const items: SolicitudContratoValida["items"] = []
  let valor: number | null
  if (f.anexoTipo === "valores_unitarios") {
    const llenos = f.items.filter((it) => it.presupuestoItemId || it.cantidad.trim() || it.valorUnitario.trim())
    if (llenos.length === 0) errores.items = "Agrega al menos una actividad del presupuesto."
    const vistos = new Set<string>()
    for (let i = 0; i < llenos.length; i++) {
      const it = llenos[i]
      const cantidad = leerNumero(it.cantidad)
      const valorUnitario = leerNumero(it.valorUnitario)
      if (!it.presupuestoItemId) {
        errores.items = `Elige el ítem del presupuesto de la actividad ${i + 1}.`
        break
      }
      if (vistos.has(it.presupuestoItemId)) {
        errores.items = `La actividad ${i + 1} repite un ítem del presupuesto.`
        break
      }
      vistos.add(it.presupuestoItemId)
      if (!cantidad || !valorUnitario) {
        errores.items = `Completa la actividad ${i + 1}: cantidad y valor unitario mayores que cero.`
        break
      }
      const ref = catalogo?.get(it.presupuestoItemId)
      if (ref) {
        if (cantidad > ref.disponible) {
          errores.items = `Ítem ${ref.codigo}: la cantidad (${numero(cantidad)}) supera lo disponible en el presupuesto (${numero(ref.disponible)}).`
          break
        }
        if (valorUnitario > ref.valorUnitario) {
          errores.items = `Ítem ${ref.codigo}: el valor unitario (${pesos(valorUnitario)}) supera el del presupuesto (${pesos(ref.valorUnitario)}).`
          break
        }
      }
      items.push({ presupuestoItemId: it.presupuestoItemId, cantidad, valorUnitario: aCentavos(valorUnitario) })
    }
    valor = aCentavos(items.reduce((acc, it) => acc + aCentavos(it.cantidad * it.valorUnitario), 0))
  } else {
    valor = leerNumero(f.valor)
    if (valor === null || valor <= 0) errores.valor = "Escribe el valor del contrato en pesos."
    else valor = aCentavos(valor)
  }

  let valorMensual: number | null = null
  if (pideValorMensual(f.tipo)) {
    valorMensual = leerNumero(f.valorMensual)
    if (valorMensual === null || valorMensual <= 0) errores.valorMensual = "Escribe el valor del pago mensual en pesos."
    else {
      valorMensual = aCentavos(valorMensual)
      if (valor !== null && valor > 0 && valorMensual > valor) errores.valorMensual = "El pago mensual no puede ser mayor que el valor del contrato."
    }
  }

  let anticipoPorcentaje: number | null = null
  if (f.tieneAnticipo) {
    anticipoPorcentaje = leerNumero(f.anticipoPorcentaje)
    if (anticipoPorcentaje === null || anticipoPorcentaje <= 0 || anticipoPorcentaje > 100) {
      errores.anticipoPorcentaje = "Escribe el porcentaje de anticipo (entre 1 y 100)."
    }
  }
  if (!f.formaPago.trim()) errores.formaPago = "Describe la forma de pago."

  let fechaInicio: string | null = null
  let fechaFin: string | null = null
  let duracionCantidad: number | null = null
  let duracionUnidad: "dias" | "meses" | null = null
  if (f.plazoTipo === "fechas") {
    if (!f.fechaInicio || !f.fechaFin) errores.plazo = "Elige la fecha de inicio y la de fin."
    else if (f.fechaFin < f.fechaInicio) errores.plazo = "La fecha de fin no puede ser anterior a la de inicio."
    fechaInicio = f.fechaInicio || null
    fechaFin = f.fechaFin || null
  } else {
    const n = Number(f.duracionCantidad.trim())
    if (!Number.isInteger(n) || n <= 0) errores.plazo = `Escribe cuántos ${f.duracionUnidad === "dias" ? "días" : "meses"} dura el contrato (número entero).`
    duracionCantidad = n
    duracionUnidad = f.duracionUnidad
    fechaInicio = f.fechaInicio || null // inicio estimado, opcional
  }

  // Obligatorias: si de verdad no hay, se escribe "N/A" o "No aplica".
  const obligaciones = f.obligaciones.map((o) => o.trim()).filter(Boolean)
  const entregables = f.entregables.map((e) => e.trim()).filter(Boolean)
  if (obligaciones.length === 0) errores.obligaciones = "Escribe al menos una obligación específica. Si no hay, escribe «N/A» o «No aplica»."
  if (entregables.length === 0) errores.entregables = "Escribe al menos un entregable. Si no hay, escribe «N/A» o «No aplica»."

  const correo = f.correoNotificacion.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) errores.correoNotificacion = "Escribe un correo de notificación válido."

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    datos: {
      tipo: f.tipo as TipoContrato,
      contratistaId: f.contratistaId,
      objeto,
      anexoTipo: f.anexoTipo,
      valor: valor!,
      valorMensual,
      items,
      tieneAnticipo: f.tieneAnticipo,
      anticipoPorcentaje,
      formaPago: f.formaPago.trim(),
      plazoTipo: f.plazoTipo,
      fechaInicio,
      fechaFin,
      duracionCantidad,
      duracionUnidad,
      obligaciones,
      entregables,
      correoNotificacion: correo,
      observaciones: f.observaciones.trim() || null,
    },
  }
}

export function plazoTexto(c: {
  plazoTipo: "fechas" | "duracion"
  fechaInicio: string | null
  fechaFin: string | null
  duracionCantidad: number | null
  duracionUnidad: "dias" | "meses" | null
}, formatoFecha: (iso: string) => string) {
  if (c.plazoTipo === "fechas") return `${formatoFecha(c.fechaInicio ?? "")} a ${formatoFecha(c.fechaFin ?? "")}`
  const u = c.duracionUnidad === "dias" ? (c.duracionCantidad === 1 ? "día" : "días") : c.duracionCantidad === 1 ? "mes" : "meses"
  return `${c.duracionCantidad} ${u}`
}

// "N/A", "NA", "No aplica" (lo que se escribe cuando de verdad no hay
// obligaciones o entregables): no se copian a la minuta.
export const esNoAplica = (t: string) => /^\s*(n\s*\/?\s*a|no\s+aplica)\s*\.?\s*$/i.test(t)

// ---------------------------------------------------------------- en letras
// "treinta por ciento (30 %)"; con decimales: "doce coma cinco por ciento (12,5 %)".
export function porcentajeEnLetras(p: number): string {
  const entero = Math.trunc(p)
  const decimales = Math.round((p - entero) * 100)
  let texto = numeroATexto(entero)
  if (decimales > 0) {
    const d = decimales % 10 === 0 ? decimales / 10 : decimales
    texto += ` coma ${decimales < 10 ? "cero " : ""}${numeroATexto(d)}`
  }
  return `${texto} por ciento (${numero(p)} %)`
}

// "QUINCE MILLONES PESOS M/CTE ($15.000.000)"
export const pesosEnLetras = (n: number) => `${numeroALetrasCOP(n)} (${pesos(n)})`

// Anticipo en número y en letras: "treinta por ciento (30 %) del valor del
// contrato, es decir QUINCE MILLONES PESOS M/CTE ($15.000.000)".
export const anticipoEnLetras = (porcentaje: number, valor: number) =>
  `${porcentajeEnLetras(porcentaje)} del valor del contrato, es decir ${pesosEnLetras(aCentavos((valor * porcentaje) / 100))}`
