// Excel de las solicitudes de insumos nuevos (Aprobación de insumos).
// Presupuestos manda a aprobación los insumos que no encontró en el maestro;
// en Aprobación de insumos se descarga este Excel, se corrige el nombre si
// hace falta y se llena tipo, agrupación, IVA y precio unitario; al subirlo
// cada fila completa se aprueba y entra al maestro (aprobarSolicitudInsumo).
// La unidad es la de COMPRA y el precio es por esa unidad; viene la del
// presupuesto. Si se cambia (m -> rollo), el ingeniero confirma la conversión
// en su presupuesto.
//
// leerFilasPreciosInsumos es lógica pura (pruebas en
// tests/excel-precios-insumos.test.ts); descargarExcelPreciosInsumos arma el
// archivo en el navegador.

import { leerNumero } from "@/lib/contratos"
import { UNIDADES_MAESTRO, unidadMaestro } from "@/lib/unidades"
import { hoyColombia } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"

export type SolicitudParaPrecio = {
  id: string
  descripcion: string
  // unidad en que lo pidió el presupuesto (la del Excel del APU)
  unidadPedida: string | null
  // por unidad del ítem, en esa unidad (suma de lo que pide cada línea del APU)
  cantidad: number | null
  // lo que hace falta para todo el presupuesto: cada línea × la cantidad de su
  // ítem (ej. 100 adaptadores). null = no se pudo calcular.
  cantidadTotal: number | null
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
  // nombre con que entra al maestro (la columna Insumo, editable)
  descripcion: string
  vrUnitario: number
  ivaPorcentaje: number
  tipo: string
  uM: string
  agrupacion: string
}

export type ErrorFilaPrecio = { fila: number; insumo: string; mensaje: string }

export const IVAS_EXCEL = [0, 5, 19]

export const COLUMNAS_PRECIOS_INSUMOS = {
  insumo: "Insumo",
  unidadPedida: "Unidad del presupuesto",
  cantidad: "Cantidad por unidad del ítem",
  cantidadTotal: "Cantidad total en el presupuesto",
  proyectos: "Proyectos",
  tipo: "Tipo",
  uM: "Unidad de compra",
  agrupacion: "Agrupación",
  precio: "Precio por unidad de compra sin IVA",
  iva: "IVA %",
  id: "ID interno -- NO BORRAR NI EDITAR",
} as const

type ClaveColumna = keyof typeof COLUMNAS_PRECIOS_INSUMOS

const ORDEN: { clave: ClaveColumna; ancho: number; llenar?: boolean }[] = [
  { clave: "insumo", ancho: 48, llenar: true },
  { clave: "unidadPedida", ancho: 14 },
  { clave: "cantidad", ancho: 14 },
  { clave: "cantidadTotal", ancho: 16 },
  { clave: "proyectos", ancho: 22 },
  { clave: "tipo", ancho: 24, llenar: true },
  { clave: "uM", ancho: 26, llenar: true },
  { clave: "agrupacion", ancho: 36, llenar: true },
  { clave: "precio", ancho: 18, llenar: true },
  { clave: "iva", ancho: 9, llenar: true },
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
    if (!insumo) {
      error("Escribe el nombre del insumo.")
      continue
    }

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
    resultado.push({
      fila: numeroFila,
      solicitudId: id,
      descripcion: insumo,
      vrUnitario: Math.round(precio * 100) / 100,
      ivaPorcentaje: iva,
      tipo,
      uM,
      agrupacion,
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
  }

  ORDEN.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  ORDEN.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = COLUMNAS_PRECIOS_INSUMOS[c.clave]
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
    if (c.clave === "insumo") celda.note = "Nombre con que entra al maestro: se puede corregir."
    if (c.clave === "uM") {
      celda.note =
        "En la que se compra y se pone el precio. Viene la del presupuesto; si se compra por rollo, bulto o unidad, cámbiala y escribe en el nombre cuánto trae (ej. ROLLO X 100 M). El ingeniero confirma la conversión en su presupuesto."
    }
    if (c.clave === "precio") celda.note = "Precio por la unidad de compra, sin IVA."
    if (c.clave === "cantidad") celda.note = "Lo que pide el APU por cada unidad del ítem (sumado entre los ítems que lo usan)."
    if (c.clave === "cantidadTotal")
      celda.note = "Lo que hace falta para todo el presupuesto: cantidad del APU × cantidad de cada ítem, sumado. En la unidad del presupuesto."
  })
  encabezado.height = 32

  const tipos = new Set(listas.tipos)
  const agrupaciones = new Set(listas.agrupaciones)
  solicitudes.forEach((s, k) => {
    const fila = hoja.getRow(primera + 1 + k)
    const valores: Record<ClaveColumna, string | number | null> = {
      insumo: s.descripcion.trim().replace(/\s+/g, " ").toUpperCase(),
      unidadPedida: s.unidadPedida ?? "",
      cantidad: s.cantidad,
      cantidadTotal: s.cantidadTotal,
      proyectos: s.proyectos.join(", "),
      tipo: s.tipo && tipos.has(s.tipo) ? s.tipo : "",
      // por defecto, la del presupuesto
      uM: unidadMaestro(s.unidadPedida) ?? "",
      agrupacion: s.agrupacion && agrupaciones.has(s.agrupacion) ? s.agrupacion : "",
      precio: null,
      iva: 19,
      id: s.id,
    }
    ORDEN.forEach((c, i) => {
      const celda = fila.getCell(i + 1)
      celda.value = valores[c.clave]
      if (c.llenar) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } }
      const lista = listaDe[c.clave]
      if (lista) celda.dataValidation = { type: "list", allowBlank: true, formulae: [lista] }
    })
    const columna = (clave: ClaveColumna) => ORDEN.findIndex((c) => c.clave === clave) + 1
    if (s.cantidad != null) fila.getCell(columna("cantidad")).numFmt = formatoCantidad(s.cantidad)
    if (s.cantidadTotal != null) fila.getCell(columna("cantidadTotal")).numFmt = formatoCantidad(s.cantidadTotal)
    fila.getCell(columna("precio")).numFmt = "#,##0.00"
  })
  // La columna del ID es la llave al subir el archivo: oculta.
  hoja.getColumn(n).hidden = true

  // Encabezados y la columna del nombre fijos al moverse. El logo venía en
  // A:B combinadas; se deja solo en A para que la columna fija no lo parta.
  const filasMarca = primera - 2
  hoja.unMergeCells(`A1:B${filasMarca}`)
  hoja.mergeCells(`A1:A${filasMarca}`)
  hoja.views = [{ state: "frozen", xSplit: 1, ySplit: primera }]
  return libro
}

export async function descargarExcelPreciosInsumos(solicitudes: SolicitudParaPrecio[], listas: ListasPreciosInsumos) {
  const libro = await construirLibroPreciosInsumos(solicitudes, listas, await obtenerBufferLogoConyca())
  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `solicitudes-insumos-${hoyColombia()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
