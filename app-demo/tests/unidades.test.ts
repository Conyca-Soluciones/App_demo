import { describe, expect, it } from "vitest"
import {
  compararUnidad,
  describirPresentacion,
  nombreUnidad,
  normalizarUnidad,
  sugerirPresentacion,
  unidadesDeCompra,
  validarPresentacion,
} from "@/lib/unidades"

describe("normalizarUnidad", () => {
  it("lee el formato del maestro 'NOMBRE - CÓDIGO'", () => {
    expect(normalizarUnidad("UNIDAD - UND")).toBe("UND")
    expect(normalizarUnidad("METRO LINEAL - ML")).toBe("M")
    expect(normalizarUnidad("METRO - M")).toBe("M")
    expect(normalizarUnidad("METRO CUADRADO - M2")).toBe("M2")
    expect(normalizarUnidad("KILOGRAMO - KG")).toBe("KG")
    expect(normalizarUnidad("ROLLO - ROLL")).toBe("ROLLO")
    expect(normalizarUnidad("BULTO - BE")).toBe("BULTO")
    expect(normalizarUnidad("CUÑETE - CÑT")).toBe("CUNETE")
    expect(normalizarUnidad("CUARTO DE GALON - QT")).toBe("QT")
  })

  it("lee lo que escriben en el Excel", () => {
    expect(normalizarUnidad("und")).toBe("UND")
    expect(normalizarUnidad("Un.")).toBe("UND")
    expect(normalizarUnidad("kg")).toBe("KG")
    expect(normalizarUnidad("Kgs")).toBe("KG")
    expect(normalizarUnidad("m")).toBe("M")
    expect(normalizarUnidad("ML")).toBe("M")
    expect(normalizarUnidad("mts")).toBe("M")
    expect(normalizarUnidad("m²")).toBe("M2")
    expect(normalizarUnidad("m³")).toBe("M3")
    expect(normalizarUnidad("HR")).toBe("HORA")
    expect(normalizarUnidad("gal")).toBe("GAL")
    expect(normalizarUnidad("gl")).toBe("GLOBAL")
  })

  it("vacío o 'null' es null; lo desconocido vuelve limpio", () => {
    expect(normalizarUnidad(null)).toBeNull()
    expect(normalizarUnidad("")).toBeNull()
    expect(normalizarUnidad("null - ")).toBeNull()
    expect(normalizarUnidad("Tkm - Tkm")).toBe("TKM")
    expect(normalizarUnidad("tkm")).toBe("TKM")
  })

  it("nombreUnidad da un nombre corto", () => {
    expect(nombreUnidad("BULTO - BE")).toBe("bulto")
    expect(nombreUnidad("m3")).toBe("m³")
    expect(nombreUnidad(null)).toBe("")
  })
})

describe("compararUnidad", () => {
  const cemento = { u_m: "UNIDAD - UND", unidad_uso: "KG", contenido: 50 }
  const tela = { u_m: "ROLLO - ROLL", unidad_uso: "M", contenido: 100 }
  const sinPresentacion = { u_m: "UNIDAD - UND", unidad_uso: null, contenido: null }

  it("misma unidad: factor 1", () => {
    expect(compararUnidad("und", cemento)).toEqual({ estado: "igual", factor: 1 })
    expect(compararUnidad("ROLLO", tela)).toEqual({ estado: "igual", factor: 1 })
  })

  it("unidad de uso: el precio se divide por el contenido", () => {
    expect(compararUnidad("kg", cemento)).toEqual({ estado: "conversion", factor: 50 })
    expect(compararUnidad("ML", tela)).toEqual({ estado: "conversion", factor: 100 })
  })

  it("no cuadra: sin factor", () => {
    expect(compararUnidad("kg", sinPresentacion)).toEqual({ estado: "distinta", factor: null })
    expect(compararUnidad("m2", tela)).toEqual({ estado: "distinta", factor: null })
  })

  it("línea sin unidad: se asume la del insumo", () => {
    expect(compararUnidad("", cemento)).toEqual({ estado: "sin_dato", factor: 1 })
  })

  it("describe la presentación", () => {
    expect(describirPresentacion(cemento)).toBe("unidad de 50 kg")
    expect(describirPresentacion({ u_m: "BULTO - BE", unidad_uso: "KG", contenido: 42.5 })).toBe("bulto de 42,5 kg")
    expect(describirPresentacion(sinPresentacion)).toBeNull()
  })
})

describe("sugerirPresentacion", () => {
  it("lee el contenido del nombre", () => {
    expect(sugerirPresentacion("CEMENTO X 50 KG", "UNIDAD - UND")).toEqual({ unidadUso: "KG", contenido: 50 })
    expect(sugerirPresentacion("CEMENTO X 42.5 KG", "UNIDAD - UND")).toEqual({ unidadUso: "KG", contenido: 42.5 })
    expect(sugerirPresentacion("SIKA ANTISOL BLANCO X20KG", "UNIDAD - UND")).toEqual({ unidadUso: "KG", contenido: 20 })
    expect(sugerirPresentacion("CINTA DE PELIGRO X 500 METROS", "UNIDAD - UND")).toEqual({ unidadUso: "M", contenido: 500 })
    expect(sugerirPresentacion('ALAMBRE #12 X100 MTS DE COBRE AISLADO THHN NEGRO', "UNIDAD - UND")).toEqual({
      unidadUso: "M",
      contenido: 100,
    })
    expect(sugerirPresentacion('TUBERIA SANITARIA 2" X 6MTS', "UNIDAD - UND")).toEqual({ unidadUso: "M", contenido: 6 })
    expect(sugerirPresentacion("TUBO PARA CORTINA X 6 ML", "UNIDAD - UND")).toEqual({ unidadUso: "M", contenido: 6 })
    expect(sugerirPresentacion("CRUCETA PLASTICA JUNTAS 2MM X 300UND", "UNIDAD - UND")).toBeNull() // misma unidad
  })

  it("no confunde medidas con contenido", () => {
    expect(sugerirPresentacion("TEJA ARQUITECTONICA PREPINTADA CALIBRE 30, ESPESOR E=0,3 MM 1X4,60 MTS", "UNIDAD - UND")).toBeNull()
    expect(sugerirPresentacion("MALLA ELECTROSOLDADA 15X15 2.35X6MTS 6.5MM", "UNIDAD - UND")).toBeNull()
    expect(sugerirPresentacion("TUBO HIERRO 100X100 2MM X6MT", "UNIDAD - UND")).toEqual({ unidadUso: "M", contenido: 6 })
  })

  it("mililitros y casos sin sentido no se sugieren", () => {
    expect(sugerirPresentacion("SILICONA X 300ML TRANSPARENTE", "UNIDAD - UND")).toBeNull()
    expect(sugerirPresentacion("CEMENTO GRIS", "UNIDAD - UND")).toBeNull()
    expect(sugerirPresentacion("ALAMBRE #12 X100 MTS", "METRO - M")).toBeNull() // ya está en metros
  })
})

describe("unidadesDeCompra", () => {
  it("redondea hacia arriba", () => {
    expect(unidadesDeCompra(120, 50)).toBe(3)
    expect(unidadesDeCompra(150, 50)).toBe(3)
    expect(unidadesDeCompra(150.0000001, 50)).toBe(3)
    expect(unidadesDeCompra(151, 50)).toBe(4)
    expect(unidadesDeCompra(0.3, 0.1)).toBe(3)
  })
})

describe("validarPresentacion", () => {
  it("los dos datos o ninguno", () => {
    expect(validarPresentacion(null, null)).toBeNull()
    expect(validarPresentacion("", "")).toBeNull()
    expect(validarPresentacion("kg", 50)).toEqual({ unidadUso: "KG", contenido: 50 })
    expect(validarPresentacion("Metros", "2,5")).toEqual({ unidadUso: "M", contenido: 2.5 })
    expect(() => validarPresentacion("kg", null)).toThrow()
    expect(() => validarPresentacion(null, 50)).toThrow()
    expect(() => validarPresentacion("kg", 0)).toThrow()
    expect(() => validarPresentacion("kg", "abc")).toThrow()
  })
})
