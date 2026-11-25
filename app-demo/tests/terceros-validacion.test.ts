import { describe, expect, it } from "vitest"
import { partirNombre, razonSocialPersona, validarContacto, validarTercero, type DatosTercero } from "@/lib/terceros"

// Nombre en 4 casillas y contacto obligatorio (20270101004300).
const base: DatosTercero = {
  tipoDocumento: "CC",
  numeroDocumento: "1.020.304",
  dv: "",
  razonSocial: "",
  primerNombre: "kevin",
  segundoNombre: "santiago",
  primerApellido: "moncayo",
  segundoApellido: "tejada",
  correo: "Kevin@Correo.com ",
  telefono: "300 123 4567",
  direccion: "Calle 26 # 69-76",
  ciudad: "bogotá",
  observaciones: "",
}

describe("validarTercero", () => {
  it("arma la razón social de una persona con nombres y apellidos", () => {
    const r = validarTercero(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.datos.razonSocial).toBe("KEVIN SANTIAGO MONCAYO TEJADA")
    expect(r.datos.primerNombre).toBe("KEVIN")
    expect(r.datos.contacto).toEqual({ correo: "kevin@correo.com", telefono: "3001234567", direccion: "Calle 26 # 69-76", ciudad: "BOGOTÁ" })
  })

  it("exige primer nombre y primer apellido, no los segundos", () => {
    const r = validarTercero({ ...base, primerNombre: "", primerApellido: " ", segundoNombre: "", segundoApellido: "" })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errores.primerNombre).toBeTruthy()
    expect(r.errores.primerApellido).toBeTruthy()
    expect(r.errores.segundoNombre).toBeUndefined()
  })

  it("en un NIT usa la razón social y no las casillas", () => {
    const r = validarTercero({ ...base, tipoDocumento: "NIT", numeroDocumento: "901097443", dv: "4", razonSocial: "conyca sas" })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.datos.razonSocial).toBe("CONYCA SAS")
    expect(r.datos.primerNombre).toBeNull()
  })

  it("pide el contacto completo al crear", () => {
    const r = validarTercero({ ...base, correo: "sin-arroba", telefono: "12", direccion: "", ciudad: "" })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(Object.keys(r.errores).sort()).toEqual(["ciudad", "correo", "direccion", "telefono"])
  })
})

describe("ayudas del nombre y del contacto", () => {
  it("razón social sin segundos nombres", () => {
    expect(razonSocialPersona({ primerNombre: "ana", segundoNombre: "", primerApellido: "pérez", segundoApellido: "" })).toBe("ANA PÉREZ")
  })
  it("parte nombres viejos en primera palabra y resto", () => {
    expect(partirNombre("MARTINEZ DE LA OSAA")).toEqual(["MARTINEZ", "DE LA OSAA"])
    expect(partirNombre(null)).toEqual(["", ""])
  })
  it("valida el teléfono con o sin +57", () => {
    expect(validarContacto({ correo: "a@b.co", telefono: "+57 300-123-4567", direccion: "x", ciudad: "y" }).ok).toBe(true)
  })
})
