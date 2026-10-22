// Prueba del motor contra lo que Contabilidad liquidó a mano (semanas 31-42 de
// 2026). Corre solo si existe referencias/prueba_liquidacion.json (fuera de
// git; lo genera scripts/generar_prueba_liquidacion.py). Recorre los pagos en
// orden de fecha y, como la app, guarda en la memoria del documento lo que
// Contabilidad decidió antes de sugerir el siguiente. Imprime el acierto.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { sugerirLiquidacion, totalesLiquidacion, type ContextoPago, type PreferenciaLiquidacion } from "@/lib/liquidacion"
import { catalogoDeLaMigracion } from "./liquidacion-catalogo"

const ARCHIVO = join(__dirname, "..", "referencias", "prueba_liquidacion.json")

type Caso = {
  fecha: string
  empresa: string
  concepto_texto: string
  contexto: ContextoPago
  real: {
    retefuente: number
    reteica: number
    reteiva: number
    conceptoRetefuente: string | null
    tarifaRetefuente: number
    tarifaIca: number
  }
}

const igual = (a: number, b: number) => Math.abs(a - b) <= Math.max(1000, 0.01 * Math.max(a, b))

function semanaIso(f: string): number {
  const d = new Date(f + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)
}

function recorrer(casos: Caso[], aprender: boolean) {
  const cat = catalogoDeLaMigracion()
  const memoria = new Map<string, PreferenciaLiquidacion[]>()
  const r = { conTexto: [0, 0], total: 0, exactos: 0, rf: 0, ica: 0, iva: 0, porSemana: new Map<number, [number, number]>(), fallos: [] as string[] }
  for (const c of casos) {
    const doc = c.contexto.tercero!.documento
    const prefs = memoria.get(doc) ?? []
    const s = sugerirLiquidacion({ ...c.contexto, preferencias: prefs }, cat)
    const t = totalesLiquidacion(c.contexto.valor, s.lineas)
    const okRf = igual(t.retefuente, c.real.retefuente)
    const okIca = igual(t.reteica, c.real.reteica)
    const okIva = igual(t.reteiva, c.real.reteiva)
    const ok = okRf && okIca && okIva
    r.total++
    if (ok) r.exactos++
    if (c.concepto_texto.trim()) {
      r.conTexto[1]++
      if (ok) r.conTexto[0]++
    }
    if (okRf) r.rf++
    if (okIca) r.ica++
    if (okIva) r.iva++
    const sem = semanaIso(c.fecha)
    const ps = r.porSemana.get(sem) ?? [0, 0]
    r.porSemana.set(sem, [ps[0] + (ok ? 1 : 0), ps[1] + 1])
    if (!ok && r.fallos.length < 25) {
      r.fallos.push(
        `${c.fecha} ${c.empresa.slice(0, 20)} | ${c.concepto_texto.slice(0, 40)} | base ${c.contexto.baseGravable} | ` +
          `motor rf ${t.retefuente} ica ${t.reteica} iva ${t.reteiva} | real rf ${c.real.retefuente} ica ${c.real.reteica} iva ${c.real.reteiva}`
      )
    }
    if (!aprender) continue
    // Lo que Contabilidad confirmó queda en la memoria del documento.
    const pon = (p: PreferenciaLiquidacion) => {
      const i = prefs.findIndex((x) => x.tipo === p.tipo && x.municipioId === p.municipioId)
      const previa = i >= 0 ? prefs[i] : null
      const nueva = { ...p, veces: previa && previa.tarifa === p.tarifa && previa.concepto === p.concepto ? previa.veces + 1 : 1 }
      if (i >= 0) prefs[i] = nueva
      else prefs.push(nueva)
    }
    const sugirio = (tipo: string) => s.lineas.some((l) => l.tipo === tipo)
    if (c.real.retefuente > 0 && c.real.conceptoRetefuente) {
      pon({ tipo: "retefuente", municipioId: null, concepto: c.real.conceptoRetefuente, actividad: null, tarifa: c.real.tarifaRetefuente, veces: 1, origen: "contabilidad" })
    } else if (c.real.retefuente === 0 && sugirio("retefuente")) {
      pon({ tipo: "retefuente", municipioId: null, concepto: null, actividad: null, tarifa: 0, veces: 1, origen: "contabilidad" })
    }
    const mun = c.contexto.municipio
    if (mun && c.real.reteica > 0) {
      const actividad = Object.entries(mun.tarifas).find(([, v]) => Math.abs(v - c.real.tarifaIca) < 1e-6)?.[0] ?? null
      pon({ tipo: "reteica", municipioId: mun.id, concepto: null, actividad, tarifa: c.real.tarifaIca, veces: 1, origen: "contabilidad" })
    } else if (mun && c.real.reteica === 0 && sugirio("reteica")) {
      pon({ tipo: "reteica", municipioId: mun.id, concepto: null, actividad: null, tarifa: 0, veces: 1, origen: "contabilidad" })
    }
    if (c.real.reteiva > 0) pon({ tipo: "reteiva", municipioId: null, concepto: null, actividad: null, tarifa: 0.15, veces: 1, origen: "contabilidad" })
    else if (sugirio("reteiva")) pon({ tipo: "reteiva", municipioId: null, concepto: null, actividad: null, tarifa: 0, veces: 1, origen: "contabilidad" })
    memoria.set(doc, prefs)
  }
  return r
}

const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)} %`

describe.skipIf(!existsSync(ARCHIVO))("motor contra el cuadro de las semanas 31-42", () => {
  it("acierta y aprende", () => {
    const casos: Caso[] = JSON.parse(readFileSync(ARCHIVO, "utf8"))
    const sin = recorrer(casos, false)
    const con = recorrer(casos, true)
    const linea = (n: string, r: ReturnType<typeof recorrer>) =>
      `${n}: ${pct(r.exactos, r.total)} exactos (${r.exactos}/${r.total}) · retefuente ${pct(r.rf, r.total)} · ReteICA ${pct(r.ica, r.total)} · ReteIVA ${pct(r.iva, r.total)} · con concepto escrito ${pct(r.conTexto[0], r.conTexto[1])} (${r.conTexto[1]})`
    console.log(linea("Solo reglas (sin memoria)", sin))
    console.log(linea("Aprendiendo de Contabilidad", con))
    console.log(
      "Por semana (aprendiendo): " +
        [...con.porSemana.entries()].sort((a, b) => a[0] - b[0]).map(([s, [o, n]]) => `s${s} ${pct(o, n)} (${n})`).join(" · ")
    )
    if (process.env.FALLOS) console.log(con.fallos.join("\n"))
    expect(con.exactos).toBeGreaterThanOrEqual(sin.exactos)
  })
})
