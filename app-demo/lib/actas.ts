// Elaboración de actas de contratos (pestaña contratos.cortes). Tipos y
// cálculos compartidos por la pantalla y las acciones del servidor. La base
// (crear_acta, 20261110000000_actas_contratos.sql) vuelve a poner precio e IVA
// y recalcula todo: lo de aquí es lo que se ve mientras se llena.

import { aCentavos, leerNumero, type TipoContrato } from "@/lib/contratos"

export const MAX_LINEAS_ACTA = 20

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

export type EstadoActa = "pendiente" | "aprobada" | "rechazada"
export const ETIQUETA_ESTADO_ACTA: Record<EstadoActa, string> = {
  pendiente: "Por aprobar",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
}
export const CLASE_ESTADO_ACTA: Record<EstadoActa, string> = {
  pendiente: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  aprobada: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
  rechazada: "bg-red-100 text-red-800 hover:bg-red-100",
}

export type ActaResumen = {
  id: string
  numero: number
  estado: EstadoActa
  total: number
  createdAt: string
  creadoPorNombre: string | null
  lineas: number
}

// Cupo del contrato: toda acta que no esté rechazada (por aprobar o aprobada)
// consume valor; las actas no pueden sumar más que el contrato (crear_acta).
export function consumidoActas(actas: { estado: EstadoActa; total: number }[]): number {
  let suma = 0
  for (const a of actas) if (a.estado !== "rechazada") suma += a.total
  return aCentavos(suma)
}
export const saldoContrato = (valor: number, consumido: number) => aCentavos(valor - consumido)

export type LineaActaDetalle = {
  orden: number
  itemCodigo: string | null
  itemDescripcion: string | null
  insumoCodigo: number | null
  insumoDescripcion: string
  unidad: string | null
  cantidad: number
  precio: number
  ivaPorcentaje: number
  baseIva: number
  iva: number
  total: number
}

export type ActaDetalle = {
  id: string
  numero: number
  estado: EstadoActa
  total: number
  createdAt: string
  creadoPorNombre: string | null
  resueltoAt: string | null
  resueltoPorNombre: string | null
  motivoResolucion: string | null
  contratoId: string
  numeroContrato: string
  contratoValor: number
  objeto: string
  tipo: TipoContrato
  proyectoCodigo: string
  proyectoNombre: string
  contratistaNombre: string
  contratistaDocumento: string
  // Lo que usan las demás actas del contrato (por aprobar + aprobadas).
  otrasActas: number
  lineas: LineaActaDetalle[]
}

export type ActaAprobacionFila = {
  id: string
  numero: number
  estado: EstadoActa
  total: number
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

export type ItemParaActa = { id: string; codigo: string; descripcion: string; unidad: string | null }

export type InsumoParaActa = {
  itemApuId: string
  insumoCodigo: number | null
  descripcion: string
  unidad: string | null
  precio: number | null
  ivaPorcentaje: number
}

// Una línea del formulario: el ítem y el insumo elegidos y la cantidad escrita.
export type LineaActaForm = {
  item: ItemParaActa | null
  insumo: InsumoParaActa | null
  cantidad: string
}

export const lineaActaVacia = (): LineaActaForm => ({ item: null, insumo: null, cantidad: "" })

export type CalculoLinea = { base: number; iva: number; total: number }

// Base IVA = cantidad × precio; IVA = base × %; total = base + IVA. Cada uno
// redondeado a centavos, igual que crear_acta.
export function calcularLinea(cantidad: number, precio: number, ivaPorcentaje: number): CalculoLinea {
  const base = aCentavos(cantidad * precio)
  const iva = aCentavos((base * ivaPorcentaje) / 100)
  return { base, iva, total: aCentavos(base + iva) }
}

// Lo calculado de una línea del formulario; null si todavía falta algo.
export function calculoLineaForm(l: LineaActaForm): CalculoLinea | null {
  const cantidad = leerNumero(l.cantidad)
  if (!l.insumo || l.insumo.precio == null || cantidad == null || cantidad <= 0) return null
  return calcularLinea(cantidad, l.insumo.precio, l.insumo.ivaPorcentaje)
}

export function totalActa(lineas: LineaActaForm[]): number {
  let total = 0
  for (const l of lineas) total += calculoLineaForm(l)?.total ?? 0
  return aCentavos(total)
}

export type LineaActaValida = { presupuestoItemId: string; itemApuId: string; cantidad: number }

// Las líneas totalmente vacías se ignoran; las demás tienen que estar
// completas. Sin repetir el mismo ítem con el mismo insumo.
export function validarActa(
  lineas: LineaActaForm[]
): { ok: true; lineas: LineaActaValida[] } | { ok: false; error: string } {
  const validas: LineaActaValida[] = []
  const vistas = new Set<string>()
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]
    const n = i + 1
    if (!l.item && !l.insumo && l.cantidad.trim() === "") continue
    if (!l.item) return { ok: false, error: `Línea ${n}: escoge el ítem.` }
    if (!l.insumo) return { ok: false, error: `Línea ${n}: escoge el insumo.` }
    if (l.insumo.precio == null) return { ok: false, error: `Línea ${n}: el insumo no tiene precio en el APU.` }
    const cantidad = leerNumero(l.cantidad)
    if (cantidad == null || cantidad <= 0) return { ok: false, error: `Línea ${n}: escribe una cantidad mayor que cero.` }
    const clave = `${l.item.id}|${l.insumo.itemApuId}`
    if (vistas.has(clave)) return { ok: false, error: `Línea ${n}: ese insumo de ese ítem ya está en el acta.` }
    vistas.add(clave)
    validas.push({ presupuestoItemId: l.item.id, itemApuId: l.insumo.itemApuId, cantidad })
  }
  if (validas.length === 0) return { ok: false, error: "Agrega al menos una línea al acta." }
  if (validas.length > MAX_LINEAS_ACTA) return { ok: false, error: `Un acta tiene como máximo ${MAX_LINEAS_ACTA} líneas.` }
  return { ok: true, lineas: validas }
}
