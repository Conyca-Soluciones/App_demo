import { describe, expect, it } from "vitest"
import { esCampoDeTercero, validarCampo } from "@/lib/proveedores"

describe("Proveedor enlazado al tercero", () => {
  it("nombre, número y DV salen del tercero: no se editan", () => {
    for (const campo of ["nombre", "numeroDocumento", "digitoVerificacion"] as const) {
      expect(esCampoDeTercero(campo)).toBe(true)
      const r = validarCampo(campo, "algo")
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/Terceros/)
    }
  })
  it("el resto se sigue editando (tipo NIT/CC para la OC, contacto)", () => {
    expect(validarCampo("tipoDocumento", "nit")).toEqual({ ok: true, valor: "NIT" })
    expect(validarCampo("correo", " Ventas@Prov.co ")).toEqual({ ok: true, valor: "ventas@prov.co" })
    expect(esCampoDeTercero("telefono")).toBe(false)
  })
})
