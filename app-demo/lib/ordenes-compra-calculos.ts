export type LineaCalculable = {
  cantidad: number
  precioUnitario: number
  porcentajeDescuento: number
  porcentajeIva: number
}

export function calcularLinea(l: LineaCalculable) {
  const bruto = l.cantidad * l.precioUnitario
  const descuento = bruto * (l.porcentajeDescuento / 100)
  const subtotal = bruto - descuento
  const iva = subtotal * (l.porcentajeIva / 100)
  const total = subtotal + iva
  return { bruto, descuento, subtotal, iva, total }
}

export function calcularTotalesOrden(lineas: LineaCalculable[]) {
  return lineas.reduce(
    (acc, l) => {
      const c = calcularLinea(l)
      acc.descuento += c.descuento
      acc.iva += c.iva
      acc.total += c.total
      return acc
    },
    { descuento: 0, iva: 0, total: 0 }
  )
}