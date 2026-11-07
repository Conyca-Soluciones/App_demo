// Carga de insumos nuevos por Excel (2026-10-15).
//
// "Revisar pendientes" exporta las líneas de insumo del import que no tienen
// ninguna opción en el maestro, agrupadas por texto + unidad, con columnas para
// completar (tipo, unidad de compra, agrupación, IVA, precio, presentación). El
// mismo archivo se sube en Aprobación de insumos: se crean en el maestro y se
// asignan a las líneas pendientes con el mismo texto (ver
// previsualizarCargaInsumos / crearInsumosDesdeCarga en presupuestos/actions).
//
// Sin imports de servidor: lo usan el diálogo de revisión y la página de
// aprobación (cliente).

import { leerNumero } from "@/lib/contratos"
import { unidadMaestro } from "@/lib/unidades"
import { ZONA_HORARIA } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"

export const HOJA_CARGA = "Insumos sin opción"
export const HOJA_DETALLE = "Detalle por ítem"
const HOJA_LISTAS = "Listas"

// Clave para comparar textos del Excel del presupuesto: igual que en la base
// (lineas_revision_pendientes_por_texto).
export const claveTexto = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim().toLowerCase()

// Texto con que entra al maestro (como al aprobar una solicitud).
export const descripcionMaestro = (t: string) => t.trim().replace(/\s+/g, " ").toUpperCase()

// Columnas de la hoja que se sube. Las dos primeras identifican las líneas del
// APU (no se editan); de "Descripción para el maestro" en adelante se completan.
export const COLUMNAS_CARGA = [
  { clave: "insumoExcel", titulo: "Insumo (como viene en el Excel)", ancho: 48 },
  { clave: "unidadApu", titulo: "Unidad en el APU", ancho: 11 },
  { clave: "veces", titulo: "Veces en el APU", ancho: 10 },
  { clave: "items", titulo: "Ítems donde se usa", ancho: 30 },
  { clave: "descripcion", titulo: "Descripción para el maestro", ancho: 46 },
  { clave: "tipo", titulo: "Tipo", ancho: 20 },
  { clave: "unidadCompra", titulo: "Unidad de compra", ancho: 24 },
  { clave: "agrupacion", titulo: "Agrupación", ancho: 34 },
  { clave: "iva", titulo: "IVA %", ancho: 8 },
  { clave: "precio", titulo: "Precio sin IVA", ancho: 14 },
  { clave: "contenido", titulo: "Solo si se compra en otra unidad: ¿cuánto trae?", ancho: 17 },
  { clave: "unidadUso", titulo: "Solo si se compra en otra unidad: ¿en qué unidad?", ancho: 17 },
] as const

// Nota (comentario de Excel) en los encabezados de la presentación.
const NOTA_PRESENTACION =
  "Solo cuando el APU usa una unidad y el insumo se compra en otra. Ejemplo: el APU pide kg y se compra por " +
  "BULTO de 50 kg -> ¿cuánto trae? 50, ¿en qué unidad? KG (1 bulto = 50 kg). Así el precio del kilo sale del " +
  "precio del bulto. Si se compra en la misma unidad que usa el APU, déjalas vacías."


type ClaveColumna = (typeof COLUMNAS_CARGA)[number]["clave"]

// Una línea pendiente sin candidatos (lo que trae exportarInsumosSinOpcion).
export type LineaSinOpcion = {
  codigoItem: string
  item: string
  unidadItem: string | null
  cantidadItem: number | null
  insumo: string
  unidad: string | null
  cantidad: number
}

// Una fila de la hoja que se sube.
export type FilaCargaInsumo = {
  fila: number // número de fila en el Excel (para los mensajes)
  insumoExcel: string
  unidadApu: string
  descripcion: string
  tipo: string
  unidadCompra: string
  agrupacion: string
  iva: number | null
  precio: number | null
  contenido: string
  unidadUso: string
}

// Resultado de validar una fila (vista previa).
export type ResultadoFilaCarga = {
  fila: number
  insumoExcel: string
  descripcion: string
  errores: string[] // la fila no se crea
  lineas: number // líneas pendientes con ese texto
  lineasNoCuadran: number // de esas, las que quedan pendientes por la unidad
  // Qué hacer con las que no cuadran (casi siempre: llenar la presentación).
  avisoUnidad: string | null
  // Mismo insumo que otra fila (mismo texto para el maestro y mismos datos;
  // pasa cuando el Excel lo trae con dos unidades): no se crea otra vez, sus
  // líneas se asignan al de esa fila.
  unidoAFila: number | null
}

// Agrupa las líneas por texto + unidad (una fila por insumo).
export function agruparSinOpcion(lineas: LineaSinOpcion[]) {
  const grupos = new Map<string, { insumo: string; unidad: string; veces: number; items: string[] }>()
  for (const l of lineas) {
    const clave = `${claveTexto(l.insumo)}|${claveTexto(l.unidad)}`
    let g = grupos.get(clave)
    if (!g) {
      g = { insumo: l.insumo.replace(/\s+/g, " ").trim(), unidad: (l.unidad ?? "").trim(), veces: 0, items: [] }
      grupos.set(clave, g)
    }
    g.veces++
    if (!g.items.includes(l.codigoItem)) g.items.push(l.codigoItem)
  }
  return Array.from(grupos.values()).sort((a, b) => a.insumo.localeCompare(b.insumo, "es"))
}

const compararCodigo = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true })

export async function descargarPlantillaSinOpcion(opciones: {
  lineas: LineaSinOpcion[]
  tipos: string[]
  unidadesCompra: string[]
  agrupaciones: string[]
  unidadesUso: string[]
  nombreProyecto: string
}) {
  const { lineas, tipos, unidadesCompra, agrupaciones, unidadesUso, nombreProyecto } = opciones
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const grupos = agruparSinOpcion(lineas)

  // ---- hoja que se sube ----
  const hoja = libro.addWorksheet(HOJA_CARGA)
  const n = COLUMNAS_CARGA.length
  const primera = agregarEncabezadoMarca(libro, hoja, {
    titulo: `${nombreProyecto} — insumos sin opción en el maestro`,
    subtitulo:
      `${grupos.length} insumos (${lineas.length} líneas del APU). Completa las columnas grises y súbelo en ` +
      "Aprobación de insumos. No cambies las dos primeras columnas: con ellas se asignan las líneas. " +
      "Las dos últimas solo se llenan si el insumo se compra en otra unidad que la del APU (ver la nota del encabezado).",
    numColumnas: n,
    bufferLogo: await obtenerBufferLogoConyca(),
  })
  COLUMNAS_CARGA.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  COLUMNAS_CARGA.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = c.titulo
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
    if (c.clave === "contenido" || c.clave === "unidadUso") celda.note = NOTA_PRESENTACION
  })
  encabezado.height = 45

  // Listas de valores válidos en una hoja aparte (oculta) para los desplegables.
  const listas = libro.addWorksheet(HOJA_LISTAS, { state: "hidden" })
  const columnasListas: [string, (string | number)[]][] = [
    ["A", tipos],
    ["B", unidadesCompra],
    ["C", agrupaciones],
    ["D", [0, 5, 19]],
    ["E", unidadesUso],
  ]
  for (const [col, valores] of columnasListas) valores.forEach((v, i) => (listas.getCell(`${col}${i + 1}`).value = v))
  const rango = (col: string, cantidad: number) => `${HOJA_LISTAS}!$${col}$1:$${col}$${Math.max(cantidad, 1)}`
  const desplegable: Partial<Record<ClaveColumna, string>> = {
    tipo: rango("A", tipos.length),
    unidadCompra: rango("B", unidadesCompra.length),
    agrupacion: rango("C", agrupaciones.length),
    iva: rango("D", 3),
    unidadUso: rango("E", unidadesUso.length),
  }
  const gris = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF2F4F7" } }

  grupos.forEach((g, i) => {
    const fila = hoja.getRow(primera + 1 + i)
    const valores: Record<ClaveColumna, string | number | null> = {
      insumoExcel: g.insumo,
      unidadApu: g.unidad,
      veces: g.veces,
      items: g.items.sort(compararCodigo).join(", "),
      descripcion: descripcionMaestro(g.insumo),
      tipo: "",
      unidadCompra: unidadMaestro(g.unidad) ?? "",
      agrupacion: "",
      iva: 19,
      precio: null,
      contenido: null,
      unidadUso: "",
    }
    COLUMNAS_CARGA.forEach((c, k) => {
      const celda = fila.getCell(k + 1)
      celda.value = valores[c.clave]
      celda.alignment = { vertical: "top", wrapText: c.clave === "insumoExcel" || c.clave === "items" || c.clave === "descripcion" }
      if (k >= 4) celda.fill = gris
      const lista = desplegable[c.clave]
      if (lista) celda.dataValidation = { type: "list", allowBlank: true, formulae: [lista] }
    })
    fila.getCell(10).numFmt = "#,##0.##"
  })
  hoja.views = [{ state: "frozen", ySplit: primera, xSplit: 1 }]
  hoja.autoFilter = { from: { row: primera, column: 1 }, to: { row: primera + Math.max(grupos.length, 1), column: n } }

  // ---- detalle (referencia) ----
  const det = libro.addWorksheet(HOJA_DETALLE)
  const columnasDetalle = [
    ["Código ítem", 11],
    ["Ítem del presupuesto", 46],
    ["Unidad ítem", 10],
    ["Cantidad ítem", 12],
    ["Insumo (como viene en el Excel)", 48],
    ["Unidad insumo", 11],
    ["Cantidad por unidad del ítem", 14],
    ["Cantidad total", 14],
  ] as const
  const primeraDet = agregarEncabezadoMarca(libro, det, {
    titulo: `${nombreProyecto} — detalle de las líneas sin opción`,
    subtitulo: "Cantidad total = cantidad por unidad × cantidad del ítem.",
    numColumnas: columnasDetalle.length,
    bufferLogo: await obtenerBufferLogoConyca(),
  })
  columnasDetalle.forEach(([titulo, ancho], i) => {
    det.getColumn(i + 1).width = ancho
    const celda = det.getRow(primeraDet).getCell(i + 1)
    celda.value = titulo
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  det.getRow(primeraDet).height = 30
  const ordenadas = [...lineas].sort(
    (a, b) => a.insumo.localeCompare(b.insumo, "es") || compararCodigo(a.codigoItem, b.codigoItem)
  )
  ordenadas.forEach((l, i) => {
    const r = primeraDet + 1 + i
    const fila = det.getRow(r)
    fila.values = [l.codigoItem, l.item, l.unidadItem ?? "", l.cantidadItem, l.insumo.trim(), l.unidad ?? "", l.cantidad]
    fila.getCell(8).value = { formula: `D${r}*G${r}` }
    for (const k of [4, 7, 8]) fila.getCell(k).numFmt = "#,##0.####"
  })
  det.views = [{ state: "frozen", ySplit: primeraDet }]
  det.autoFilter = { from: { row: primeraDet, column: 1 }, to: { row: primeraDet + Math.max(ordenadas.length, 1), column: 8 } }

  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `insumos-sin-opcion-${new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

const textoCelda = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim())

function numeroCelda(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  return leerNumero(String(v))
}

/**
 * Lee la hoja "Insumos sin opción" (o la primera que tenga los encabezados):
 * busca la fila de encabezados por su texto, así no importa el bloque de
 * marca de arriba ni el orden de las columnas. Las filas sin insumo se saltan.
 */
export async function leerPlantillaInsumos(archivo: ArrayBuffer): Promise<FilaCargaInsumo[]> {
  const XLSX = await import("xlsx")
  const libro = XLSX.read(archivo, { type: "array" })
  const nombres = [HOJA_CARGA, ...libro.SheetNames.filter((n) => n !== HOJA_CARGA)]
  const titulo = (clave: ClaveColumna) => COLUMNAS_CARGA.find((c) => c.clave === clave)!.titulo.toLowerCase()
  for (const nombre of nombres) {
    const hoja = libro.Sheets[nombre]
    if (!hoja) continue
    const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null, blankrows: true })
    const iEnc = filas.findIndex((f) => f?.some((c) => textoCelda(c).toLowerCase() === titulo("insumoExcel")))
    if (iEnc < 0) continue
    const encabezados = (filas[iEnc] ?? []).map((c) => textoCelda(c).toLowerCase())
    const col = (clave: ClaveColumna) => encabezados.indexOf(titulo(clave))
    const faltan = COLUMNAS_CARGA.filter((c) => c.clave !== "veces" && c.clave !== "items" && col(c.clave) < 0)
    if (faltan.length > 0) {
      throw new Error(`Al archivo le faltan columnas: ${faltan.map((c) => c.titulo).join(", ")}. Usa la plantilla exportada.`)
    }
    const resultado: FilaCargaInsumo[] = []
    for (let i = iEnc + 1; i < filas.length; i++) {
      const f = filas[i] ?? []
      const v = (clave: ClaveColumna) => f[col(clave)]
      const insumoExcel = textoCelda(v("insumoExcel"))
      if (!insumoExcel) continue
      resultado.push({
        fila: i + 1,
        insumoExcel,
        unidadApu: textoCelda(v("unidadApu")),
        descripcion: textoCelda(v("descripcion")),
        tipo: textoCelda(v("tipo")),
        unidadCompra: textoCelda(v("unidadCompra")),
        agrupacion: textoCelda(v("agrupacion")),
        iva: numeroCelda(v("iva")),
        precio: numeroCelda(v("precio")),
        contenido: textoCelda(v("contenido")),
        unidadUso: textoCelda(v("unidadUso")),
      })
    }
    if (resultado.length === 0) throw new Error("La hoja no tiene insumos.")
    return resultado
  }
  throw new Error(`No se encontró la hoja "${HOJA_CARGA}". Usa la plantilla que se exporta en Revisar pendientes.`)
}
