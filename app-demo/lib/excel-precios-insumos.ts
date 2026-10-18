// Excel de las solicitudes de insumos nuevos (Aprobación de insumos).
// Presupuestos manda a aprobación los insumos que no encontró en el maestro;
// en Aprobación de insumos se descarga este Excel, se llena precio, IVA, tipo,
// unidad de compra y agrupación, y al subirlo cada fila completa se aprueba y
// entra al maestro (aprobarSolicitudInsumo).
//
// leerFilasPreciosInsumos es lógica pura (pruebas en
// tests/excel-precios-insumos.test.ts); descargarExcelPreciosInsumos arma el
// archivo en el navegador.

import { leerNumero } from "@/lib/contratos"
import { UNIDADES_DE_USO, UNIDADES_MAESTRO, unidadMaestro, validarPresentacion } from "@/lib/unidades"
import { ZONA_HORARIA } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"

export type SolicitudParaPrecio = {
  id: string
  descripcion: string
  // unidad en que lo pidió el presupuesto (la del Excel del APU)
  unidadPedida: string | null
  // total pedido en esa unidad (suma de las líneas del presupuesto)
  cantidad: number | null
  proyectos: string[]
  // lo que ya traiga la solicitud, solo si es válido (para prellenar)
  tipo: string | null
  uM: string | null
  agrupacion: string | null
}

export type ListasPreciosInsumos = {
  tipos: string[]
  agrupaciones: string[]
}

export type FilaPrecioInsumo = {
  // fila del Excel (para los mensajes de error)
  fila: number
  solicitudId: string
  descripcion: string
  vrUnitario: number
  ivaPorcentaje: number
  tipo: string
  uM: string
  agrupacion: string
  unidadUso: string | null
  contenido: number | null
}

export type ErrorFilaPrecio = { fila: number; insumo: string; mensaje: string }

export const IVAS_EXCEL = [0, 5, 19]

export const COLUMNAS_PRECIOS_INSUMOS = {
  insumo: "Insumo",
  unidadPedida: "Unidad del presupuesto",
  cantidad: "Cantidad pedida",
  proyectos: "Proyectos",
  tipo: "Tipo",
  uM: "Unidad de compra",
  agrupacion: "Agrupación",
  precio: "Precio unitario sin IVA",
  iva: "IVA %",
  unidadUso: "Presentación: unidad de uso",
  contenido: "Presentación: cuánto trae",
  id: "ID interno -- NO BORRAR NI EDITAR",
} as const

type ClaveColumna = keyof typeof COLUMNAS_PRECIOS_INSUMOS

const ORDEN: { clave: ClaveColumna; ancho: number; llenar?: boolean }[] = [
  { clave: "insumo", ancho: 48 },
  { clave: "unidadPedida", ancho: 14 },
  { clave: "cantidad", ancho: 14 },
  { clave: "proyectos", ancho: 22 },
  { clave: "tipo", ancho: 24, llenar: true },
  { clave: "uM", ancho: 26, llenar: true },
  { clave: "agrupacion", ancho: 36, llenar: true },
  { clave: "precio", ancho: 18, llenar: true },
  { clave: "iva", ancho: 9, llenar: true },
  { clave: "unidadUso", ancho: 18, llenar: true },
  { clave: "contenido", ancho: 16, llenar: true },
  { clave: "id", ancho: 38 },
]

const normal = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")

function texto(v: unknown): string {
  return v == null ? "" : String(v).trim()
}

function numeroCelda(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  return leerNumero(String(v))
}

/**
 * Lee las filas del Excel (como las da XLSX con `header: 1`: listas de
 * celdas). Busca la fila de encabezados por el "ID interno" (el archivo trae
 * el logo arriba) y las columnas por NOMBRE, así se pueden mover. Las filas
 * sin precio se saltan (el archivo se puede llenar de a poco); las que
 * tienen precio deben venir completas y válidas o salen como error.
 */
export function leerFilasPreciosInsumos(
  filas: unknown[][],
  listas: ListasPreciosInsumos
): { filas: FilaPrecioInsumo[]; errores: ErrorFilaPrecio[]; sinPrecio: number } {
  const iEncabezado = filas.findIndex((f) => f.some((c) => normal(c).startsWith("id interno")))
  if (iEncabezado < 0) {
    throw new Error(
      'No se encontró la columna "ID interno". Usa el Excel descargado desde la app, sin cambiar los encabezados.'
    )
  }
  const encabezado = filas[iEncabezado].map(normal)
  const col = (clave: ClaveColumna) => {
    const buscado = normal(COLUMNAS_PRECIOS_INSUMOS[clave])
    return clave === "id" ? encabezado.findIndex((h) => h.startsWith("id interno")) : encabezado.indexOf(buscado)
  }
  const indices = Object.fromEntries(
    (Object.keys(COLUMNAS_PRECIOS_INSUMOS) as ClaveColumna[]).map((k) => [k, col(k)])
  ) as Record<ClaveColumna, number>
  const obligatorias: ClaveColumna[] = ["insumo", "tipo", "uM", "agrupacion", "precio", "iva", "id"]
  const faltan = obligatorias.filter((k) => indices[k] < 0).map((k) => `"${COLUMNAS_PRECIOS_INSUMOS[k]}"`)
  if (faltan.length > 0) {
    throw new Error(`Faltan las columnas ${faltan.join(", ")}. Usa el Excel descargado desde la app.`)
  }

  const tipoPorNombre = new Map(listas.tipos.map((t) => [normal(t), t]))
  const agrupacionPorNombre = new Map(listas.agrupaciones.map((a) => [normal(a), a]))
  const celda = (f: unknown[], k: ClaveColumna) => (indices[k] >= 0 ? f[indices[k]] : undefined)

  const resultado: FilaPrecioInsumo[] = []
  const errores: ErrorFilaPrecio[] = []
  const vistos = new Set<string>()
  let sinPrecio = 0

  for (let i = iEncabezado + 1; i < filas.length; i++) {
    const f = filas[i] ?? []
    const id = texto(celda(f, "id"))
    if (!id) continue // fila vacía
    const insumo = texto(celda(f, "insumo"))
    const numeroFila = i + 1
    const precioCrudo = celda(f, "precio")
    if (precioCrudo == null || texto(precioCrudo) === "") {
      sinPrecio++
      continue
    }
    const error = (mensaje: string) => errores.push({ fila: numeroFila, insumo, mensaje })

    if (vistos.has(id)) {
      error("La fila está repetida.")
      continue
    }
    vistos.add(id)

    const precio = numeroCelda(precioCrudo)
    if (precio == null || precio <= 1) {
      error("El precio tiene que ser un número mayor que $1 (sin IVA).")
      continue
    }
    const ivaCrudo = texto(celda(f, "iva")).replace("%", "")
    const iva = ivaCrudo === "" ? null : numeroCelda(ivaCrudo)
    if (iva == null || !IVAS_EXCEL.includes(iva)) {
      error("El IVA tiene que ser 0, 5 o 19.")
      continue
    }
    const tipo = tipoPorNombre.get(normal(celda(f, "tipo")))
    if (!tipo) {
      error("Elige el tipo de la lista.")
      continue
    }
    const uM = unidadMaestro(texto(celda(f, "uM")))
    if (!uM) {
      error("Elige la unidad de compra de la lista.")
      continue
    }
    const agrupacion = agrupacionPorNombre.get(normal(celda(f, "agrupacion")))
    if (!agrupacion) {
      error("Elige la agrupación de la lista.")
      continue
    }
    let presentacion: { unidadUso: string; contenido: number } | null
    try {
      const contenidoCrudo = celda(f, "contenido")
      const contenido = typeof contenidoCrudo === "number" ? contenidoCrudo : numeroCelda(contenidoCrudo) ?? texto(contenidoCrudo)
      presentacion = validarPresentacion(texto(celda(f, "unidadUso")), contenido)
    } catch (e) {
      error(e instanceof Error ? e.message : "La presentación no es válida.")
      continue
    }

    resultado.push({
      fila: numeroFila,
      solicitudId: id,
      descripcion: insumo,
      vrUnitario: Math.round(precio * 100) / 100,
      ivaPorcentaje: iva,
      tipo,
      uM,
      agrupacion,
      unidadUso: presentacion?.unidadUso ?? null,
      contenido: presentacion?.contenido ?? null,
    })
  }

  return { filas: resultado, errores, sinPrecio }
}

const formatoCantidad = (n: number) => (Number.isInteger(n) ? "#,##0" : "#,##0.##")

/** El libro del Excel (sin descargarlo): separado para poder probarlo. */
export async function construirLibroPreciosInsumos(
  solicitudes: SolicitudParaPrecio[],
  listas: ListasPreciosInsumos,
  bufferLogo: ArrayBuffer | null
) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Insumos nuevos")
  const n = ORDEN.length

  const primera = agregarEncabezadoMarca(libro, hoja, {
    titulo: "Solicitudes de insumos nuevos",
    numColumnas: n - 1,
    bufferLogo,
  })

  // Listas para los desplegables, en una hoja oculta.
  const hojaListas = libro.addWorksheet("Listas", { state: "veryHidden" })
  const columnasListas: string[][] = [
    listas.tipos,
    UNIDADES_MAESTRO.map((u) => u.texto),
    listas.agrupaciones,
    IVAS_EXCEL.map(String),
    UNIDADES_DE_USO.map((u) => u.codigo),
  ]
  columnasListas.forEach((valores, c) => valores.forEach((v, r) => (hojaListas.getRow(r + 1).getCell(c + 1).value = v)))
  const rango = (c: number) => {
    const letra = String.fromCharCode(65 + c)
    return `Listas!$${letra}$1:$${letra}$${Math.max(columnasListas[c].length, 1)}`
  }
  const listaDe: Partial<Record<ClaveColumna, string>> = {
    tipo: rango(0),
    uM: rango(1),
    agrupacion: rango(2),
    iva: rango(3),
    unidadUso: rango(4),
  }

  ORDEN.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  ORDEN.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = COLUMNAS_PRECIOS_INSUMOS[c.clave]
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
  })
  encabezado.height = 32

  const tipos = new Set(listas.tipos)
  const agrupaciones = new Set(listas.agrupaciones)
  solicitudes.forEach((s, k) => {
    const fila = hoja.getRow(primera + 1 + k)
    const valores: Record<ClaveColumna, string | number | null> = {
      insumo: s.descripcion,
      unidadPedida: s.unidadPedida ?? "",
      cantidad: s.cantidad,
      proyectos: s.proyectos.join(", "),
      tipo: s.tipo && tipos.has(s.tipo) ? s.tipo : "",
      uM: unidadMaestro(s.uM ?? s.unidadPedida) ?? "",
      agrupacion: s.agrupacion && agrupaciones.has(s.agrupacion) ? s.agrupacion : "",
      precio: null,
      iva: 19,
      unidadUso: "",
      contenido: null,
      id: s.id,
    }
    ORDEN.forEach((c, i) => {
      const celda = fila.getCell(i + 1)
      celda.value = valores[c.clave]
      if (c.llenar) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } }
      const lista = listaDe[c.clave]
      if (lista) celda.dataValidation = { type: "list", allowBlank: true, formulae: [lista] }
    })
    if (s.cantidad != null) fila.getCell(3).numFmt = formatoCantidad(s.cantidad)
    fila.getCell(8).numFmt = "#,##0.00"
  })
  // La columna del ID es la llave al subir el archivo: oculta.
  hoja.getColumn(n).hidden = true

  hoja.views = [{ state: "frozen", ySplit: primera }]
  return libro
}

export async function descargarExcelPreciosInsumos(solicitudes: SolicitudParaPrecio[], listas: ListasPreciosInsumos) {
  const libro = await construirLibroPreciosInsumos(solicitudes, listas, await obtenerBufferLogoConyca())
  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `solicitudes-insumos-${new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
