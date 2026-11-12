import { describe, expect, it } from "vitest"
import { metodoDePago, pagoSinCuenta, puedeIrALiquidacion } from "@/lib/pagos"
import { extensionArchivo, revisarArchivoTercero } from "@/lib/archivos-tercero"

describe("un pago pasa a liquidación con cuenta bancaria", () => {
  it("con cuenta sí, sin cuenta no", () => {
    expect(puedeIrALiquidacion({ metodoPago: "transferencia", cuentaId: "c1" })).toBe(true)
    expect(puedeIrALiquidacion({ metodoPago: "transferencia", cuentaId: null })).toBe(false)
  })
  it("PSE no lleva cuenta y sí pasa", () => {
    expect(puedeIrALiquidacion({ metodoPago: "pse", cuentaId: null })).toBe(true)
  })
})

describe("archivos del tercero (RUT, certificación, comprobante)", () => {
  it("PDF, JPG o PNG de hasta 10 MB", () => {
    expect(revisarArchivoTercero({ type: "application/pdf", size: 1000 }, "El RUT")).toBeNull()
    expect(revisarArchivoTercero({ type: "image/png", size: 10 * 1024 * 1024 }, "El RUT")).toBeNull()
    expect(revisarArchivoTercero({ type: "application/msword", size: 1000 }, "El RUT")).toBe("El RUT debe ser PDF, JPG o PNG.")
    expect(revisarArchivoTercero({ type: "image/jpeg", size: 10 * 1024 * 1024 + 1 }, "El RUT")).toBe("El RUT pesa más de 10 MB.")
  })
  it("extensión según el tipo", () => {
    expect(extensionArchivo({ type: "application/pdf" })).toBe("pdf")
    expect(extensionArchivo({ type: "image/png" })).toBe("png")
    expect(extensionArchivo({ type: "image/jpeg" })).toBe("jpg")
  })
})

describe("Consolidado: método de pago y fila sin cuenta", () => {
  it("PSE, tipo de pago de la OC o Transferencia", () => {
    expect(metodoDePago({ metodoPago: "pse", ordenTipoPago: "credito" })).toBe("PSE")
    expect(metodoDePago({ metodoPago: "transferencia", ordenTipoPago: "contado" })).toBe("De contado")
    expect(metodoDePago({ metodoPago: "transferencia", ordenTipoPago: "credito" })).toBe("Crédito")
    expect(metodoDePago({ metodoPago: "transferencia", ordenTipoPago: "fiducia" })).toBe("Fiducia")
    expect(metodoDePago({ metodoPago: "transferencia", ordenTipoPago: null })).toBe("Transferencia")
  })
  it("en rojo: aprobado, sin cuenta y no PSE", () => {
    expect(pagoSinCuenta({ estado: "aprobado", metodoPago: "transferencia", cuentaId: null })).toBe(true)
    expect(pagoSinCuenta({ estado: "aprobado", metodoPago: "pse", cuentaId: null })).toBe(false)
    expect(pagoSinCuenta({ estado: "aprobado", metodoPago: "transferencia", cuentaId: "c1" })).toBe(false)
    expect(pagoSinCuenta({ estado: "anulado", metodoPago: "transferencia", cuentaId: null })).toBe(false)
  })
})
