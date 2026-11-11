// Saldo a favor de proveedores y cierre de OC con faltante (Paquete C,
// entregas 2 y 3). Tipos y cálculos puros: la pantalla y las pruebas. La base
// vuelve a validar todo (_aplicar_saldo_favor_orden, cerrar_orden_con_faltante).

import { leerNumero } from "@/lib/contratos"

export type LineaCierre = {
  id: string
  insumoCodigo: number | null
  insumoDescripcion: string
  unidad: string | null
  pedido: number
  recibido: number
  valorFaltante: number
}

export type VistaCierreFaltante = {
  totalActual: number
  totalNuevo: number
  valorFaltante: number
  pagosReducidos: number
  saldoFavor: number
  motivoNo: string | null
  lineas: LineaCierre[]
  pagos: { tipo: string; estado: string; valor: number; menos: number; queda: number }[]
}

export type SaldoFavor = {
  id: string
  proveedorId: string
  proveedor: string
  empresa: string | null
  ordenOrigenId: string
  ordenOrigen: string
  valor: number
  disponible: number
  creadoAt: string
  creadoPor: string | null
  cerradoAt: string | null
  cerradoPor: string | null
  motivoCierre: string | null
  aplicaciones: { ordenId: string; orden: string; estado: string; valor: number; fecha: string }[]
}

export type SaldoProveedor = { id: string; disponible: number; ordenOrigen: string; creadoAt: string }

export const ETIQUETA_TIPO_PAGO_CIERRE: Record<string, string> = { unico: "Pago único", anticipo: "Anticipo", saldo: "Saldo" }

// Estado visible de un saldo.
export function estadoSaldo(s: Pick<SaldoFavor, "cerradoAt" | "disponible" | "valor">): "cerrado" | "usado" | "parcial" | "disponible" {
  if (s.cerradoAt) return "cerrado"
  if (s.disponible <= 0) return "usado"
  if (s.disponible < s.valor) return "parcial"
  return "disponible"
}

export const ETIQUETA_ESTADO_SALDO = { cerrado: "Cerrado", usado: "Usado", parcial: "Usado en parte", disponible: "Disponible" } as const

// Desglose al usar saldo a favor en una orden nueva.
export type DesgloseSaldo = { costo: number; aplicado: number; aPagar: number; restante: number }

// Lee y valida cuánto saldo se usa. `total` = total de la orden (se redondea al
// peso, como el pago); `disponible` = suma de los saldos del proveedor.
export function validarUsoSaldo(
  texto: string,
  total: number,
  disponible: number
): { ok: true; desglose: DesgloseSaldo } | { ok: false; error: string } {
  const costo = Math.round(total)
  const valor = leerNumero(texto)
  if (valor == null || valor <= 0) return { ok: false, error: "Escribe cuánto saldo a favor se usa." }
  const aplicado = Math.round(valor * 100) / 100
  if (aplicado > disponible) return { ok: false, error: "No hay tanto saldo a favor disponible." }
  if (aplicado > costo) return { ok: false, error: "No se puede usar más saldo a favor que el valor de la orden." }
  return { ok: true, desglose: { costo, aplicado, aPagar: costo - aplicado, restante: Math.round((disponible - aplicado) * 100) / 100 } }
}

// Lo que se propone usar: todo lo disponible, sin pasar del valor de la orden.
export const saldoSugerido = (total: number, disponible: number) => Math.min(Math.round(total), disponible)
