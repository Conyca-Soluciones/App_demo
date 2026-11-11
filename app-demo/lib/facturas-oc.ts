// Facturas de la orden de compra (Paquete C, entrega 1;
// 20261231999100_facturas_orden_compra.sql). Lógica pura: la usan la pantalla
// y las pruebas. La base vuelve a validar todo (registrar_factura_orden).
//
// Una OC lleva UNA factura total o varias PARCIALES, cada una con los insumos
// y cantidades de la orden que incluye. Las cantidades van en la unidad que
// muestra la orden: la presentación (cajas) si la línea la tiene.

import { leerNumero } from "@/lib/contratos"
import { leerCantidadEntera } from "@/lib/numeros"
import { calcularLinea } from "@/lib/ordenes-compra-calculos"

export type LineaParaFactura = {
  id: string
  cantidad: number
  precioUnitario: number
  porcentajeDescuento: number
  porcentajeIva: number
  presentacion: { cantidadCompra: number } | null
}

export type FacturaOrden = {
  id: string
  parcial: boolean
  fecha: string
  subtotal: number
  iva: number
  total: number
  observaciones: string | null
  nombreArchivo: string
  subidaPorNombre: string | null
  createdAt: string
  anulada: boolean
  motivoAnulacion: string | null
  // Solo las parciales: línea de la OC -> cantidad facturada.
  items: { lineaId: string; cantidad: number }[]
}

// Cantidad de la línea en la unidad que muestra la orden.
export const cantidadMostrada = (l: LineaParaFactura) => l.presentacion?.cantidadCompra ?? l.cantidad

const redondear2 = (n: number) => Math.round(n * 100) / 100

// Lo que lleva facturado cada línea en las parciales vigentes.
export function facturadoPorLinea(facturas: FacturaOrden[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const f of facturas) {
    if (f.anulada || !f.parcial) continue
    for (const it of f.items) m.set(it.lineaId, (m.get(it.lineaId) ?? 0) + it.cantidad)
  }
  return m
}

// Cuánto falta por facturar de cada línea (nunca negativo).
export function pendientePorLinea(lineas: LineaParaFactura[], facturas: FacturaOrden[]): Map<string, number> {
  const hechas = facturadoPorLinea(facturas)
  return new Map(lineas.map((l) => [l.id, Math.max(cantidadMostrada(l) - (hechas.get(l.id) ?? 0), 0)]))
}

// Valor de referencia de los insumos elegidos, con los precios de la OC
// (proporcional a la cantidad de cada línea). Solo para avisar si no cuadra.
export function referenciaSeleccion(
  lineas: LineaParaFactura[],
  cantidades: Map<string, number>
): { subtotal: number; iva: number; total: number } {
  let subtotal = 0
  let iva = 0
  for (const l of lineas) {
    const c = cantidades.get(l.id) ?? 0
    const base = cantidadMostrada(l)
    if (c <= 0 || base <= 0) continue
    const v = calcularLinea(l)
    subtotal += (v.subtotal * c) / base
    iva += (v.iva * c) / base
  }
  return { subtotal: redondear2(subtotal), iva: redondear2(iva), total: redondear2(subtotal + iva) }
}

// Total de la orden y lo ya facturado (facturas vigentes).
export function resumenFacturacion(totalOrden: number, facturas: FacturaOrden[]) {
  const facturado = redondear2(facturas.filter((f) => !f.anulada).reduce((a, f) => a + f.total, 0))
  return { facturado, pendiente: redondear2(Math.max(Math.round(totalOrden) - facturado, 0)) }
}

// Qué se puede registrar ahora: nada, solo la total, solo parciales o
// cualquiera de las dos (si todavía no hay ninguna).
export function modoFacturacion(facturas: FacturaOrden[]): "libre" | "total_hecha" | "parciales" {
  const vigentes = facturas.filter((f) => !f.anulada)
  if (vigentes.some((f) => !f.parcial)) return "total_hecha"
  if (vigentes.some((f) => f.parcial)) return "parciales"
  return "libre"
}

export type FormFactura = {
  fecha: string
  subtotal: string
  iva: string
  observaciones: string
  // Línea -> cantidad escrita (texto). Solo en parciales.
  cantidades: Record<string, string>
}

export const formFacturaVacio = (): FormFactura => ({ fecha: "", subtotal: "", iva: "", observaciones: "", cantidades: {} })

export type FacturaValidada = {
  fecha: string
  subtotal: number
  iva: number
  total: number
  observaciones: string | null
  items: { lineaId: string; cantidad: number }[]
}

// Valida el formulario (lo mismo que revisa la base). `hoy` = AAAA-MM-DD de Colombia.
export function validarFactura(
  form: FormFactura,
  opciones: {
    parcial: boolean
    hoy: string
    lineas: LineaParaFactura[]
    facturas: FacturaOrden[]
    totalOrden: number
    conArchivo: boolean
  }
): { ok: true; datos: FacturaValidada } | { ok: false; error: string } {
  if (!opciones.conArchivo) return { ok: false, error: "Adjunta el archivo de la factura." }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.fecha)) return { ok: false, error: "Escribe la fecha de la factura." }
  if (form.fecha > opciones.hoy) return { ok: false, error: "La fecha de la factura no puede ser posterior a hoy." }
  const subtotal = leerNumero(form.subtotal)
  if (subtotal == null) return { ok: false, error: "Escribe el subtotal de la factura." }
  const iva = leerNumero(form.iva)
  if (iva == null) return { ok: false, error: "Escribe el IVA de la factura (0 si no tiene)." }
  const total = redondear2(subtotal + iva)
  if (total <= 0) return { ok: false, error: "El total de la factura debe ser mayor que cero." }

  const modo = modoFacturacion(opciones.facturas)
  if (modo === "total_hecha") return { ok: false, error: "Esta orden ya tiene su factura total. Anúlala si hay que cambiarla." }
  if (modo === "parciales" && !opciones.parcial) return { ok: false, error: "Esta orden tiene facturas parciales: agrega otra factura parcial." }

  const { facturado } = resumenFacturacion(opciones.totalOrden, opciones.facturas)
  if (facturado + total > Math.round(opciones.totalOrden) + 1) {
    return { ok: false, error: "Con esta factura se pasaría del total de la orden. Revisa los valores." }
  }

  const items: { lineaId: string; cantidad: number }[] = []
  if (opciones.parcial) {
    const pendientes = pendientePorLinea(opciones.lineas, opciones.facturas)
    for (const l of opciones.lineas) {
      const texto = (form.cantidades[l.id] ?? "").trim()
      if (!texto) continue
      const leida = leerCantidadEntera(texto)
      if (!leida.ok || leida.valor <= 0) return { ok: false, error: "Las cantidades facturadas deben ser números enteros mayores que cero." }
      if (leida.valor > (pendientes.get(l.id) ?? 0)) return { ok: false, error: "Hay un insumo con más cantidad facturada que la que falta por facturar." }
      items.push({ lineaId: l.id, cantidad: leida.valor })
    }
    if (items.length === 0) return { ok: false, error: "Elige los insumos que incluye esta factura parcial." }
  }

  return {
    ok: true,
    datos: {
      fecha: form.fecha,
      subtotal: redondear2(subtotal),
      iva: redondear2(iva),
      total,
      observaciones: form.observaciones.trim() || null,
      items,
    },
  }
}
