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
// 20261016000001_solicitud_valor_mensual.sql).
export const TIPOS_CON_PAGO_MENSUAL: TipoContrato[] = ["prestacion_servicios", "alquiler_vehiculo", "arrendamiento"]
export const pideValorMensual = (tipo: TipoContrato | "" | null | undefined) => Boolean(tipo && TIPOS_CON_PAGO_MENSUAL.includes(tipo))

// ---------------------------------------------------------------- datos de la minuta por tipo
// Lo que la solicitud pide según el tipo para llenar la minuta
// (contratos.datos_tipo, 20261109000000_datos_minuta_solicitud.sql; la base
// repite las reglas en _guardar_solicitud_contrato).
export type ActasPeriodicidad = "semanales" | "quincenales" | "mensuales" | "bimestrales"
export const OPCIONES_ACTAS: { valor: ActasPeriodicidad; titulo: string }[] = [
  { valor: "semanales", titulo: "Semanales" },
  { valor: "quincenales", titulo: "Quincenales" },
  { valor: "mensuales", titulo: "Mensuales" },
  { valor: "bimestrales", titulo: "Bimestrales" },
]
export type IvaCanonSolicitud = "mas_iva" | "incluido"

export type DatosTipoContrato = {
  // obra y mano de obra
  pagoCadaDias?: number
  retencionGarantia?: boolean
  retencionPorcentaje?: number | null
  // arrendamiento
  inmuebleDireccion?: string
  inmuebleUso?: string
  canonIva?: IvaCanonSolicitud
  serviciosIncluidos?: boolean
  correoFactura?: string
  // alquiler de vehículo
  bienNombre?: string
  actas?: ActasPeriodicidad
  // alquiler de vehículo y mano de obra
  exigeGarantia?: boolean
}

// De la base (snake_case, jsonb) al formato de la app, aceptando solo lo conocido.
export function datosTipoDesdeBase(x: unknown): DatosTipoContrato {
  if (!x || typeof x !== "object" || Array.isArray(x)) return {}
  const o = x as Record<string, unknown>
  const d: DatosTipoContrato = {}
  const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
  const numeroBase = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v))
  if (numeroBase(o.pago_cada_dias) !== undefined) d.pagoCadaDias = numeroBase(o.pago_cada_dias)
  if (typeof o.retencion_garantia === "boolean") d.retencionGarantia = o.retencion_garantia
  if (numeroBase(o.retencion_porcentaje) !== undefined) d.retencionPorcentaje = numeroBase(o.retencion_porcentaje)
  if (texto(o.inmueble_direccion)) d.inmuebleDireccion = texto(o.inmueble_direccion)
  if (texto(o.inmueble_uso)) d.inmuebleUso = texto(o.inmueble_uso)
  if (o.canon_iva === "mas_iva" || o.canon_iva === "incluido") d.canonIva = o.canon_iva
  if (typeof o.servicios_incluidos === "boolean") d.serviciosIncluidos = o.servicios_incluidos
  if (texto(o.correo_factura)) d.correoFactura = texto(o.correo_factura)
  if (texto(o.bien_nombre)) d.bienNombre = texto(o.bien_nombre)
  if (OPCIONES_ACTAS.some((a) => a.valor === o.actas)) d.actas = o.actas as ActasPeriodicidad
  if (typeof o.exige_garantia === "boolean") d.exigeGarantia = o.exige_garantia
  return d
}

// Para mostrar en el detalle de la solicitud: [etiqueta, valor] según el tipo.
export function datosTipoParaMostrar(tipo: TipoContrato, d: DatosTipoContrato): [string, string][] {
  const siNo = (v: boolean | undefined) => (v === undefined ? "—" : v ? "Sí" : "No")
  if (tipo === "obra" || tipo === "mano_obra") {
    return [
      ["Se pagará cada", d.pagoCadaDias ? `${d.pagoCadaDias} días` : "—"],
      [
        "Retención en garantía",
        d.retencionGarantia === undefined ? "—" : d.retencionGarantia ? `Sí, ${numero(d.retencionPorcentaje ?? 0)} %` : "No",
      ],
      ...(tipo === "mano_obra" ? [["Garantías", siNo(d.exigeGarantia)] as [string, string]] : []),
    ]
  }
  if (tipo === "arrendamiento") {
    return [
      ["Dirección del inmueble", d.inmuebleDireccion ?? "—"],
      ["Uso del inmueble", d.inmuebleUso ?? "—"],
      ["IVA del canon", d.canonIva === "incluido" ? "Incluido en el canon" : d.canonIva === "mas_iva" ? "Más IVA" : "—"],
      ["Servicios públicos", d.serviciosIncluidos === undefined ? "—" : d.serviciosIncluidos ? "Incluidos en el canon" : "Los paga el arrendatario"],
      ["Correo de la factura", d.correoFactura ?? "—"],
    ]
  }
  if (tipo === "alquiler_vehiculo") {
    return [
      ["Nombre corto del bien", d.bienNombre ?? "—"],
      ["Actas parciales", OPCIONES_ACTAS.find((a) => a.valor === d.actas)?.titulo ?? "—"],
      ["Garantías", siNo(d.exigeGarantia)],
    ]
  }
  return []
}

// Al formato de la base: solo las claves del tipo.
export function datosTipoABase(tipo: TipoContrato, d: DatosTipoContrato): Record<string, unknown> {
  if (tipo === "obra" || tipo === "mano_obra") {
    return {
      pago_cada_dias: d.pagoCadaDias,
      retencion_garantia: d.retencionGarantia,
      ...(d.retencionGarantia ? { retencion_porcentaje: d.retencionPorcentaje } : {}),
      ...(tipo === "mano_obra" ? { exige_garantia: d.exigeGarantia } : {}),
    }
  }
  if (tipo === "arrendamiento") {
    return {
      inmueble_direccion: d.inmuebleDireccion,
      inmueble_uso: d.inmuebleUso,
      canon_iva: d.canonIva,
      servicios_incluidos: d.serviciosIncluidos,
      correo_factura: d.correoFactura,
    }
  }
  if (tipo === "alquiler_vehiculo") return { bien_nombre: d.bienNombre, actas: d.actas, exige_garantia: d.exigeGarantia }
  return {}
}

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
  // Minuta (Subgerencia, 20261111000000_aprobacion_minutas.sql). null = Jurídica la está armando.
  minutaEstado: EstadoMinuta | null
  minutaEnviadaAt: string | null
  minutaEnviadaPorNombre: string | null
  minutaResueltaAt: string | null
  minutaResueltaPorNombre: string | null
  minutaMotivo: string | null
  numeroContrato: string | null
  // 'general' = Contrato general (sin ítems del presupuesto ni minuta larga;
  // 20261113000000_contratos_generales.sql). 'grupo' = Contratos por grupos.
  clase: ClaseContrato
  // Contrato general con tipo 'otro': cuál es.
  tipoDetalle: string | null
  referencia: string | null
  retencionGarantiaPct: number
  retencionAnticipoPct: number
  retencionFicPct: number
  // Otrosí aprobados (columna calculada otrosis_aprobados, 20261121000000).
  otrosisAprobados?: number
  // Póliza (20261126000000_polizas.sql): null hasta que Subgerencia aprueba.
  polizaEstado?: "pendiente" | "recibida" | "aprobada" | null
}

export type ClaseContrato = "grupo" | "general"

// Tipo de un contrato general: Servicios u Otro (con su detalle). En la base
// va en la misma columna `tipo` que los 6 tipos de por grupos.
export type TipoContratoGeneral = "servicios" | "otro"

// Nombre del tipo para mostrar, de cualquier clase de contrato.
export function nombreTipoContrato(c: { tipo: string; clase?: ClaseContrato; tipoDetalle?: string | null }): string {
  if (c.tipo === "servicios") return "Servicios"
  if (c.tipo === "otro") return c.tipoDetalle?.trim() || "Otro"
  return TIPO_CONTRATO_POR_VALOR.get(c.tipo as TipoContrato)?.titulo ?? c.tipo
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
  domicilioDepartamento: string | null
  datosTipo: DatosTipoContrato
  obligaciones: string[]
  entregables: string[]
  items: {
    presupuestoItemId: string
    codigo: string | null
    actividad: string
    unidad: string
    cantidad: number
    valorUnitario: number
    // Contrato de mano de obra con un ítem cuyo APU no tiene mano de obra:
    // su tope fue el ítem completo (para que Jurídica lo revise).
    sinManoObra?: boolean
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

// Estado de la minuta de una solicitud pre-aprobada (sin estado = en elaboración).
export type EstadoMinuta = "en_revision" | "devuelta" | "aprobada"
export const ETIQUETA_ESTADO_MINUTA: Record<EstadoMinuta | "elaboracion", string> = {
  elaboracion: "Minuta en elaboración",
  en_revision: "Minuta en Subgerencia",
  devuelta: "Minuta devuelta",
  aprobada: "Minuta aprobada",
}
export const CLASE_ESTADO_MINUTA: Record<EstadoMinuta | "elaboracion", string> = {
  elaboracion: "border-transparent bg-slate-100 text-slate-700",
  en_revision: "border-transparent bg-amber-100 text-amber-800",
  devuelta: "border-transparent bg-orange-100 text-orange-800",
  aprobada: "border-transparent bg-emerald-100 text-emerald-800",
}
// Etapa de un contrato sumando la solicitud y la minuta: lo que se muestra en
// la columna Estado de Pre aprobación y en el detalle.
export type EtapaContrato =
  | "por_revisar"
  | "devuelta_director"
  | "sin_enviar"
  | "en_subgerencia"
  | "devuelta_subgerencia"
  | "aprobado"
  | "rechazada"
export function etapaContrato(c: { estado: EstadoContrato; minutaEstado: EstadoMinuta | null }): EtapaContrato {
  if (c.estado === "pre_aprobacion") return "por_revisar"
  if (c.estado === "devuelta") return "devuelta_director"
  if (c.estado === "rechazada") return "rechazada"
  if (c.minutaEstado === "en_revision") return "en_subgerencia"
  if (c.minutaEstado === "devuelta") return "devuelta_subgerencia"
  if (c.minutaEstado === "aprobada") return "aprobado"
  return "sin_enviar"
}
export const ETIQUETA_ETAPA_CONTRATO: Record<EtapaContrato, string> = {
  por_revisar: "Por revisar",
  devuelta_director: "Devuelta al director",
  sin_enviar: "Pre-aprobada sin enviar",
  en_subgerencia: "En Subgerencia",
  devuelta_subgerencia: "Devuelta por Subgerencia",
  aprobado: "Aprobado por Subgerencia",
  rechazada: "Rechazada",
}
export const CLASE_ETAPA_CONTRATO: Record<EtapaContrato, string> = {
  por_revisar: "border-transparent bg-amber-100 text-amber-800",
  devuelta_director: "border-transparent bg-orange-100 text-orange-800",
  sin_enviar: "border-transparent bg-slate-100 text-slate-700",
  en_subgerencia: "border-transparent bg-sky-100 text-sky-800",
  devuelta_subgerencia: "border-transparent bg-orange-100 text-orange-800",
  aprobado: "border-transparent bg-emerald-100 text-emerald-800",
  rechazada: "border-transparent bg-red-100 text-red-800",
}

// Tipos con plantilla de minuta (components/minuta-segun-tipo.tsx).
export const TIPOS_CON_MINUTA: ReadonlySet<TipoContrato> = new Set<TipoContrato>([
  "mano_obra", "arrendamiento", "suministro_instalacion", "alquiler_vehiculo", "prestacion_servicios", "obra",
])
// Jurídica edita y envía la minuta mientras no esté en Subgerencia ni aprobada.
export const minutaEditable = (c: { estado: EstadoContrato; minutaEstado: EstadoMinuta | null }) =>
  c.estado !== "rechazada" && c.minutaEstado !== "en_revision" && c.minutaEstado !== "aprobada"

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
  valorUnitario: number // del presupuesto (ítem completo)
  valorManoObra: number // mano de obra + herramienta menor del APU (0 = sin mano de obra)
  contratado: number // ya en otros contratos
  disponible: number // tope de la cantidad
}

// Valor unitario máximo de una actividad según el tipo de contrato (igual que
// _tope_valor_unitario_item): en mano de obra, la mano de obra del APU (+
// herramienta menor); si el APU no tiene, el ítem completo. Los demás tipos
// (obra todo costo...), el ítem completo.
export const topeValorUnitario = (item: { valorUnitario: number; valorManoObra: number }, tipo: string) =>
  tipo === "mano_obra" && item.valorManoObra > 0 ? Math.min(item.valorManoObra, item.valorUnitario) : item.valorUnitario
export const sinManoObraEnApu = (item: { valorManoObra: number }, tipo: string) => tipo === "mano_obra" && item.valorManoObra <= 0

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
  departamentoDomicilio: string
  // Según el tipo (DatosTipoContrato); "si" / "no" / "" para las preguntas.
  pagoCadaDias: string
  retencionGarantia: "" | "si" | "no"
  retencionPorcentaje: string
  inmuebleDireccion: string
  inmuebleUso: string
  canonIva: "" | IvaCanonSolicitud
  serviciosIncluidos: "" | "si" | "no"
  correoFactura: string
  bienNombre: string
  actas: "" | ActasPeriodicidad
  exigeGarantia: "" | "si" | "no"
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
  | "departamentoDomicilio"
  | "pagoCadaDias"
  | "retencion"
  | "inmuebleDireccion"
  | "inmuebleUso"
  | "canonIva"
  | "serviciosIncluidos"
  | "correoFactura"
  | "bienNombre"
  | "actas"
  | "exigeGarantia"

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
  departamentoDomicilio: string
  datosTipo: DatosTipoContrato
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
        const tope = topeValorUnitario(ref, f.tipo)
        if (valorUnitario > tope) {
          errores.items =
            tope < ref.valorUnitario
              ? `Ítem ${ref.codigo}: el valor unitario (${pesos(valorUnitario)}) supera el de mano de obra del presupuesto (${pesos(tope)}).`
              : `Ítem ${ref.codigo}: el valor unitario (${pesos(valorUnitario)}) supera el del presupuesto (${pesos(ref.valorUnitario)}).`
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

  // Domicilio (todos los tipos) y datos de la minuta según el tipo.
  const departamentoDomicilio = f.departamentoDomicilio.trim().replace(/\s+/g, " ")
  if (!departamentoDomicilio) errores.departamentoDomicilio = "Escribe el departamento de domicilio del contrato."
  const datosTipo: DatosTipoContrato = {}
  if (f.tipo === "obra" || f.tipo === "mano_obra") {
    const dias = Number(f.pagoCadaDias.trim())
    if (!Number.isInteger(dias) || dias <= 0) errores.pagoCadaDias = "Escribe cada cuántos días se paga (número entero)."
    else datosTipo.pagoCadaDias = dias
    if (!f.retencionGarantia) errores.retencion = "Indica si hay retención en garantía."
    else {
      datosTipo.retencionGarantia = f.retencionGarantia === "si"
      if (f.retencionGarantia === "si") {
        const p = leerNumero(f.retencionPorcentaje.replace(/%/g, ""))
        if (p === null || p <= 0 || p > 100) errores.retencion = "Escribe el porcentaje de retención en garantía (entre 1 y 100)."
        else datosTipo.retencionPorcentaje = p
      }
    }
    if (f.tipo === "mano_obra") {
      if (!f.exigeGarantia) errores.exigeGarantia = "Indica si el contrato exige garantías."
      else datosTipo.exigeGarantia = f.exigeGarantia === "si"
    }
  } else if (f.tipo === "arrendamiento") {
    const direccion = f.inmuebleDireccion.trim()
    const uso = f.inmuebleUso.trim()
    const correoFactura = f.correoFactura.trim().toLowerCase()
    if (!direccion) errores.inmuebleDireccion = "Escribe la dirección del inmueble."
    if (!uso) errores.inmuebleUso = "Escribe el uso del inmueble."
    if (!f.canonIva) errores.canonIva = "Indica si el canon es más IVA o incluye el IVA."
    if (!f.serviciosIncluidos) errores.serviciosIncluidos = "Indica si el canon incluye los servicios públicos."
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correoFactura)) errores.correoFactura = "Escribe un correo válido para la factura."
    Object.assign(datosTipo, {
      inmuebleDireccion: direccion,
      inmuebleUso: uso,
      canonIva: f.canonIva || undefined,
      serviciosIncluidos: f.serviciosIncluidos ? f.serviciosIncluidos === "si" : undefined,
      correoFactura,
    })
  } else if (f.tipo === "alquiler_vehiculo") {
    const nombre = f.bienNombre.trim()
    if (!nombre) errores.bienNombre = "Escribe el nombre corto del vehículo o la maquinaria."
    if (!f.actas) errores.actas = "Elige cada cuánto son las actas parciales."
    if (!f.exigeGarantia) errores.exigeGarantia = "Indica si el contrato tiene garantías."
    Object.assign(datosTipo, {
      bienNombre: nombre,
      actas: f.actas || undefined,
      exigeGarantia: f.exigeGarantia ? f.exigeGarantia === "si" : undefined,
    })
  }

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
      departamentoDomicilio,
      datosTipo,
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

// ---------------------------------------------------------------- contrato general
// Formulario del contrato general (como el "Contrato General" de Sinco): valor
// global, fechas, forma de pago, retenciones, referencia, descripción y
// observaciones. La base valida lo mismo en _guardar_contrato_general.

export type ContratoGeneralForm = {
  tipo: TipoContratoGeneral
  tipoDetalle: string
  contratistaId: string
  objeto: string // descripción
  valor: string
  fechaInicio: string
  fechaFin: string
  formaPago: string
  retencionGarantiaPct: string
  retencionAnticipoPct: string
  retencionFicPct: string
  referencia: string
  correoNotificacion: string
  observaciones: string
}

export type CampoContratoGeneral = keyof ContratoGeneralForm | "plazo"

export const CONTRATO_GENERAL_VACIO: ContratoGeneralForm = {
  tipo: "servicios",
  tipoDetalle: "",
  contratistaId: "",
  objeto: "",
  valor: "",
  fechaInicio: "",
  fechaFin: "",
  formaPago: "",
  retencionGarantiaPct: "0",
  retencionAnticipoPct: "0",
  retencionFicPct: "0",
  referencia: "",
  correoNotificacion: "",
  observaciones: "",
}

export type ContratoGeneralValido = {
  tipo: TipoContratoGeneral
  tipoDetalle: string | null
  contratistaId: string
  objeto: string
  valor: number
  fechaInicio: string
  fechaFin: string
  formaPago: string
  retencionGarantiaPct: number
  retencionAnticipoPct: number
  retencionFicPct: number
  referencia: string | null
  correoNotificacion: string
  observaciones: string | null
}

// Porcentaje de retención: vacío = 0; entre 0 y 100.
function leerPorcentaje(texto: string): number | null {
  if (!texto.trim()) return 0
  const v = leerNumero(texto)
  return v === null || v < 0 || v > 100 ? null : aCentavos(v)
}

export function validarContratoGeneral(
  f: ContratoGeneralForm
): { ok: true; datos: ContratoGeneralValido } | { ok: false; errores: Partial<Record<CampoContratoGeneral, string>> } {
  const errores: Partial<Record<CampoContratoGeneral, string>> = {}
  if (f.tipo !== "servicios" && f.tipo !== "otro") errores.tipo = "Elige Servicios u Otro."
  if (f.tipo === "otro" && !f.tipoDetalle.trim()) errores.tipoDetalle = "Escribe qué tipo de contrato es."
  if (!f.contratistaId) errores.contratistaId = "Elige el contratista."
  const objeto = f.objeto.trim().replace(/\s+/g, " ")
  if (objeto.length < 5) errores.objeto = "Escribe la descripción del contrato."
  const valor = leerNumero(f.valor)
  if (valor === null || valor <= 0) errores.valor = "Escribe el valor del contrato en pesos."
  if (!f.fechaInicio || !f.fechaFin) errores.plazo = "Escribe las fechas de inicio y de terminación."
  else if (f.fechaFin < f.fechaInicio) errores.plazo = "La fecha de terminación es anterior a la de inicio."
  if (!f.formaPago.trim()) errores.formaPago = "Escribe la forma de pago."
  const garantia = leerPorcentaje(f.retencionGarantiaPct)
  const anticipo = leerPorcentaje(f.retencionAnticipoPct)
  const fic = leerPorcentaje(f.retencionFicPct)
  if (garantia === null) errores.retencionGarantiaPct = "Entre 0 y 100."
  if (anticipo === null) errores.retencionAnticipoPct = "Entre 0 y 100."
  if (fic === null) errores.retencionFicPct = "Entre 0 y 100."
  const correo = f.correoNotificacion.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) errores.correoNotificacion = "Escribe un correo válido."
  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    datos: {
      tipo: f.tipo,
      tipoDetalle: f.tipo === "otro" ? f.tipoDetalle.trim() : null,
      contratistaId: f.contratistaId,
      objeto,
      valor: aCentavos(valor!),
      fechaInicio: f.fechaInicio,
      fechaFin: f.fechaFin,
      formaPago: f.formaPago.trim(),
      retencionGarantiaPct: garantia!,
      retencionAnticipoPct: anticipo!,
      retencionFicPct: fic!,
      referencia: f.referencia.trim() || null,
      correoNotificacion: correo,
      observaciones: f.observaciones.trim() || null,
    },
  }
}

// Formulario lleno con un contrato general DEVUELTO (para corregirlo).
export function contratoGeneralDesde(d: SolicitudContratoDetalle): ContratoGeneralForm {
  const pctTexto = (v: number) => String(v).replace(".", ",")
  const tipo: TipoContratoGeneral = (d.tipo as string) === "otro" ? "otro" : "servicios"
  return {
    tipo,
    tipoDetalle: d.tipoDetalle ?? "",
    contratistaId: d.contratistaId,
    objeto: d.objeto,
    valor: String(d.valor).replace(".", ","),
    fechaInicio: d.fechaInicio ?? "",
    fechaFin: d.fechaFin ?? "",
    formaPago: d.formaPago,
    retencionGarantiaPct: pctTexto(d.retencionGarantiaPct),
    retencionAnticipoPct: pctTexto(d.retencionAnticipoPct),
    retencionFicPct: pctTexto(d.retencionFicPct),
    referencia: d.referencia ?? "",
    correoNotificacion: d.correoNotificacion,
    observaciones: d.observaciones ?? "",
  }
}
