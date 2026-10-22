import { describe, expect, it } from "vitest"
import path from "path"
import { renderToBuffer } from "@react-pdf/renderer"
import {
  actaPolizaPorDefecto,
  amparosDesdeMinuta,
  limpiarActaPoliza,
  mapDatosActaPoliza,
  mezclarActaPoliza,
  origenCampoActaPoliza,
  validarActaPoliza,
} from "@/lib/acta-poliza"
import { ActaPolizaPDF } from "@/components/acta-poliza-pdf"

const datos = (cambios: Record<string, unknown> = {}) =>
  mapDatosActaPoliza({
    id: "p1",
    contrato_id: "c1",
    estado: "por_revisar",
    nombre_archivo: "poliza.pdf",
    empresa_nombre: "CONYCA SOLUCIONES S.A.S",
    director_nombre: "Carlos Director",
    director_correo: "director@conyca.co",
    usuario_nombre: "Ana Jurídica",
    contrato_minuta: { amparos: [{ amparo: "Cumplimiento", porcentaje: "20", vigencia: "Plazo + 4 meses" }, { amparo: " " }] },
    contrato: {
      id: "c1", numero: 14, numero_contrato: "CJ-14-2026", clase: "grupo", tipo: "obra", objeto: "Ejecutar la obra",
      valor: 10_000_000, contratista: { nombre: "Construcciones Andinas SAS", documento: "NIT 900" },
    },
    ...cambios,
  })

describe("acta de aprobación de pólizas", () => {
  it("se llena sola con el contrato, el director y los amparos de la minuta", () => {
    const a = actaPolizaPorDefecto(datos(), "2026-10-21")
    expect(a.numeroContrato).toBe("CJ-14-2026")
    expect(a.supervisorNombre).toBe("Carlos Director")
    expect(a.correo).toBe("director@conyca.co")
    expect(a.objeto).toBe("Ejecutar la obra")
    expect(a.contratistaNombre).toBe("Construcciones Andinas SAS")
    expect(a.asesorNombre).toBe("Ana Jurídica")
    expect(a.fechaAprobacion).toBe("2026-10-21")
    expect(a.amparos).toHaveLength(1)
    expect(a.amparos[0].amparo).toBe("Cumplimiento (20 %)")
    expect(a.amparos[0].valor.replace(/\s/g, "")).toMatch(/2\.000\.000/)
    expect(a.aseguradora).toBe("")
  })
  it("aprobada: firma quien la aprobó con la fecha de aprobación", () => {
    const a = actaPolizaPorDefecto(datos({ estado: "aprobada", resuelta_at: "2026-10-25T15:00:00Z", resuelta_por_nombre: "Luz" }), "2026-11-01")
    expect(a.fechaAprobacion).toBe("2026-10-25")
    expect(a.asesorNombre).toBe("Luz")
  })
  it("sin amparos en la minuta: una fila vacía", () => {
    expect(amparosDesdeMinuta(null, 100)).toEqual([])
    expect(actaPolizaPorDefecto(datos({ contrato_minuta: null }), "2026-10-21").amparos).toEqual([{ amparo: "", valor: "", vigencia: "" }])
  })
  it("lo guardado gana; el número de contrato no se cambia", () => {
    const d = actaPolizaPorDefecto(datos(), "2026-10-21")
    const m = mezclarActaPoliza(d, { aseguradora: "Sura", numeroContrato: "OTRO", amparos: [{ amparo: "Salarios", valor: "$1", vigencia: "3 años" }], x: 1 })
    expect(m.aseguradora).toBe("Sura")
    expect(m.numeroContrato).toBe("CJ-14-2026")
    expect(m.amparos).toEqual([{ amparo: "Salarios", valor: "$1", vigencia: "3 años" }])
    expect(origenCampoActaPoliza("aseguradora", "Sura", d)).toBe("editado")
    expect(origenCampoActaPoliza("supervisorNombre", d.supervisorNombre, d)).toBe("solicitud")
    expect(origenCampoActaPoliza("asesorCargo", d.asesorCargo, d)).toBe("plantilla")
    expect(origenCampoActaPoliza("soportePago", "", d)).toBe("vacio")
  })
  it("para aprobar: aseguradora, amparos con nombre, fecha y quien firma", () => {
    const d = actaPolizaPorDefecto(datos(), "2026-10-21")
    expect(validarActaPoliza(d)).toMatch(/aseguradora/)
    expect(validarActaPoliza({ ...d, aseguradora: "Sura" })).toBeNull()
    expect(validarActaPoliza({ ...d, aseguradora: "Sura", amparos: [{ amparo: "", valor: "", vigencia: "" }] })).toMatch(/amparo/)
    expect(validarActaPoliza({ ...d, aseguradora: "Sura", fechaAprobacion: "" })).toMatch(/fecha/)
    expect(limpiarActaPoliza({ ...d, amparos: [...d.amparos, { amparo: " ", valor: "", vigencia: "" }] }).amparos).toHaveLength(1)
  })
  it("genera el PDF", async () => {
    const acta = { ...actaPolizaPorDefecto(datos(), "2026-10-21"), aseguradora: "Seguros Sura" }
    const pdf = await renderToBuffer(<ActaPolizaPDF acta={acta} logo={path.join(process.cwd(), "public", "logo-conyca.png")} foco="aseguradora" borrador />)
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
    expect(pdf.length).toBeGreaterThan(5000)
  })
})
