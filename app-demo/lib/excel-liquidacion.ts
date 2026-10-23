// Excel de liquidación del Consolidado (20261215000000). Contabilidad lo baja,
// liquida (o comenta lo que no puede) y lo sube: la app solo toma el ID oculto
// y las columnas de Contabilidad. La hoja va protegida: solo se pueden editar
// esas columnas (la protección de Excel se puede quitar, por eso al subir se
// ignora todo lo demás). Cada fila trae el enlace fijo al soporte del pago.
//
// leerFilasLiquidacion es lógica pura (pruebas en tests/excel-liquidacion.test.ts);
// descargarExcelLiquidacion arma el archivo en el navegador.

import { leerNumero } from "@/lib/contratos"
import { ZONA_HORARIA } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"
import {
  anticiposOrigen,
  cuadreLiquidacion,
  etiquetaEtapa,
  rutaSoportePago,
  type FilaLiquidacion,
  type Pago,
} from "@/lib/pagos"

export const COLUMNAS_LIQUIDACION = {
  item: "ITEM",
  semana: "Semana",
  empresa: "Grupo empresarial",
  factura: "Empresa que factura",
  documento: "Documento",
  solicitante: "Solicitante",
  origen: "Origen",
  etapa: "Etapa",
  valorDocumento: "Valor documento",
  soporte: "Soporte",
  base: "Base",
  iva: "IVA",
  retefuente: "Retefuente",
  reteiva: "Retención de IVA",
  reteica: "Retención de ICA",
  asumidas: "Asumidas",
  liquidaciones: "Liquidaciones",
  anticipos: "Anticipos y/o descuentos",
  valorAPagar: "Valor a pagar",
  diferencia: "Diferencia (control)",
  sinRetenciones: "Liquidar sin retenciones",
  comentario: "Comentario para Financiera",
  ultimoComentario: "Último comentario",
  id: "ID interno -- NO BORRAR NI EDITAR",
} as const

type ClaveColumna = keyof typeof COLUMNAS_LIQUIDACION

// editable = columna de Contabilidad (sin bloquear); pesos = formato de pesos.
const ORDEN: { clave: ClaveColumna; ancho: number; editable?: boolean; pesos?: boolean }[] = [
  { clave: "item", ancho: 7 },
  { clave: "semana", ancho: 10 },
  { clave: "empresa", ancho: 26 },
  { clave: "factura", ancho: 34 },
  { clave: "documento", ancho: 18 },
  { clave: "solicitante", ancho: 20 },
  { clave: "origen", ancho: 20 },
  { clave: "etapa", ancho: 13 },
  { clave: "valorDocumento", ancho: 16, pesos: true },
  { clave: "soporte", ancho: 9 },
  { clave: "base", ancho: 15, editable: true, pesos: true },
  { clave: "iva", ancho: 14, editable: true, pesos: true },
  { clave: "retefuente", ancho: 14, editable: true, pesos: true },
  { clave: "reteiva", ancho: 14, editable: true, pesos: true },
  { clave: "reteica", ancho: 14, editable: true, pesos: true },
  { clave: "asumidas", ancho: 14, editable: true, pesos: true },
  { clave: "liquidaciones", ancho: 14, editable: true, pesos: true },
  { clave: "anticipos", ancho: 16, editable: true, pesos: true },
  { clave: "valorAPagar", ancho: 16, editable: true, pesos: true },
  { clave: "diferencia", ancho: 14, pesos: true },
  { clave: "sinRetenciones", ancho: 13, editable: true },
  { clave: "comentario", ancho: 40, editable: true },
  { clave: "ultimoComentario", ancho: 40 },
  { clave: "id", ancho: 38 },
]

// La protección de la hoja (no es seguridad: solo evita tocar otras columnas
// por error; la app ignora lo demás al subir).
const CLAVE_PROTECCION = "CONYCA-AYF"
const SI = "Sí"

const normal = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")

function texto(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text ?? "").trim()
  return String(v).trim()
}

// null = vacío; NaN = no es un número.
function numeroCelda(v: unknown): number | null {
  if (v == null || texto(v) === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : Number.NaN
  const n = leerNumero(texto(v).replace(/[$\s]/g, ""))
  return n == null ? Number.NaN : Math.round(n * 100) / 100
}

export type ErrorFilaLiquidacion = { fila: number; item: string; mensaje: string }
export type AvisoFilaLiquidacion = { fila: number; item: string; mensaje: string }

/**
 * Lee las filas del Excel (como las da XLSX con `header: 1`). Busca la fila de
 * encabezados por el "ID interno" y las columnas por NOMBRE. Una fila sin
 * valor a pagar, sin "Liquidar sin retenciones" y sin comentario se deja
 * igual (sigue por liquidar). Números negativos o que no son números = error.
 * Avisa (no bloquea) cuando el valor a pagar no cuadra con los descuentos.
 */
export function leerFilasLiquidacion(filas: unknown[][]): {
  filas: FilaLiquidacion[]
  errores: ErrorFilaLiquidacion[]
  avisos: AvisoFilaLiquidacion[]
  sinTocar: number
} {
  const iEncabezado = filas.findIndex((f) => (f ?? []).some((c) => normal(c).startsWith("id interno")))
  if (iEncabezado < 0) {
    throw new Error('No se encontró la columna "ID interno". Usa el Excel descargado desde el Consolidado, sin cambiar los encabezados.')
  }
  const encabezado = (filas[iEncabezado] ?? []).map(normal)
  const indice = (clave: ClaveColumna) =>
    clave === "id" ? encabezado.findIndex((h) => h.startsWith("id interno")) : encabezado.indexOf(normal(COLUMNAS_LIQUIDACION[clave]))
  const indices = Object.fromEntries(ORDEN.map((c) => [c.clave, indice(c.clave)])) as Record<ClaveColumna, number>
  const obligatorias: ClaveColumna[] = ["id", "valorAPagar", "comentario", "sinRetenciones"]
  const faltan = obligatorias.filter((k) => indices[k] < 0).map((k) => `"${COLUMNAS_LIQUIDACION[k]}"`)
  if (faltan.length > 0) throw new Error(`Faltan las columnas ${faltan.join(", ")}. Usa el Excel descargado desde el Consolidado.`)
  const celda = (f: unknown[], k: ClaveColumna) => (indices[k] >= 0 ? f[indices[k]] : undefined)

  const resultado: FilaLiquidacion[] = []
  const errores: ErrorFilaLiquidacion[] = []
  const avisos: AvisoFilaLiquidacion[] = []
  const vistos = new Set<string>()
  let sinTocar = 0
  const numericas = ["base", "iva", "retefuente", "reteiva", "reteica", "asumidas", "liquidaciones", "anticipos", "valorAPagar"] as const

  for (let i = iEncabezado + 1; i < filas.length; i++) {
    const f = filas[i] ?? []
    const id = texto(celda(f, "id"))
    if (!id) continue
    const numeroFila = i + 1
    const item = texto(celda(f, "item"))
    if (vistos.has(id)) {
      errores.push({ fila: numeroFila, item, mensaje: "La fila está repetida." })
      continue
    }
    vistos.add(id)

    const valores: Partial<Record<(typeof numericas)[number], number | null>> = {}
    let malo: string | null = null
    for (const k of numericas) {
      const v = numeroCelda(celda(f, k))
      if (v != null && (Number.isNaN(v) || v < 0)) {
        malo = `"${COLUMNAS_LIQUIDACION[k]}" tiene que ser un número mayor o igual a cero.`
        break
      }
      valores[k] = v
    }
    if (malo) {
      errores.push({ fila: numeroFila, item, mensaje: malo })
      continue
    }
    const sinRetenciones = ["si", "x", "1", "true"].includes(normal(celda(f, "sinRetenciones")))
    const comentario = texto(celda(f, "comentario")) || null
    if (valores.valorAPagar == null && !sinRetenciones && !comentario) {
      sinTocar++
      continue
    }

    const fila: FilaLiquidacion = {
      pagoId: id,
      base: valores.base ?? null,
      iva: valores.iva ?? null,
      retefuente: valores.retefuente ?? null,
      reteiva: valores.reteiva ?? null,
      reteica: valores.reteica ?? null,
      asumidas: valores.asumidas ?? null,
      liquidaciones: valores.liquidaciones ?? null,
      anticiposDescuentos: valores.anticipos ?? null,
      valorAPagar: valores.valorAPagar ?? null,
      sinRetenciones,
      comentario,
    }
    const documento = numeroCelda(celda(f, "valorDocumento"))
    if (!comentario && !sinRetenciones && documento != null && !Number.isNaN(documento)) {
      const { diferencia } = cuadreLiquidacion(documento, fila)
      if (diferencia != null && Math.abs(diferencia) >= 1) {
        avisos.push({ fila: numeroFila, item, mensaje: `El valor a pagar no cuadra con los descuentos (diferencia ${diferencia.toLocaleString("es-CO")}).` })
      }
    }
    resultado.push(fila)
  }
  return { filas: resultado, errores, avisos, sinTocar }
}

const letra = (n: number) => {
  let s = ""
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

/** El libro del Excel (sin descargarlo): separado para poder probarlo. */
export async function construirLibroLiquidacion(pagos: Pago[], opciones: { titulo: string; origenUrl: string; bufferLogo: ArrayBuffer | null }) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Liquidación")
  const n = ORDEN.length
  const col = Object.fromEntries(ORDEN.map((c, i) => [c.clave, i + 1])) as Record<ClaveColumna, number>

  const primera = agregarEncabezadoMarca(libro, hoja, {
    titulo: opciones.titulo,
    subtitulo: "Llena solo las columnas amarillas. Con comentario el pago queda observado para Financiera.",
    numColumnas: n - 1,
    bufferLogo: opciones.bufferLogo,
  })

  ORDEN.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  ORDEN.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = COLUMNAS_LIQUIDACION[c.clave]
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 32

  const L = (k: ClaveColumna, fila: number) => `${letra(col[k])}${fila}`
  pagos.forEach((p, k) => {
    const r = primera + 1 + k
    const fila = hoja.getRow(r)
    const ultimo = p.ultimoComentario
      ? `${p.ultimoComentario.autor ?? ""}${p.ultimoComentario.autor ? ": " : ""}${p.ultimoComentario.texto}`
      : ""
    const valores: Partial<Record<ClaveColumna, unknown>> = {
      item: p.item,
      semana: p.semana != null ? `${p.semana} · ${p.anio}` : "",
      empresa: p.empresaNombre ?? "",
      factura: p.terceroNombre ?? "",
      documento: p.terceroDocumento ?? "",
      solicitante: p.solicitadoPorNombre ?? "",
      origen: p.origen,
      etapa: etiquetaEtapa(p),
      valorDocumento: p.valorDocumento ?? p.valor,
      base: p.liqBase ?? p.baseGravable,
      iva: p.liqIva ?? p.iva,
      retefuente: p.retefuente,
      reteiva: p.reteiva,
      reteica: p.reteica,
      asumidas: p.asumidas,
      liquidaciones: p.liquidaciones,
      anticipos: p.liqAnticiposDescuentos ?? anticiposOrigen(p),
      valorAPagar: p.valorAPagar,
      sinRetenciones: "",
      comentario: "",
      ultimoComentario: ultimo,
      id: p.id,
    }
    ORDEN.forEach((c, i) => {
      const celda = fila.getCell(i + 1)
      if (c.clave === "soporte") {
        celda.value = { text: "Ver", hyperlink: `${opciones.origenUrl}${rutaSoportePago(p.id)}` }
        celda.font = { color: { argb: "FF1F5FBF" }, underline: true }
      } else if (c.clave === "diferencia") {
        // Control: valor a pagar − (documento − retenciones + asumidas − liquidaciones − anticipos).
        const v = L("valorAPagar", r)
        celda.value = {
          formula:
            `IF(${v}="","",${v}-(${L("valorDocumento", r)}-N(${L("retefuente", r)})-N(${L("reteiva", r)})-N(${L("reteica", r)})` +
            `+N(${L("asumidas", r)})-N(${L("liquidaciones", r)})-N(${L("anticipos", r)})))`,
        }
      } else {
        const v = valores[c.clave]
        celda.value = v === undefined ? null : (v as never)
      }
      if (c.pesos) celda.numFmt = "#,##0.00"
      if (c.editable) {
        celda.protection = { locked: false }
        celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } }
      }
      if (c.clave === "sinRetenciones") celda.dataValidation = { type: "list", allowBlank: true, formulae: [`"${SI}"`] }
      if (c.clave === "comentario" || c.clave === "ultimoComentario") celda.alignment = { wrapText: true, vertical: "top" }
    })
  })
  // Diferencia en rojo cuando no cuadra.
  if (pagos.length > 0) {
    const d = letra(col.diferencia)
    const rango = `${d}${primera + 1}:${d}${primera + pagos.length}`
    hoja.addConditionalFormatting({
      ref: rango,
      rules: [
        {
          type: "expression",
          priority: 1,
          formulae: [`AND(${d}${primera + 1}<>"",ABS(${d}${primera + 1})>=1)`],
          style: { font: { color: { argb: "FFC00000" }, bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDE2E2" } } },
        },
      ],
    })
  }
  hoja.getColumn(n).hidden = true
  hoja.autoFilter = { from: { row: primera, column: 1 }, to: { row: primera + Math.max(pagos.length, 1), column: n - 1 } }

  const filasMarca = primera - 2
  hoja.unMergeCells(`A1:B${filasMarca}`)
  hoja.mergeCells(`A1:A${filasMarca}`)
  hoja.views = [{ state: "frozen", xSplit: 1, ySplit: primera }]
  await hoja.protect(CLAVE_PROTECCION, {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatColumns: true,
    formatRows: true,
    autoFilter: true,
    sort: true,
  })
  return libro
}

export async function descargarExcelLiquidacion(pagos: Pago[], nombreConsolidado: string) {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })
  const libro = await construirLibroLiquidacion(pagos, {
    titulo: `Liquidación · ${nombreConsolidado}`,
    origenUrl: window.location.origin,
    bufferLogo: await obtenerBufferLogoConyca(),
  })
  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `liquidacion-${nombreConsolidado.toLowerCase().replace(/\s+/g, "-")}-${hoy}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
