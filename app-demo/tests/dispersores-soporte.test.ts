// El soporte PDF de los dispersores (port de pdf_soporte de Python): agrupa por
// empresa y proyecto, lleva la ficha de la cuenta y el título con la semana.
// Con VOLCAR_PDF=1 guarda el PDF en referencias/dispersores para compararlo a
// ojo con el de Python.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import { SoporteDispersorPDF, nombreSoporteGrupal, nombreSoporteIndividual } from "@/components/soporte-dispersor-pdf"
import type { Renglon, Tanda } from "@/lib/dispersores/generador"

const r = (p: Partial<Renglon>): Renglon => ({
  item: "1", documento: "111", tipoDoc: "CC", dv: "", nombre: "ANA PEREZ", nombres: "", apellidos: "",
  bancoDestino: "BANCOLOMBIA", tipoCuenta: "AHORROS", cuenta: "1", valor: 100000, referencia: "",
  empresa: "CONSORCIO A", proyecto: "100-PP-UNO", ...p,
})

const tanda: Tanda = {
  cuenta: { apodo: "PRUEBA", diminutivo: "PRB", banco: "BANCO DE BOGOTA", tipoCuenta: "CORRIENTE", cuenta: "123456789", nit: "900000001", dv: "1", razonSocial: "EMPRESA DE PRUEBAS", correoItau: "" },
  renglones: [
    r({}),
    r({ item: "2", documento: "222", nombre: "LUIS GOMEZ", cuenta: "2", valor: 200000, proyecto: "100-PP-DOS" }),
    r({ item: "3", documento: "333", nombre: "LIA RUIZ", cuenta: "3", valor: 300000, empresa: "CONSORCIO B", proyecto: "900-CS-TRES" }),
  ],
  semana: 99, clasePago: "PROVEEDORES", secuencia: "A1", fecha: "20261023", esNomina: false, truncado: "0.75",
}

describe("soporte PDF de los dispersores", () => {
  it("nombres del grupal y del individual como la consola", () => {
    expect(nombreSoporteGrupal(tanda, 2)).toBe("PRB_SEM99_soporte_Ronda2.pdf")
    expect(nombreSoporteIndividual(tanda, "7")).toBe("PRB_SEM99_ITEM7_soporte.pdf")
  })

  it("se genera con el título de la semana", async () => {
    const logo = readFileSync(path.join(process.cwd(), "public", "logo-conyca.png"))
    const pdf = await renderToBuffer(
      createElement(SoporteDispersorPDF, {
        tanda,
        archivos: ["PRB_SEM99.txt", "PRB_SEM99_plantilla.xlsx"],
        cambiosManuales: ["item 2 · LUIS GOMEZ · BANCOLOMBIA · ahorros · 2"],
        logo,
        generado: new Date("2026-10-23T15:30:00Z"),
      }) as never
    )
    const crudo = pdf.toString("latin1")
    expect(crudo.startsWith("%PDF")).toBe(true)
    if (process.env.VOLCAR_PDF) {
      mkdirSync(path.join(process.cwd(), "referencias", "dispersores"), { recursive: true })
      writeFileSync(path.join(process.cwd(), "referencias", "dispersores", "typescript.pdf"), pdf)
    }
  }, 30000)
})
