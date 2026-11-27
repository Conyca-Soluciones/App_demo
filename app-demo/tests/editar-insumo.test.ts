import { describe, expect, it } from "vitest"
import {
  cambiosInsumo,
  formularioDesdeInsumo,
  normalizarNombreInsumo,
  validarEdicionInsumo,
  vrNetoInsumo,
  type CamposInsumo,
  type FormularioInsumo,
} from "@/lib/editar-insumo"

const insumo: CamposInsumo = {
  descripcion: "CEMENTO GRIS X 50 KG",
  tipo: "MATERIAL - M",
  u_m: "BULTO - BE",
  agrupacion: "010 - 010 - CEMENTOS",
  vr_unitario: 30000,
  iva_porcentaje: 19,
  excluye_iva: null,
  iva_descontable: true,
}

const formulario = (cambios: Partial<FormularioInsumo> = {}): FormularioInsumo => ({
  ...formularioDesdeInsumo(insumo),
  ...cambios,
})

describe("formularioDesdeInsumo", () => {
  it("llena el formulario con lo que tiene el insumo", () => {
    expect(formularioDesdeInsumo(insumo)).toEqual({
      descripcion: "CEMENTO GRIS X 50 KG",
      tipo: "MATERIAL - M",
      uM: "BULTO - BE",
      agrupacion: "010 - 010 - CEMENTOS",
      vrUnitario: "30000",
      ivaPorcentaje: "19",
      excluyeIva: false,
      ivaDescontable: true,
    })
  })

  it("decimales con coma y unidad al texto estándar", () => {
    const f = formularioDesdeInsumo({ ...insumo, vr_unitario: 1234.5, u_m: "m3", iva_porcentaje: null })
    expect(f.vrUnitario).toBe("1234,5")
    expect(f.uM).toBe("METRO CUBICO - M3")
    expect(f.ivaPorcentaje).toBe("19")
  })
})

describe("validarEdicionInsumo", () => {
  it("acepta el insumo tal cual", () => {
    const r = validarEdicionInsumo(formulario())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valores).toEqual({ ...insumo, excluye_iva: false })
  })

  it("normaliza nombre, unidad y precio colombiano", () => {
    const r = validarEdicionInsumo(formulario({ descripcion: "  cemento   blanco ", uM: "kg", vrUnitario: "1.250,50" }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valores.descripcion).toBe("CEMENTO BLANCO")
      expect(r.valores.u_m).toBe("KILOGRAMO - KG")
      expect(r.valores.vr_unitario).toBe(1250.5)
    }
  })

  it("acepta una fórmula en el precio", () => {
    const r = validarEdicionInsumo(formulario({ vrUnitario: "=35.700/1,19" }))
    expect(r.ok && r.valores.vr_unitario).toBe(30000)
  })

  it("rechaza lo que no es estándar", () => {
    const r = validarEdicionInsumo(
      formulario({ descripcion: " ", tipo: "INSUMO", uM: "caja", agrupacion: "", vrUnitario: "1", ivaPorcentaje: "10" })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(Object.keys(r.errores).sort()).toEqual(
        ["agrupacion", "descripcion", "ivaPorcentaje", "tipo", "uM", "vrUnitario"].sort()
      )
    }
  })

  it("precio vacío o que no se entiende", () => {
    expect(validarEdicionInsumo(formulario({ vrUnitario: "" })).ok).toBe(false)
    expect(validarEdicionInsumo(formulario({ vrUnitario: "abc" })).ok).toBe(false)
  })

  it("la agrupación tiene que estar en la lista si se pasa", () => {
    const lista = new Set(["010 - 010 - CEMENTOS"])
    expect(validarEdicionInsumo(formulario(), lista).ok).toBe(true)
    expect(validarEdicionInsumo(formulario({ agrupacion: "OTRA" }), lista).ok).toBe(false)
  })
})

describe("vrNetoInsumo", () => {
  it("igual que el disparador de la base", () => {
    expect(vrNetoInsumo(30000, 19, false)).toBe(35700)
    expect(vrNetoInsumo(100.33, 5, null)).toBe(105.35)
    expect(vrNetoInsumo(30000, 19, true)).toBe(30000)
    expect(vrNetoInsumo(30000, 0, false)).toBe(30000)
    expect(vrNetoInsumo(null, 19, false)).toBeNull()
  })
})

describe("cambiosInsumo", () => {
  it("sin cambios: null y false en las casillas son lo mismo", () => {
    expect(cambiosInsumo(insumo, { ...insumo, excluye_iva: false })).toEqual({})
  })

  it("solo lo que cambió", () => {
    expect(cambiosInsumo(insumo, { ...insumo, vr_unitario: 31000, tipo: "CONSUMIBLES - C" })).toEqual({
      vr_unitario: 31000,
      tipo: "CONSUMIBLES - C",
    })
  })

  it("el precio que llega como texto de la base cuenta como el mismo número", () => {
    const desdeBase = { ...insumo, vr_unitario: "30000.00" as unknown as number }
    expect(cambiosInsumo(desdeBase, insumo)).toEqual({})
  })
})

describe("normalizarNombreInsumo", () => {
  it("mayúsculas y un solo espacio", () => {
    expect(normalizarNombreInsumo("  tela  verde rollo x 100 m ")).toBe("TELA VERDE ROLLO X 100 M")
  })
})
