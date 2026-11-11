import { describe, expect, it } from "vitest"
import {
  formFacturaVacio,
  modoFacturacion,
  pendientePorLinea,
  referenciaSeleccion,
  resumenFacturacion,
  validarFactura,
  type FacturaOrden,
  type LineaParaFactura,
} from "@/lib/facturas-oc"

// Línea A: 10 und a $1.000 con IVA 19 % (total 11.900).
// Línea B: 4 cajas (presentación) que en la unidad del insumo son 8 m² a $500, sin IVA (total 4.000).
const lineas: LineaParaFactura[] = [
  { id: "a", cantidad: 10, precioUnitario: 1000, porcentajeDescuento: 0, porcentajeIva: 19, presentacion: null },
  { id: "b", cantidad: 8, precioUnitario: 500, porcentajeDescuento: 0, porcentajeIva: 0, presentacion: { cantidadCompra: 4 } },
]
const TOTAL = 15_900

const factura = (p: Partial<FacturaOrden>): FacturaOrden => ({
  id: "f",
  parcial: true,
  fecha: "2026-11-10",
  subtotal: 0,
  iva: 0,
  total: 0,
  observaciones: null,
  nombreArchivo: "f.pdf",
  subidaPorNombre: null,
  createdAt: "2026-11-10T10:00:00Z",
  anulada: false,
  motivoAnulacion: null,
  items: [],
  ...p,
})

const base = { parcial: true, hoy: "2026-11-11", lineas, facturas: [] as FacturaOrden[], totalOrden: TOTAL, conArchivo: true }

describe("facturas de la OC", () => {
  it("lo pendiente va en la unidad que muestra la orden y descuenta solo parciales vigentes", () => {
    const facturas = [
      factura({ id: "1", items: [{ lineaId: "a", cantidad: 3 }, { lineaId: "b", cantidad: 1 }] }),
      factura({ id: "2", anulada: true, items: [{ lineaId: "a", cantidad: 5 }] }),
    ]
    const p = pendientePorLinea(lineas, facturas)
    expect(p.get("a")).toBe(7)
    expect(p.get("b")).toBe(3)
  })

  it("la referencia es proporcional a las cantidades elegidas", () => {
    const r = referenciaSeleccion(lineas, new Map([["a", 5], ["b", 2]]))
    expect(r).toEqual({ subtotal: 7000, iva: 950, total: 7950 })
  })

  it("una total bloquea todo; las parciales solo admiten parciales", () => {
    expect(modoFacturacion([])).toBe("libre")
    expect(modoFacturacion([factura({ parcial: false })])).toBe("total_hecha")
    expect(modoFacturacion([factura({ parcial: false, anulada: true })])).toBe("libre")
    expect(modoFacturacion([factura({ parcial: true })])).toBe("parciales")
  })

  it("resumen: facturado y pendiente con facturas vigentes", () => {
    const r = resumenFacturacion(TOTAL, [factura({ total: 5000 }), factura({ total: 9000, anulada: true })])
    expect(r).toEqual({ facturado: 5000, pendiente: 10_900 })
  })

  it("valida una parcial bien escrita (formato colombiano) y calcula el total", () => {
    const r = validarFactura(
      { ...formFacturaVacio(), fecha: "2026-11-10", subtotal: "7.000", iva: "950,00", cantidades: { a: "5", b: "2" } },
      base
    )
    expect(r).toEqual({
      ok: true,
      datos: { fecha: "2026-11-10", subtotal: 7000, iva: 950, total: 7950, observaciones: null, items: [{ lineaId: "a", cantidad: 5 }, { lineaId: "b", cantidad: 2 }] },
    })
  })

  it("rechaza lo que la base también rechaza", () => {
    const ok = { ...formFacturaVacio(), fecha: "2026-11-10", subtotal: "1000", iva: "0", cantidades: { a: "1" } }
    const err = (f: Parameters<typeof validarFactura>[0], o: Partial<typeof base> = {}) => {
      const r = validarFactura(f, { ...base, ...o })
      return r.ok ? null : r.error
    }
    expect(err(ok, { conArchivo: false })).toMatch(/archivo/)
    expect(err({ ...ok, fecha: "" })).toMatch(/fecha/)
    expect(err({ ...ok, fecha: "2026-11-12" })).toMatch(/posterior a hoy/)
    expect(err({ ...ok, subtotal: "" })).toMatch(/subtotal/)
    expect(err({ ...ok, iva: "" })).toMatch(/IVA/)
    expect(err({ ...ok, subtotal: "0", iva: "0" })).toMatch(/mayor que cero/)
    expect(err({ ...ok, cantidades: {} })).toMatch(/Elige los insumos/)
    expect(err({ ...ok, cantidades: { a: "1,5" } })).toMatch(/enteros/)
    expect(err({ ...ok, cantidades: { b: "5" } })).toMatch(/más cantidad/)
    expect(err({ ...ok, subtotal: "16000" })).toMatch(/total de la orden/)
    expect(err(ok, { facturas: [factura({ parcial: false })] })).toMatch(/factura total/)
    expect(err(ok, { parcial: false, facturas: [factura({ parcial: true })] })).toMatch(/parciales/)
  })

  it("la total no pide insumos y acepta el total exacto de la orden", () => {
    const r = validarFactura({ ...formFacturaVacio(), fecha: "2026-11-10", subtotal: "14.000", iva: "1.900" }, { ...base, parcial: false })
    expect(r.ok && r.datos.total).toBe(15_900)
    expect(r.ok && r.datos.items).toEqual([])
  })
})
