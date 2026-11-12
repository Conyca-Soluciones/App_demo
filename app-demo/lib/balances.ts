/* eslint-disable @typescript-eslint/no-explicit-any */
// Balances (A&F, 20270101001200): saldo de cada cuenta a debitar = saldo de
// inicio + ingresos − egresos ± traslados internos − pagos dispersados o
// pagados sin dispersor (desde la fecha de corte). La base lo calcula; aquí van
// los tipos, las etiquetas y la validación del formulario (archivo plano, lo
// usan la pantalla y las actions).

// Sección Balances: dos pestañas (ver cualquiera de las dos deja leer).
export const PESTANA_SALDOS_BANCARIOS = "ayf.balances_saldos"
export const PESTANA_REGISTRAR_MOVIMIENTOS = "ayf.balances_movimientos"
export const PESTANAS_BALANCES = [PESTANA_SALDOS_BANCARIOS, PESTANA_REGISTRAR_MOVIMIENTOS]
export const ACCION_REGISTRAR_MOVIMIENTOS = "registrar_movimientos_bancarios"

export type TipoMovimiento = "ingreso" | "egreso" | "traslado"

export const ETIQUETA_TIPO_MOVIMIENTO: Record<TipoMovimiento, string> = {
  ingreso: "Ingreso",
  egreso: "Egreso externo",
  traslado: "Traslado interno",
}

// Línea del extracto (clase de _lineas_balance).
export type ClaseLinea = "ingreso" | "egreso" | "traslado_entrada" | "traslado_salida" | "pago_dispersor" | "pago_sin_dispersor"

export const ETIQUETA_CLASE_LINEA: Record<ClaseLinea, string> = {
  ingreso: "Ingreso",
  egreso: "Egreso externo",
  traslado_entrada: "Traslado (entra)",
  traslado_salida: "Traslado (sale)",
  pago_dispersor: "Pago por dispersor",
  pago_sin_dispersor: "Pago PSE / otro medio",
}

export type SaldoCuenta = {
  id: string
  apodo: string
  banco: string
  tipoCuenta: string
  numeroCuenta: string
  empresa: string
  estado: string
  saldoInicial: number | null
  fechaCorte: string | null
  ingresos: number
  egresos: number
  traslados: number
  pagos: number
  saldoActual: number | null
  ultimoMovimiento: string | null
}

export type LineaExtracto = {
  fecha: string
  clase: ClaseLinea
  codigo: string | null
  titular: string | null
  concepto: string | null
  valor: number
  saldo: number
  registroId: string
}

export type Extracto = {
  sinSaldoInicial: boolean
  saldoInicial: number
  fechaCorte: string | null
  desde: string | null
  hasta: string | null
  saldoAnterior: number
  saldoFinal: number
  filas: LineaExtracto[]
}

export type MovimientoBancario = {
  id: string
  codigo: string
  tipo: TipoMovimiento
  fecha: string
  valor: number
  concepto: string
  titular: string | null
  cuentaId: string
  cuenta: string
  banco: string | null
  cuentaDestinoId: string | null
  cuentaDestino: string | null
  empresa: string | null
  soporteNombre: string | null
  creadoPor: string | null
  creadoEn: string
  editadoPor: string | null
  editadoEn: string | null
  eliminadoPor: string | null
  eliminadoEn: string | null
  motivoEliminacion: string | null
}

// Ingreso o egreso externo para el Consolidado Gerencia.
export type MovimientoGerencia = {
  id: string
  codigo: string
  tipo: "ingreso" | "egreso"
  fecha: string
  anio: number
  semana: number
  valor: number
  concepto: string
  titular: string
  cuenta: string
  banco: string | null
  empresa: string | null
  soporteNombre: string | null
  creadoPor: string | null
}

export type FormMovimiento = {
  tipo: TipoMovimiento
  cuentaId: string
  cuentaDestinoId: string
  fecha: string // AAAA-MM-DD
  valor: number | null
  concepto: string
  titular: string
}

/** Errores por campo del formulario (vacío = se puede guardar). La base vuelve a validar. */
export function validarMovimiento(f: FormMovimiento, hoy: string): Partial<Record<keyof FormMovimiento, string>> {
  const e: Partial<Record<keyof FormMovimiento, string>> = {}
  if (!f.cuentaId) e.cuentaId = f.tipo === "traslado" ? "Escoge la cuenta de origen." : "Escoge la cuenta."
  if (f.tipo === "traslado") {
    if (!f.cuentaDestinoId) e.cuentaDestinoId = "Escoge la cuenta de destino."
    else if (f.cuentaDestinoId === f.cuentaId) e.cuentaDestinoId = "Debe ser otra cuenta."
  } else if (!f.titular.trim()) e.titular = "Escribe el titular."
  else if (f.titular.trim().length > 200) e.titular = "Máximo 200 caracteres."
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) e.fecha = "Escoge la fecha."
  else if (f.fecha > hoy) e.fecha = "La fecha no puede ser futura."
  if (f.valor == null || !Number.isFinite(f.valor) || f.valor <= 0) e.valor = "El valor debe ser mayor que cero."
  if (!f.concepto.trim()) e.concepto = "Escribe el concepto."
  else if (f.concepto.trim().length > 500) e.concepto = "Máximo 500 caracteres."
  return e
}

const num = (v: unknown) => Number(v ?? 0)
const numONull = (v: unknown) => (v == null ? null : Number(v))

export function mapSaldoCuenta(r: any): SaldoCuenta {
  return {
    id: r.id,
    apodo: r.apodo ?? "",
    banco: r.banco ?? "",
    tipoCuenta: r.tipo_cuenta ?? "",
    numeroCuenta: r.numero_cuenta ?? "",
    empresa: r.empresa ?? "",
    estado: r.estado ?? "",
    saldoInicial: numONull(r.saldo_inicial),
    fechaCorte: r.fecha_corte ?? null,
    ingresos: num(r.ingresos),
    egresos: num(r.egresos),
    traslados: num(r.traslados),
    pagos: num(r.pagos),
    saldoActual: numONull(r.saldo_actual),
    ultimoMovimiento: r.ultimo_movimiento ?? null,
  }
}

export function mapExtracto(j: any): Extracto {
  return {
    sinSaldoInicial: Boolean(j?.sin_saldo_inicial),
    saldoInicial: num(j?.saldo_inicial),
    fechaCorte: j?.fecha_corte ?? null,
    desde: j?.desde ?? null,
    hasta: j?.hasta ?? null,
    saldoAnterior: num(j?.saldo_anterior),
    saldoFinal: num(j?.saldo_final),
    filas: ((j?.filas ?? []) as any[]).map((f) => ({
      fecha: f.fecha,
      clase: f.clase,
      codigo: f.codigo ?? null,
      titular: f.titular ?? null,
      concepto: f.concepto ?? null,
      valor: num(f.valor),
      saldo: num(f.saldo),
      registroId: f.registro_id,
    })),
  }
}

export function mapMovimiento(r: any): MovimientoBancario {
  return {
    id: r.id,
    codigo: r.codigo,
    tipo: r.tipo,
    fecha: r.fecha,
    valor: num(r.valor),
    concepto: r.concepto ?? "",
    titular: r.titular ?? null,
    cuentaId: r.cuenta_id,
    cuenta: r.cuenta ?? "",
    banco: r.banco ?? null,
    cuentaDestinoId: r.cuenta_destino_id ?? null,
    cuentaDestino: r.cuenta_destino ?? null,
    empresa: r.empresa ?? null,
    soporteNombre: r.soporte_nombre ?? null,
    creadoPor: r.creado_por ?? null,
    creadoEn: r.creado_en,
    editadoPor: r.editado_por ?? null,
    editadoEn: r.editado_en ?? null,
    eliminadoPor: r.eliminado_por ?? null,
    eliminadoEn: r.eliminado_en ?? null,
    motivoEliminacion: r.motivo_eliminacion ?? null,
  }
}

export function mapMovimientoGerencia(r: any): MovimientoGerencia {
  return {
    id: r.id,
    codigo: r.codigo,
    tipo: r.tipo,
    fecha: r.fecha,
    anio: num(r.anio),
    semana: num(r.semana),
    valor: num(r.valor),
    concepto: r.concepto ?? "",
    titular: r.titular ?? "",
    cuenta: r.cuenta ?? "",
    banco: r.banco ?? null,
    empresa: r.empresa ?? null,
    soporteNombre: r.soporte_nombre ?? null,
    creadoPor: r.creado_por ?? null,
  }
}

/** "BANCOLOMBIA · CONYCA AHORROS ****1234" para listas de cuentas. */
export function etiquetaCuenta(c: Pick<SaldoCuenta, "apodo" | "banco" | "tipoCuenta" | "numeroCuenta">): string {
  const ultimos = c.numeroCuenta ? ` ****${c.numeroCuenta.slice(-4)}` : ""
  return `${c.apodo} · ${c.banco}${c.tipoCuenta ? ` ${c.tipoCuenta.toLowerCase()}` : ""}${ultimos}`
}
