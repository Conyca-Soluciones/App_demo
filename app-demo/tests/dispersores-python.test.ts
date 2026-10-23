// Comparación cruzada contra el generador ORIGINAL de Python: las mismas tandas
// (tildes, Ñ, NIT con DV, los cuatro bancos, DaviPlata, '023-...', cuentas
// largas, tipos de documento que un banco no acepta...) pasan por los dos y se
// compara cada plano carácter por carácter, cada error y cada celda de los
// Excel (valor, formato, negrilla, alineación), los anchos y los paneles fijos.
//
// Las salidas de Python las produce python_salidas.py (con la consola de
// dispersores) en referencias/dispersores/comparacion_python.json, fuera de
// git. Sin ese archivo la prueba se salta.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { BANCOLOMBIA, BOGOTA, ITAU } from "@/lib/dispersores/catalogos"
import {
  ErrorGeneracion,
  excelDavivienda,
  excelItau,
  nombreBase,
  planillaBancolombia,
  planillaBogota,
  planoBancolombia,
  planoBogota,
  type ClasePago,
  type Tanda,
} from "@/lib/dispersores/generador"

const ARCHIVO = path.join(process.cwd(), "referencias", "dispersores", "comparacion_python.json")

/* eslint-disable @typescript-eslint/no-explicit-any */
function aTanda(d: any): Tanda {
  const c = d.cuenta
  return {
    cuenta: {
      apodo: c.apodo, diminutivo: c.diminutivo, banco: c.banco, tipoCuenta: c.tipo_cuenta, cuenta: c.cuenta,
      nit: c.nit, dv: c.dv, razonSocial: c.razon_social, correoItau: c.correo_itau,
    },
    renglones: d.renglones.map((r: any) => ({
      item: r.item, documento: r.documento, tipoDoc: r.tipo_doc, dv: r.dv, nombre: r.nombre, nombres: r.nombres,
      apellidos: r.apellidos, bancoDestino: r.banco_destino, tipoCuenta: r.tipo_cuenta, cuenta: r.cuenta,
      valor: r.valor, referencia: r.referencia, empresa: r.empresa, proyecto: r.proyecto,
    })),
    semana: d.semana, clasePago: d.clase_pago as ClasePago, secuencia: d.secuencia, fecha: d.fecha,
    esNomina: false, truncado: "",
  }
}

function correr(fn: () => unknown): any {
  try {
    return { ok: fn() }
  } catch (e) {
    if (e instanceof ErrorGeneracion) return { error: e.message }
    throw e
  }
}

const letra = (n: number) => {
  let s = ""
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

// El mismo volcado que hace python_salidas.py con openpyxl.
function volcar(wb: ExcelJS.Workbook) {
  return wb.worksheets.map((ws) => {
    const celdas: unknown[] = []
    ws.eachRow({ includeEmpty: false }, (fila) =>
      fila.eachCell({ includeEmpty: false }, (c) => {
        const valor = c.value ?? null
        const negrilla = Boolean(c.font?.bold)
        if (valor === null && !negrilla) return
        celdas.push([Number(c.row), Number(c.col), valor, c.numFmt ?? "General", negrilla, c.alignment?.horizontal ?? null])
      })
    )
    const anchos: Record<string, number> = {}
    ws.columns?.forEach((col, i) => {
      if (col.width) anchos[letra(i + 1)] = col.width
    })
    const vista = ws.views?.[0] as { topLeftCell?: string } | undefined
    return { titulo: ws.name, celdas, anchos, fijo: vista?.topLeftCell ?? null }
  })
}

const casos: any[] = existsSync(ARCHIVO) ? JSON.parse(readFileSync(ARCHIVO, "utf8")) : []

describe.skipIf(casos.length === 0)(`igual que el generador de Python (${casos.length} tandas)`, () => {
  it("nombres de archivo", () => {
    for (const c of casos) expect(nombreBase({ ...aTanda(c.tanda), esNomina: false })).toBe(c.nombre_base)
  })

  it("planos de Bogotá y Bancolombia, carácter por carácter, y los mismos errores", () => {
    let comparados = 0
    for (const c of casos) {
      if (!c.plano) continue
      const t = aTanda(c.tanda)
      const mio = correr(() => (t.cuenta.banco === BOGOTA ? planoBogota(t) : planoBancolombia(t)))
      expect(mio, `tanda ${comparados}: ${JSON.stringify(c.tanda.cuenta.banco)}`).toEqual(c.plano)
      comparados++
    }
    expect(comparados).toBeGreaterThan(100)
  })

  it("Excel de los cuatro bancos, celda por celda", () => {
    let comparados = 0
    for (const c of casos) {
      const t = aTanda(c.tanda)
      const b = t.cuenta.banco
      const mio = correr(() =>
        volcar(
          b === BOGOTA ? planillaBogota(ExcelJS, t)
            : b === BANCOLOMBIA ? planillaBancolombia(ExcelJS, t)
            : b === ITAU ? excelItau(ExcelJS, t)
            : excelDavivienda(ExcelJS, t)
        )
      )
      expect(mio, `tanda ${comparados} (${b})`).toEqual(c.excel)
      comparados++
    }
    expect(comparados).toBeGreaterThan(1000)
  })
})
