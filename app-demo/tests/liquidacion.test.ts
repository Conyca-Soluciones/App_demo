import { describe, expect, it } from "vitest"
import {
  datosLiquidacion,
  sinCambios,
  sugerirLiquidacion,
  totalesLiquidacion,
  valorLinea,
  type ContextoPago,
  type LineaLiquidacion,
} from "@/lib/liquidacion"
import { catalogoDeLaMigracion } from "./liquidacion-catalogo"

const cat = catalogoDeLaMigracion()

const CARTAGENA = {
  id: "ctg",
  nombre: "CARTAGENA",
  baseCompras: 367000,
  baseServicios: 367000,
  baseProfesionales: 6808620,
  tarifas: { compras: 0.00749, construccion: 0.00856, transporte: 0.00856 },
}

function ctx(p: Partial<ContextoPago> = {}): ContextoPago {
  return {
    tipo: "unico",
    anio: 2026,
    valor: 1280000,
    valorDocumento: 1280000,
    baseGravable: 1090000,
    iva: 190000,
    tercero: { documento: "900030373", tipoDocumento: "NIT", razonSocial: "INVERSORA FURATENA SAS" },
    perfil: {
      tipoPersona: "juridica",
      declarante: true,
      responsableIva: true,
      regimenSimple: false,
      autorretenedor: false,
      granContribuyente: false,
      zomac: false,
      ciiuPrincipal: null,
      municipioRut: "Cartagena de Indias",
      fechaRut: null,
      estado: "VERIFICADO",
      alerta: null,
    },
    empresa: { agenteRetefuente: true, agenteReteiva: true, confirmado: true },
    empresaIca: true,
    municipio: CARTAGENA,
    preferencias: [],
    origen: { fuente: "orden_compra", categorias: { M: 1090000 } },
    retefuenteAnticipos: 0,
    ...p,
  }
}

const tipos = (ls: LineaLiquidacion[]) => ls.map((l) => `${l.tipo}:${l.concepto ?? l.actividad ?? ""}:${l.tarifa}:${l.valor}`)

describe("sugerirLiquidacion", () => {
  it("OC de materiales a persona jurídica: compras 2,5 % + ICA de compras del municipio", () => {
    const s = sugerirLiquidacion(ctx(), cat)
    expect(tipos(s.lineas)).toEqual(["retefuente:compras:0.025:27250", "reteica:compras:0.00749:8164"])
    expect(totalesLiquidacion(1280000, s.lineas).neto).toBe(1280000 - 27250 - 8164)
  })

  it("no declarante: 3,5 %; ZOMAC: la mitad", () => {
    const natural = ctx({
      perfil: { ...ctx().perfil!, tipoPersona: "natural", declarante: false },
      tercero: { documento: "1", tipoDocumento: "CC", razonSocial: "X" },
    })
    expect(sugerirLiquidacion(natural, cat).lineas[0].tarifa).toBe(0.035)
    const zomac = ctx({ perfil: { ...ctx().perfil!, zomac: true } })
    expect(sugerirLiquidacion(zomac, cat).lineas[0].tarifa).toBe(0.0125)
  })

  it("régimen simple: sin retefuente ni ICA, ReteIVA 15 % del IVA", () => {
    const s = sugerirLiquidacion(ctx({ perfil: { ...ctx().perfil!, regimenSimple: true } }), cat)
    expect(tipos(s.lineas)).toEqual(["reteiva::0.15:28500"])
  })

  it("autorretenedor y gran contribuyente: nada", () => {
    const s = sugerirLiquidacion(ctx({ perfil: { ...ctx().perfil!, autorretenedor: true, granContribuyente: true } }), cat)
    expect(s.lineas).toEqual([])
  })

  it("tercero de otro municipio: sin ReteICA, salvo que Contabilidad ya se la haya practicado", () => {
    const fuera = ctx({ perfil: { ...ctx().perfil!, municipioRut: "Barranquilla" } })
    expect(sugerirLiquidacion(fuera, cat).lineas.map((l) => l.tipo)).toEqual(["retefuente"])
    const conMemoria = {
      ...fuera,
      preferencias: [{ tipo: "reteica" as const, municipioId: "ctg", concepto: null, actividad: "compras", tarifa: 0.00749, veces: 2, origen: "contabilidad" as const }],
    }
    expect(sugerirLiquidacion(conMemoria, cat).lineas.map((l) => l.tipo)).toEqual(["retefuente", "reteica"])
  })

  it("anticipo: sin retenciones", () => {
    expect(sugerirLiquidacion(ctx({ tipo: "anticipo" }), cat).lineas).toEqual([])
  })

  it("por debajo de la base mínima (compras 10 UVT) no hay retefuente", () => {
    const s = sugerirLiquidacion(ctx({ baseGravable: 500000, iva: 0, valor: 500000, valorDocumento: 500000 }), cat)
    expect(s.lineas.map((l) => l.tipo)).toEqual(["reteica"])
  })

  it("la empresa no retiene y no practica ICA en el municipio", () => {
    const s = sugerirLiquidacion(ctx({ empresa: { agenteRetefuente: false, agenteReteiva: true, confirmado: false }, empresaIca: false }), cat)
    expect(s.lineas).toEqual([])
    expect(s.avisos.some((a) => a.texto.includes("inferido"))).toBe(true)
  })

  it("la memoria del tercero manda: concepto y tarifa de Contabilidad", () => {
    const s = sugerirLiquidacion(
      ctx({
        preferencias: [
          { tipo: "retefuente", municipioId: null, concepto: "construccion", actividad: null, tarifa: 0.02, veces: 3, origen: "contabilidad" },
          { tipo: "reteica", municipioId: "ctg", concepto: null, actividad: "construccion", tarifa: 0.00856, veces: 3, origen: "contabilidad" },
        ],
      }),
      cat
    )
    expect(tipos(s.lineas)).toEqual(["retefuente:construccion:0.02:21800", "reteica:construccion:0.00856:9330"])
    expect(s.lineas[0].regla).toContain("3 veces")
  })

  it("memoria con tarifa 0: a este tercero no se le practica", () => {
    const s = sugerirLiquidacion(
      ctx({ preferencias: [{ tipo: "retefuente", municipioId: null, concepto: null, actividad: null, tarifa: 0, veces: 1, origen: "contabilidad" }] }),
      cat
    )
    expect(s.lineas.map((l) => l.tipo)).toEqual(["reteica"])
  })

  it("honorarios de persona natural: tabla del 383 (nada por debajo de 95 UVT)", () => {
    const s = sugerirLiquidacion(
      ctx({
        origen: { fuente: "acta", contratoTipo: "prestacion_servicios", contratoClase: "grupo" },
        perfil: { ...ctx().perfil!, tipoPersona: "natural", declarante: false },
        tercero: { documento: "1", tipoDocumento: "CC", razonSocial: "X" },
        iva: 0,
        baseGravable: 3000000,
      }),
      cat
    )
    expect(s.lineas.filter((l) => l.tipo === "retefuente")).toEqual([])
  })

  it("acta de obra: construcción 2 %", () => {
    const s = sugerirLiquidacion(ctx({ origen: { fuente: "acta", contratoTipo: "obra", contratoClase: "grupo" }, iva: 0 }), cat)
    expect(s.lineas[0].concepto).toBe("construccion")
    expect(s.lineas[0].tarifa).toBe(0.02)
  })

  it("sin perfil: avisa y supone por el tipo de documento", () => {
    const s = sugerirLiquidacion(ctx({ perfil: null }), cat)
    expect(s.avisos[0].nivel).toBe("revisar")
    expect(s.lineas[0].tarifa).toBe(0.025)
  })
})

describe("valores y guardado", () => {
  it("valorLinea redondea al peso como la base", () => {
    expect(valorLinea({ tipo: "reteica", base: 1090000, tarifa: 0.00749, valor: 0 })).toBe(8164)
    expect(valorLinea({ tipo: "descuento", base: null, tarifa: null, valor: 50000.4 })).toBe(50000)
  })

  it("asumidas no bajan el neto; descuentos sí", () => {
    const s = sugerirLiquidacion(ctx(), cat)
    const lineas = [
      { ...s.lineas[0], asumida: true },
      s.lineas[1],
      { ...s.lineas[1], tipo: "descuento" as const, base: null, tarifa: null, valor: 50000, descripcion: "Préstamo" },
    ]
    const t = totalesLiquidacion(1280000, lineas)
    expect(t.asumidas).toBe(27250)
    expect(t.neto).toBe(1280000 - 8164 - 50000)
  })

  it("sinCambios y datosLiquidacion", () => {
    const s = sugerirLiquidacion(ctx(), cat)
    expect(sinCambios(s.lineas, [...s.lineas].reverse())).toBe(true)
    expect(sinCambios(s.lineas, [{ ...s.lineas[0], tarifa: 0.035 }, s.lineas[1]])).toBe(false)
    const d = datosLiquidacion(s.lineas, s, " FE-1 ", "")
    expect(d.numero_factura).toBe("FE-1")
    expect(d.sin_cambios).toBe(true)
    expect(d.lineas[0]).toMatchObject({ tipo: "retefuente", concepto: "compras", base: 1090000, tarifa: 0.025, valor: 27250 })
  })
})

describe("concepto escrito (requisiciones administrativas)", () => {
  it("clasifica el texto como la prueba contra el cuadro", async () => {
    const { conceptoDesdeTexto } = await import("@/lib/liquidacion")
    expect(conceptoDesdeTexto("PAGO DE NOMINA PRIMERA QUINCENA OCTUBRE 2026")).toBeNull()
    expect(conceptoDesdeTexto("RT FT SEP")).toBeNull()
    expect(conceptoDesdeTexto("POLIZA RC SEGÚN OTROSI No.2")).toBeNull()
    expect(conceptoDesdeTexto("SERVICIO DE ENERGIA ESTUARIOS")).toBeNull()
    expect(conceptoDesdeTexto("CUENTA DE COBRO MANO DE OBRA")).toBe("construccion")
    expect(conceptoDesdeTexto("ALQUILER DE EQUIPOS")).toBe("arrendamiento_muebles")
    expect(conceptoDesdeTexto("FLETE MATERIAL")).toBe("transporte_carga")
    expect(conceptoDesdeTexto("LAMPARA")).toBe("compras")
    expect(conceptoDesdeTexto(null)).toBe("compras")
  })
})

describe("base e IVA cuando el pago no trae el desglose", () => {
  const sinDesglose = (p: Partial<ContextoPago> = {}) =>
    ctx({
      valor: 1190000,
      valorDocumento: 1190000,
      baseGravable: 1190000,
      iva: 0,
      ivaConocido: false,
      origen: { fuente: "texto", concepto: "compras" },
      ...p,
    })

  it("responsable de IVA y concepto gravado: estima el 19 % incluido y retiene sobre la base", () => {
    const s = sugerirLiquidacion(sinDesglose(), cat)
    expect(s.desglose).toEqual({ base: 1000000, iva: 190000, estimado: true })
    expect(s.lineas.find((l) => l.tipo === "retefuente")?.base).toBe(1000000)
    expect(s.lineas.find((l) => l.tipo === "reteica")?.base).toBe(1000000)
    expect(s.avisos.some((a) => a.nivel === "revisar" && a.texto.includes("19 %"))).toBe(true)
  })

  it("régimen simple responsable de IVA: con el IVA estimado sale el ReteIVA", () => {
    const perfil = { ...ctx().perfil!, regimenSimple: true }
    const s = sugerirLiquidacion(sinDesglose({ perfil }), cat)
    expect(s.lineas.find((l) => l.tipo === "reteiva")).toMatchObject({ base: 190000, tarifa: 0.15, valor: 28500 })
  })

  it("no responsable de IVA: se liquida sobre el valor del documento", () => {
    const perfil = { ...ctx().perfil!, responsableIva: false }
    const s = sugerirLiquidacion(sinDesglose({ perfil }), cat)
    expect(s.desglose).toEqual({ base: 1190000, iva: 0, estimado: false })
  })

  it("concepto sin IVA (transporte de carga) o sin retención (nómina): no estima", () => {
    expect(sugerirLiquidacion(sinDesglose({ origen: { fuente: "texto", concepto: "transporte_carga" } }), cat).desglose?.estimado).toBe(false)
    expect(sugerirLiquidacion(sinDesglose({ origen: { fuente: "texto", concepto: null } }), cat).desglose?.estimado).toBe(false)
  })

  it("con el desglose conocido (OC, o ya corregido) no toca la base ni el IVA", () => {
    expect(sugerirLiquidacion(ctx(), cat).desglose).toEqual({ base: 1090000, iva: 190000, estimado: false })
  })

  it("datosLiquidacion manda base e IVA solo si se le pasan", () => {
    expect(datosLiquidacion([], null, "", "")).not.toHaveProperty("base_gravable")
    expect(datosLiquidacion([], null, "", "", { base: 1000000, iva: 190000 })).toMatchObject({ base_gravable: 1000000, iva: 190000 })
  })
})
