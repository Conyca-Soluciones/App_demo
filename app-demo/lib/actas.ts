// Actas de contratos (pestañas contratos.cortes y contratos.aprobar_actas).
// Tipos y cálculos compartidos por las pantallas y las acciones del servidor.
// La base (`_guardar_acta`, 20261112000000_actas_sobre_contrato.sql) vuelve a
// calcular todo y es la que manda: lo de aquí es lo que se ve mientras se llena.
//
// El acta cobra lo PACTADO en el contrato:
// - valores unitarios: las actividades del anexo con su valor unitario;
//   tope por actividad = cantidad contratada (acumulado + esta acta);
// - valor global: un % de avance (acumulado <= 100 %).
// Descuentos: amortización del anticipo, retención en garantía y otros.

import { aCentavos, leerNumero, numero, type TipoContrato } from "@/lib/contratos"

export type TipoActa = "parcial" | "final" | "liquidacion"
export const ETIQUETA_TIPO_ACTA: Record<TipoActa, string> = {
  parcial: "Acta parcial",
  final: "Acta final",
  liquidacion: "Acta de liquidación",
}

export type EstadoActa = "pendiente" | "aprobada" | "rechazada"
// Un acta se aprueba o rechaza con su pago en A&F: "pendiente" = pago por aprobar.
export const ETIQUETA_ESTADO_ACTA: Record<EstadoActa, string> = {
  pendiente: "Pago por aprobar",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
}
export const CLASE_ESTADO_ACTA: Record<EstadoActa, string> = {
  pendiente: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  aprobada: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  rechazada: "bg-red-100 text-red-800 hover:bg-red-100",
}

export type TipoSoporte = "factura" | "memoria" | "foto" | "otro"
export const ETIQUETA_SOPORTE: Record<TipoSoporte, string> = {
  factura: "Factura del contratista",
  memoria: "Memoria de cantidades",
  foto: "Registro fotográfico",
  otro: "Otro",
}
export const MIME_SOPORTES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]
export const TAMANO_MAXIMO_SOPORTE = 10 * 1024 * 1024
export function validarSoporte(archivo: File): string | null {
  if (!MIME_SOPORTES.includes(archivo.type)) return "Solo PDF, JPG, PNG o Excel (.xlsx)."
  if (archivo.size > TAMANO_MAXIMO_SOPORTE) return "El archivo pesa más de 10 MB."
  return null
}

// ---------------------------------------------------------------- búsqueda
export type ContratoParaActa = {
  id: string
  numeroContrato: string
  numero: number
  tipo: TipoContrato
  objeto: string
  valor: number
  proyectoCodigo: string
  proyectoNombre: string
  contratistaId: string
  contratistaNombre: string
  contratistaDocumento: string
  actas: number
}

export type ContratistaParaActa = {
  id: string
  nombre: string
  documento: string
  contratos: number
}

export type ActaResumen = {
  id: string
  numero: number
  tipo: TipoActa
  estado: EstadoActa
  valorBruto: number
  neto: number
  periodoDesde: string | null
  periodoHasta: string | null
  createdAt: string
  creadoPorNombre: string | null
  // La hizo el usuario actual (solo quien la creó la puede editar).
  esMio: boolean
}

// La edita solo quien la creó, y solo si no está aprobada (por aprobar o rechazada).
export const actaEditable = (a: { estado: EstadoActa; esMio: boolean }) => a.esMio && a.estado !== "aprobada"

// Cupo del contrato: el valor bruto de toda acta que no esté rechazada.
export function consumidoActas(actas: { estado: EstadoActa; valorBruto: number }[]): number {
  let suma = 0
  for (const a of actas) if (a.estado !== "rechazada") suma += a.valorBruto
  return aCentavos(suma)
}
export const saldoContrato = (valor: number, consumido: number) => aCentavos(valor - consumido)

// ---------------------------------------------------------------- contrato para el acta
export type ActividadContrato = {
  id: string
  orden: number
  actividad: string
  unidad: string
  cantidad: number // contratada
  valorUnitario: number
  acumulado: number // en las demás actas no rechazadas
}

export type InfoContratoActa = {
  valor: number
  anexoTipo: "valor_global" | "valores_unitarios"
  anticipoPorcentaje: number | null
  retencionPorcentaje: number | null
  fechaFin: string | null
  vencido: boolean
  liquidado: boolean
  listoParaActas: boolean
  tieneFinal: boolean
  tieneLiquidacion: boolean
  actasPorAprobar: number
  brutoOtras: number
  avanceOtras: number
  amortizadoOtras: number
  amortizadoAprobado: number
  retenidoAprobado: number
  actividades: ActividadContrato[]
}

// Qué actas se pueden hacer hoy sobre el contrato (sin contar la que se edita).
export function tiposPermitidos(info: InfoContratoActa): { tipos: TipoActa[]; motivo: string | null } {
  if (!info.listoParaActas) return { tipos: [], motivo: "La minuta del contrato todavía no está aprobada por Subgerencia." }
  if (info.liquidado) return { tipos: [], motivo: "El contrato ya está liquidado." }
  const tipos: TipoActa[] = []
  let motivo: string | null = null
  if (info.vencido) motivo = "El contrato está vencido: solo se puede hacer el acta de liquidación (para ampliar el plazo hará falta un otrosí)."
  else if (info.tieneFinal) motivo = "El contrato ya tiene acta final: sigue el acta de liquidación."
  else tipos.push("parcial", "final")
  if (!info.tieneLiquidacion && info.actasPorAprobar === 0) tipos.push("liquidacion")
  else if (!info.tieneLiquidacion && tipos.length === 0) motivo = `${motivo ?? ""} Antes de liquidar hay que aprobar o rechazar las actas por aprobar.`.trim()
  return { tipos, motivo }
}

// ---------------------------------------------------------------- formulario
export type DescuentoForm = { concepto: string; valor: string }

export type FormActa = {
  tipo: TipoActa
  periodoDesde: string
  periodoHasta: string
  observaciones: string
  // Cantidad ejecutada en esta acta por actividad del anexo (texto, formato colombiano).
  cantidades: Record<string, string>
  porcentajeAvance: string
  descuentos: DescuentoForm[]
}

export const formActaVacio = (tipo: TipoActa = "parcial"): FormActa => ({
  tipo,
  periodoDesde: "",
  periodoHasta: "",
  observaciones: "",
  cantidades: {},
  porcentajeAvance: "",
  descuentos: [],
})

export type LineaCalculada = { id: string; cantidad: number; valor: number; excede: boolean }

export type ResumenActa = {
  lineas: LineaCalculada[]
  bruto: number
  amortizacion: number
  retencion: number
  devolucionRetencion: number
  otros: number
  neto: number
  anticipoTotal: number
  saldoContrato: number // antes de esta acta
  avance: number | null // % de esta acta (valor global)
}

// Mismo cálculo que `_guardar_acta` en la base (redondeo a centavos).
export function calcularActa(info: InfoContratoActa, f: FormActa): ResumenActa {
  const anticipoTotal = info.anticipoPorcentaje ? aCentavos((info.valor * info.anticipoPorcentaje) / 100) : 0
  const saldo = aCentavos(info.valor - info.brutoOtras)
  let otros = 0
  for (const d of f.descuentos) otros += leerNumero(d.valor) ?? 0
  otros = aCentavos(otros)

  if (f.tipo === "liquidacion") {
    const devolucion = info.retenidoAprobado
    const amortizacion = Math.max(aCentavos(anticipoTotal - info.amortizadoAprobado), 0)
    return {
      lineas: [],
      bruto: 0,
      amortizacion,
      retencion: 0,
      devolucionRetencion: devolucion,
      otros,
      neto: aCentavos(devolucion - amortizacion - otros),
      anticipoTotal,
      saldoContrato: saldo,
      avance: null,
    }
  }

  const lineas: LineaCalculada[] = []
  let bruto = 0
  let avance: number | null = null
  if (info.anexoTipo === "valores_unitarios") {
    for (const a of info.actividades) {
      const cantidad = leerNumero(f.cantidades[a.id] ?? "") ?? 0
      if (cantidad <= 0) continue
      const valor = aCentavos(cantidad * a.valorUnitario)
      bruto += valor
      lineas.push({ id: a.id, cantidad, valor, excede: a.acumulado + cantidad > a.cantidad + 1e-9 })
    }
    bruto = aCentavos(bruto)
  } else {
    avance = leerNumero(f.porcentajeAvance) ?? 0
    bruto = aCentavos((info.valor * avance) / 100)
  }

  let amortizacion = 0
  if (anticipoTotal > 0 && info.anticipoPorcentaje) {
    const pendiente = Math.max(aCentavos(anticipoTotal - info.amortizadoOtras), 0)
    const propia = f.tipo === "final" ? anticipoTotal : aCentavos((bruto * info.anticipoPorcentaje) / 100)
    amortizacion = Math.min(propia, pendiente, bruto)
  }
  const retencion = info.retencionPorcentaje ? aCentavos((bruto * info.retencionPorcentaje) / 100) : 0
  return {
    lineas,
    bruto,
    amortizacion,
    retencion,
    devolucionRetencion: 0,
    otros,
    neto: aCentavos(bruto - amortizacion - retencion - otros),
    anticipoTotal,
    saldoContrato: saldo,
    avance,
  }
}

// Lo que se manda a la base (crear_acta / editar_acta), o el primer error.
export type DatosActa = {
  tipo: TipoActa
  periodo_desde: string | null
  periodo_hasta: string | null
  observaciones: string | null
  actividades: { anexo_item_id: string; cantidad: number }[]
  porcentaje_avance: number | null
  descuentos: { concepto: string; valor: number }[]
}

export function validarActa(info: InfoContratoActa, f: FormActa): { ok: true; datos: DatosActa } | { ok: false; error: string } {
  const permitidos = tiposPermitidos(info).tipos
  if (!permitidos.includes(f.tipo)) {
    return { ok: false, error: tiposPermitidos(info).motivo ?? "Este tipo de acta no se puede hacer ahora." }
  }
  if (f.periodoDesde && f.periodoHasta && f.periodoHasta < f.periodoDesde) {
    return { ok: false, error: "El período termina antes de empezar." }
  }
  const descuentos: { concepto: string; valor: number }[] = []
  for (const d of f.descuentos) {
    if (!d.concepto.trim() && !d.valor.trim()) continue
    const valor = leerNumero(d.valor)
    if (!d.concepto.trim()) return { ok: false, error: "Escribe el concepto de cada descuento." }
    if (valor == null || valor <= 0) return { ok: false, error: `El descuento "${d.concepto.trim()}" debe ser mayor que cero.` }
    descuentos.push({ concepto: d.concepto.trim(), valor })
  }

  const r = calcularActa(info, f)
  const base = {
    tipo: f.tipo,
    periodo_desde: f.periodoDesde || null,
    periodo_hasta: f.periodoHasta || null,
    observaciones: f.observaciones.trim() || null,
    descuentos,
  }
  if (f.tipo === "liquidacion") return { ok: true, datos: { ...base, actividades: [], porcentaje_avance: null } }

  if (info.anexoTipo === "valores_unitarios") {
    for (const a of info.actividades) {
      const t = (f.cantidades[a.id] ?? "").trim()
      if (!t) continue
      const n = leerNumero(t)
      if (n == null || n < 0) return { ok: false, error: `La cantidad de "${a.actividad}" no es un número válido.` }
    }
    const excede = r.lineas.find((l) => l.excede)
    if (excede) {
      const a = info.actividades.find((x) => x.id === excede.id)!
      return { ok: false, error: `"${a.actividad}" pasa de la cantidad contratada (${numero(a.cantidad)} ${a.unidad}).` }
    }
    if (r.lineas.length === 0) return { ok: false, error: "Escribe la cantidad ejecutada de al menos una actividad." }
  } else {
    if (!r.avance || r.avance <= 0) return { ok: false, error: "Escribe el porcentaje de avance de esta acta." }
    if (info.avanceOtras + r.avance > 100 + 1e-9) {
      return { ok: false, error: `El avance acumulado pasaría del 100 % (ya va en ${numero(info.avanceOtras)} %).` }
    }
  }
  if (r.bruto > r.saldoContrato) return { ok: false, error: "El acta pasa del saldo del contrato." }
  if (r.neto < 0) return { ok: false, error: "Los descuentos pasan del valor del acta." }

  return {
    ok: true,
    datos: {
      ...base,
      actividades: r.lineas.map((l) => ({ anexo_item_id: l.id, cantidad: l.cantidad })),
      porcentaje_avance: r.avance,
    },
  }
}

// ---------------------------------------------------------------- detalle
export type ActividadActa = {
  id: string
  orden: number
  actividad: string
  unidad: string
  cantidadContratada: number
  valorUnitario: number
  acumuladoAnterior: number
  cantidad: number | null // en esta acta
  valor: number | null
}

export type SoporteActa = {
  id: string
  tipo: TipoSoporte
  ruta: string
  nombreArchivo: string
  tamano: number | null
  mime: string | null
}

export type LineaActaAnterior = {
  orden: number
  itemCodigo: string | null
  itemDescripcion: string | null
  insumoDescripcion: string
  unidad: string | null
  cantidad: number
  precio: number
  total: number
}

export type ActaDetalle = {
  id: string
  numero: number
  tipo: TipoActa
  estado: EstadoActa
  periodoDesde: string | null
  periodoHasta: string | null
  observaciones: string | null
  porcentajeAvance: number | null
  valorBruto: number
  amortizacion: number
  retencion: number
  devolucionRetencion: number
  otrosDescuentos: number
  neto: number
  anticipoPorcentaje: number | null
  retencionPorcentaje: number | null
  createdAt: string
  creadoPorNombre: string | null
  resueltoAt: string | null
  resueltoPorNombre: string | null
  motivoResolucion: string | null
  editadaAt: string | null
  editadaPorNombre: string | null
  esMio: boolean
  contratoId: string
  numeroContrato: string
  contratoValor: number
  objeto: string
  tipoContrato: TipoContrato
  anexoTipo: "valor_global" | "valores_unitarios"
  proyectoCodigo: string
  proyectoNombre: string
  proyectoCiudad: string | null
  empresaNombre: string | null
  empresaNit: string | null
  contratistaId: string
  contratistaNombre: string
  contratistaTipoPersona: string | null
  contratistaDocumento: string
  contratistaRepresentante: string | null
  otrasActas: number // actas ANTERIORES a esta (número menor), no rechazadas
  avanceAnterior: number
  actividades: ActividadActa[]
  descuentos: { concepto: string; valor: number }[]
  soportes: SoporteActa[]
  pago: { id: string; estado: string; valor: number; anio: number | null; semana: number | null; item: number | null; novedad: string | null } | null
  lineasAnteriores: LineaActaAnterior[]
}

// El formulario de edición con lo que ya tenía el acta.
export function formDesdeActa(a: ActaDetalle): FormActa {
  const cantidades: Record<string, string> = {}
  for (const x of a.actividades) if (x.cantidad != null) cantidades[x.id] = numero(x.cantidad)
  return {
    tipo: a.tipo,
    periodoDesde: a.periodoDesde ?? "",
    periodoHasta: a.periodoHasta ?? "",
    observaciones: a.observaciones ?? "",
    cantidades,
    porcentajeAvance: a.porcentajeAvance != null ? numero(a.porcentajeAvance) : "",
    descuentos: a.descuentos.map((d) => ({ concepto: d.concepto, valor: numero(d.valor) })),
  }
}

// ---------------------------------------------------------------- aprobación
export type ActaAprobacionFila = {
  id: string
  numero: number
  tipo: TipoActa
  estado: EstadoActa
  valorBruto: number
  neto: number
  createdAt: string
  creadoPorNombre: string | null
  contratoId: string
  numeroContrato: string
  contratoValor: number
  proyectoCodigo: string
  proyectoNombre: string
  contratistaNombre: string
  resueltoPorNombre: string | null
  resueltoAt: string | null
}
