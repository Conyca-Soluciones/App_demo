// ---------------------------------------------------------------------------
// Tipos y utilidades de los PAGOS de A&F (Aprobación de pagos y Consolidado).
// Archivo plano (sin "use server"/"use client"): lo comparten las actions y los
// componentes de cliente.
// ---------------------------------------------------------------------------

export type EstadoPago =
  | "programado"
  | "solicitado"
  | "aprobado"
  | "liquidado"
  | "en_dispersion"
  | "dispersado"
  | "rechazado"
  | "anulado"

export const ETIQUETA_ESTADO_PAGO: Record<EstadoPago, string> = {
  programado: "Programado",
  solicitado: "Por aprobar",
  aprobado: "Aprobado",
  liquidado: "Liquidado",
  en_dispersion: "En dispersión",
  dispersado: "Pagado",
  rechazado: "Rechazado",
  anulado: "Anulado",
}

// Mismo tamaño y colores que el resto de la app (amarillo pendiente, verde
// aprobado, rojo rechazado, gris cancelado).
export const CLASE_ESTADO_PAGO: Record<EstadoPago, string> = {
  programado: "border-gray-300 bg-gray-50 text-gray-600",
  solicitado: "border-amber-300 bg-amber-50 text-amber-700",
  aprobado: "border-green-300 bg-green-50 text-green-700",
  liquidado: "border-blue-300 bg-blue-50 text-blue-700",
  en_dispersion: "border-indigo-300 bg-indigo-50 text-indigo-700",
  dispersado: "border-emerald-300 bg-emerald-50 text-emerald-800",
  rechazado: "border-red-300 bg-red-50 text-red-700",
  anulado: "border-gray-300 bg-gray-50 text-gray-500",
}

export type TipoPago = "unico" | "anticipo" | "saldo"

export const ETIQUETA_TIPO_PAGO: Record<TipoPago, string> = {
  unico: "Pago total",
  anticipo: "Anticipo",
  saldo: "Saldo",
}

export type Pago = {
  id: string
  tipo: TipoPago
  estado: EstadoPago
  valor: number
  concepto: string
  novedad: string | null
  fechaProgramada: string | null
  anio: number | null
  semana: number | null
  item: number | null
  solicitadoEn: string | null
  aprobadoEn: string | null
  aprobadoPorNombre: string | null
  rechazadoPorNombre: string | null
  motivoRechazo: string | null
  ordenNumero: number | null
  // Requisición administrativa de la que sale el pago (para ver su detalle).
  requisicionAdminId: string | null
  // Fila de la requisición en Aprobación de pagos (el pago del ítem 1): se
  // aprueba o rechaza la requisición completa, con el total y los ítems de su
  // lote. null = no es la fila de una requisición.
  requisicionAdminLote: { items: number; total: number } | null
  // Documento de donde sale el pago (para abrir su detalle).
  ordenCompraId: string | null
  actaId: string | null
  requisicionAdminItemId: string | null
  origen: string
  actaBruto: number | null
  proyectoCodigo: string | null
  proyectoNombre: string | null
  empresaNombre: string | null
  consolidadoId: string | null
  terceroId: string | null
  terceroNombre: string | null
  terceroDocumento: string | null
  cuentaId: string | null
  cuentaTexto: string | null
  cuentaVerificada: boolean
  numeroFactura: string | null
  solicitadoPorNombre: string | null
  // Desglose de origen (como el cuadro de pagos), guardado al crear el pago:
  // valor = valorDocumento − descuentoAnticipos − retencionGarantia − otrosDescuentos.
  valorDocumento: number | null
  baseGravable: number | null
  iva: number | null
  descuentoAnticipos: number
  retencionGarantia: number
  otrosDescuentos: number
}

// Columna "Anticipos y/o descuentos" del cuadro: anticipos ya girados (o
// amortización del acta) y otros descuentos del acta.
export function anticiposYDescuentos(p: Pick<Pago, "descuentoAnticipos" | "otrosDescuentos">): number {
  return p.descuentoAnticipos + p.otrosDescuentos
}

// Ítem de una requisición administrativa, visto desde su pago (doble clic en
// el Consolidado o en Aprobación de pagos).
export type RequisicionAdminDePago = {
  numero: number | null
  metodo: string
  estado: string
  creadoPorNombre: string | null
  enviadaEn: string | null
  resueltaEn: string | null
  empresa: string | null
  facturaNombre: string
  facturaNit: string
  titularNombre: string
  titularDocumento: string
  cuentaTexto: string | null
  concepto: string
  proyecto: string | null
  valor: number
  observaciones: string | null
}

// Pestañas que dejan ver pagos: Aprobación de pagos y la de cada consolidado.
export const PESTANA_CONSOLIDADO = (clave: string) => `ayf.consolidado_${clave}`
export const CONSOLIDADOS = [
  { clave: "bogota", titulo: "Consolidado Bogotá" },
  { clave: "vanur", titulo: "Consolidado Vanur" },
  { clave: "otros", titulo: "Consolidado Otros" },
] as const
export type ClaveConsolidado = (typeof CONSOLIDADOS)[number]["clave"]

export function esClaveConsolidado(c: string): c is ClaveConsolidado {
  return CONSOLIDADOS.some((x) => x.clave === c)
}

export type FiltrosAprobacionPagos = {
  estado?: EstadoPago
  tercero?: string
}

export type FiltrosConsolidado = {
  // El consolidado es el de la pestaña. Vacíos o sin enviar = todos. Las semanas valen en cada año elegido.
  anios?: number[]
  semanas?: number[]
  estado?: EstadoPago
  tercero?: string
  soloConNovedad?: boolean
}

export const formatoMoneda = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

export const formatoFechaHora = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Bogota",
  })

// Año y semana ISO (lunes a domingo) de una fecha, en hora de Colombia: la
// misma regla que usa la base para asignar el ITEM.
// Lunes a domingo de la semana ISO: (2026, 42) -> "12/10/2026 al 18/10/2026".
export function fechasSemanaIso(anio: number, semana: number): string {
  // El 4 de enero siempre cae en la semana 1.
  const enero4 = new Date(Date.UTC(anio, 0, 4))
  const lunes = new Date(enero4)
  lunes.setUTCDate(enero4.getUTCDate() - ((enero4.getUTCDay() || 7) - 1) + (semana - 1) * 7)
  const domingo = new Date(lunes)
  domingo.setUTCDate(lunes.getUTCDate() + 6)
  const f = (d: Date) => d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
  return `${f(lunes)} al ${f(domingo)}`
}

// Semanas que tiene el año ISO (52 o 53): la del 28 de diciembre.
export function semanasDelAnio(anio: number): number {
  return semanaIso(new Date(Date.UTC(anio, 11, 28, 17))).semana
}

export function semanaIso(fecha: Date = new Date()): { anio: number; semana: number } {
  const [a, m, d] = fecha
    .toLocaleDateString("en-CA", { timeZone: "America/Bogota" })
    .split("-")
    .map(Number)
  const f = new Date(Date.UTC(a, m - 1, d))
  // El jueves de esa semana decide a qué año ISO pertenece.
  f.setUTCDate(f.getUTCDate() + 4 - (f.getUTCDay() || 7))
  const inicioAnio = Date.UTC(f.getUTCFullYear(), 0, 1)
  const semana = Math.ceil(((f.getTime() - inicioAnio) / 86400000 + 1) / 7)
  return { anio: f.getUTCFullYear(), semana }
}
