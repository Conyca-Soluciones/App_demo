// Catálogo de la migración 20261203000000_liquidacion_pagos.sql, leído del
// archivo (así las pruebas usan los mismos conceptos y actividades que la base).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CatalogoLiquidacion } from "@/lib/liquidacion"

export function catalogoDeLaMigracion(): CatalogoLiquidacion {
  const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "20261203000000_liquidacion_pagos.sql"), "utf8")
  const n = (x: string) => (x === "null" ? null : Number(x))
  const conceptos = [
    ...sql.matchAll(
      /\('([a-z_]+)',\s*'([^']+)',\s*([0-9.]+),\s*([0-9.]+),\s*(null|[0-9.]+),\s*([0-9.]+),\s*(true|false),\s*'([a-z_]+)',\s*\d+\)/g
    ),
  ].map((m) => ({
    clave: m[1],
    nombre: m[2],
    tarifaDeclarante: Number(m[3]),
    tarifaNoDeclarante: Number(m[4]),
    tarifaJuridica: n(m[5]),
    baseUvt: Number(m[6]),
    naturalTabla383: m[7] === "true",
    actividadIca: m[8],
  }))
  const actividades = [...sql.matchAll(/\('([a-z_]+)',\s*'([^']+)',\s*'(compras|servicios|profesionales)',\s*\d+\)/g)].map((m) => ({
    clave: m[1],
    nombre: m[2],
    usaBase: m[3] as "compras" | "servicios" | "profesionales",
  }))
  const uvt = /insert into public\.uvt \(anio, valor\) values \((\d+), (\d+)\)/.exec(sql)
  return { uvt: uvt ? { [uvt[1]]: Number(uvt[2]) } : {}, conceptos, actividades }
}
