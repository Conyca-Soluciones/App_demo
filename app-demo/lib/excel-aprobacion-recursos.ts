// Excel de Aprobación de mano de obra y equipos (2026-11-12): una fila por
// solicitud (actividad), con su capítulo y sus ítems. Se llenan actividad
// (nombre), grupo, unidad y valor para aprobar, o el motivo para rechazar, y
// se sube. Filas con el mismo nombre y unidad quedan en UNA categoría (si ya
// existe en el catálogo, se enlazan). Mismo patrón que el Excel de aprobación
// de insumos (lib/excel-precios-insumos.ts). leerFilasAprobacionRecursos y
// agruparAprobaciones son lógica pura (tests/excel-aprobacion-recursos.test.ts).
import { leerNumero } from "@/lib/contratos"
import { hoyColombia } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"
import { normalizarUnidad } from "@/lib/unidades"
import {
  capitulosDe,
  claveActividad,
  codigosItems,
  grupoDesdeCapitulo,
  unidadPropuesta,
  type SolicitudRecursoAprobar,
} from "@/lib/solicitudes-recurso"

export const COLUMNAS_APROBACION_RECURSOS = {
  capitulo: "Capítulo",
  actividad: "Actividad",
  items: "Ítems del presupuesto",
  grupo: "Grupo",
  unidad: "Unidad",
  valor: "Valor unitario sin IVA",
  motivo: "Rechazar: motivo",
  id: "ID interno -- NO BORRAR NI EDITAR",
} as const

type Clave = keyof typeof COLUMNAS_APROBACION_RECURSOS

const ORDEN: { clave: Clave; ancho: number; llenar?: boolean }[] = [
  { clave: "capitulo", ancho: 26 },
  { clave: "actividad", ancho: 60, llenar: true },
  { clave: "items", ancho: 30 },
  { clave: "grupo", ancho: 26, llenar: true },
  { clave: "unidad", ancho: 11, llenar: true },
  { clave: "valor", ancho: 16, llenar: true },
  { clave: "motivo", ancho: 36, llenar: true },
  { clave: "id", ancho: 38 },
]

export type FilaAprobacionRecurso =
  | { fila: number; solicitudId: string; actividad: string; accion: "aprobar"; grupo: string | null; unidad: string; valor: number }
  | { fila: number; solicitudId: string; actividad: string; accion: "rechazar"; motivo: string }

export type ErrorFilaRecurso = { fila: number; actividad: string; mensaje: string }

type FilaAprobar = Extract<FilaAprobacionRecurso, { accion: "aprobar" }>

// Fila sin valor ni motivo: se aprueba solo si otra fila con el MISMO nombre y
// unidad trae el valor (2026-11-13: cambiar el nombre de las 3 talas al mismo y
// poner el valor solo en la primera). Si no, se deja para después.
export type FilaSinValor = { fila: number; solicitudId: string; actividad: string; grupo: string | null; unidad: string }

const claveGrupo = (actividad: string, unidad: string) => `${claveActividad(actividad)}|${normalizarUnidad(unidad) ?? unidad.trim().toUpperCase()}`

// Las filas por aprobar que van en UNA categoría: mismo nombre (sin
// mayúsculas ni espacios de más) y misma unidad. Si en un grupo hay valores
// distintos, ninguna de sus filas se aprueba (sale como error). Las filas sin
// valor que comparten nombre y unidad con un grupo se suman a él con su valor.
export function agruparAprobaciones(
  filas: FilaAprobar[],
  sinValor: FilaSinValor[] = []
): {
  grupos: { nombre: string; unidad: string; grupo: string | null; valor: number; filas: FilaAprobar[] }[]
  errores: ErrorFilaRecurso[]
  // Filas sin valor que entraron a un grupo (ya no cuentan como "sin llenar").
  sumadasSinValor: number
} {
  const porClave = new Map<string, FilaAprobar[]>()
  for (const f of filas) {
    const clave = claveGrupo(f.actividad, f.unidad)
    const lista = porClave.get(clave) ?? []
    lista.push(f)
    porClave.set(clave, lista)
  }
  const sinValorPorClave = new Map<string, FilaSinValor[]>()
  for (const f of sinValor) {
    if (!f.actividad || !f.unidad) continue
    const clave = claveGrupo(f.actividad, f.unidad)
    if (!porClave.has(clave)) continue
    const lista = sinValorPorClave.get(clave) ?? []
    lista.push(f)
    sinValorPorClave.set(clave, lista)
  }
  const grupos: { nombre: string; unidad: string; grupo: string | null; valor: number; filas: FilaAprobar[] }[] = []
  const errores: ErrorFilaRecurso[] = []
  let sumadasSinValor = 0
  for (const [clave, lista] of porClave) {
    const extra = sinValorPorClave.get(clave) ?? []
    sumadasSinValor += extra.length
    const valores = new Set(lista.map((f) => f.valor))
    if (valores.size > 1) {
      const filasTexto = [...lista.map((f) => f.fila), ...extra.map((f) => f.fila)].sort((a, b) => a - b).join(", ")
      for (const f of [...lista, ...extra]) {
        errores.push({ fila: f.fila, actividad: f.actividad, mensaje: `Mismo nombre que las filas ${filasTexto} pero con otro valor: deja un solo valor.` })
      }
      continue
    }
    const primera = lista[0]
    const todas: FilaAprobar[] = [
      ...lista,
      ...extra.map((f) => ({ fila: f.fila, solicitudId: f.solicitudId, actividad: f.actividad, accion: "aprobar" as const, grupo: f.grupo, unidad: f.unidad, valor: primera.valor })),
    ].sort((a, b) => a.fila - b.fila)
    grupos.push({
      nombre: primera.actividad,
      unidad: primera.unidad,
      grupo: todas.find((f) => f.grupo)?.grupo ?? null,
      valor: primera.valor,
      filas: todas,
    })
  }
  return { grupos, errores, sumadasSinValor }
}

const normal = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")

const texto = (v: unknown) => (v == null ? "" : String(v).trim())

function numeroCelda(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  return leerNumero(String(v).replace(/\$/g, "").trim())
}

/**
 * Lee las filas como las da XLSX con `header: 1`. Busca el encabezado por el
 * "ID interno" y las columnas por nombre. Fila con valor = aprobar (pide
 * unidad); con motivo = rechazar; con las dos = error; sin nada = va a
 * `sinValor` (agruparAprobaciones la suma si otra fila con el mismo nombre y
 * unidad trae el valor; si no, se deja para después).
 */
export function leerFilasAprobacionRecursos(filas: unknown[][]): {
  filas: FilaAprobacionRecurso[]
  errores: ErrorFilaRecurso[]
  sinLlenar: number
  sinValor: FilaSinValor[]
} {
  const iEncabezado = filas.findIndex((f) => f.some((c) => normal(c).startsWith("id interno")))
  if (iEncabezado < 0) {
    throw new Error('No se encontró la columna "ID interno". Usa el Excel descargado desde la app, sin cambiar los encabezados.')
  }
  const encabezado = filas[iEncabezado].map(normal)
  const col = (k: Clave) =>
    k === "id" ? encabezado.findIndex((h) => h.startsWith("id interno")) : encabezado.indexOf(normal(COLUMNAS_APROBACION_RECURSOS[k]))
  const indices = Object.fromEntries((Object.keys(COLUMNAS_APROBACION_RECURSOS) as Clave[]).map((k) => [k, col(k)])) as Record<Clave, number>
  const obligatorias: Clave[] = ["actividad", "grupo", "unidad", "valor", "motivo", "id"]
  const faltan = obligatorias.filter((k) => indices[k] < 0).map((k) => `"${COLUMNAS_APROBACION_RECURSOS[k]}"`)
  if (faltan.length > 0) throw new Error(`Faltan las columnas ${faltan.join(", ")}. Usa el Excel descargado desde la app.`)
  const celda = (f: unknown[], k: Clave) => (indices[k] >= 0 ? f[indices[k]] : undefined)

  const resultado: FilaAprobacionRecurso[] = []
  const errores: ErrorFilaRecurso[] = []
  const vistos = new Set<string>()
  const sinValor: FilaSinValor[] = []
  let sinLlenar = 0

  for (let i = iEncabezado + 1; i < filas.length; i++) {
    const f = filas[i] ?? []
    const id = texto(celda(f, "id"))
    if (!id) continue
    const actividad = texto(celda(f, "actividad")).replace(/\s+/g, " ")
    const fila = i + 1
    const valorCrudo = texto(celda(f, "valor"))
    const motivo = texto(celda(f, "motivo"))
    if (!valorCrudo && !motivo) {
      sinLlenar++
      if (!vistos.has(id)) {
        vistos.add(id)
        const grupoSinValor = texto(celda(f, "grupo")).replace(/\s+/g, " ").toUpperCase()
        sinValor.push({ fila, solicitudId: id, actividad, grupo: grupoSinValor || null, unidad: texto(celda(f, "unidad")).toUpperCase() })
      }
      continue
    }
    const error = (mensaje: string) => errores.push({ fila, actividad, mensaje })
    if (vistos.has(id)) {
      error("La fila está repetida.")
      continue
    }
    vistos.add(id)
    if (valorCrudo && motivo) {
      error("Tiene valor y motivo de rechazo: deja solo uno.")
      continue
    }
    if (motivo) {
      resultado.push({ fila, solicitudId: id, actividad, accion: "rechazar", motivo })
      continue
    }
    if (!actividad) {
      error("Escribe el nombre de la actividad.")
      continue
    }
    const valor = numeroCelda(celda(f, "valor"))
    if (valor == null || valor <= 0) {
      error("El valor tiene que ser un número mayor que $0 (sin IVA).")
      continue
    }
    const unidad = texto(celda(f, "unidad")).toUpperCase()
    if (!unidad) {
      error("Escribe la unidad (M2, M3, UND, ML...).")
      continue
    }
    const grupo = texto(celda(f, "grupo")).replace(/\s+/g, " ").toUpperCase()
    resultado.push({ fila, solicitudId: id, actividad, accion: "aprobar", grupo: grupo || null, unidad, valor: Math.round(valor * 100) / 100 })
  }
  return { filas: resultado, errores, sinLlenar, sinValor }
}

// Instrucciones que van arriba de la tabla (decisión del usuario, 2026-11-12).
export const INSTRUCCIONES_EXCEL_RECURSOS = [
  "Cómo llenar este Excel",
  "1. En cada actividad que vas a aprobar, llena los campos amarillos: Actividad (nombre), Grupo, Unidad y Valor unitario sin IVA.",
  '2. Deja vacía la columna "Rechazar: motivo", salvo que vayas a rechazar esa actividad: en ese caso escribe ahí el motivo y deja el valor vacío.',
  "3. Si varias actividades son la misma (por ejemplo, las talas de árbol de distintos diámetros), cámbiales el nombre para que sea el mismo, con la misma unidad: quedarán conectadas en una sola categoría. Basta con poner el valor en una de ellas (si lo pones en varias, debe ser el mismo). Si ese nombre ya existe en el catálogo, se conectan a esa (con su mismo valor).",
  "4. Las filas sin valor ni motivo se dejan para después. No borres ni cambies la columna oculta del ID interno.",
]

/** El libro (sin descargarlo): separado para poder probarlo. */
export async function construirLibroAprobacionRecursos(
  titulo: string,
  solicitudes: SolicitudRecursoAprobar[],
  listas: { unidades: string[]; grupos: string[] },
  bufferLogo: ArrayBuffer | null
) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Por aprobar")
  const n = ORDEN.length
  const inicio = agregarEncabezadoMarca(libro, hoja, { titulo, numColumnas: n - 1, bufferLogo })

  // Instrucciones entre el logo y la tabla (la subida busca el encabezado por
  // el ID interno, así que no le afectan).
  const ultimaLetra = hoja.getColumn(n - 1).letter
  INSTRUCCIONES_EXCEL_RECURSOS.forEach((texto, k) => {
    const f = inicio + k
    hoja.mergeCells(`A${f}:${ultimaLetra}${f}`)
    const celda = hoja.getCell(`A${f}`)
    celda.value = texto
    celda.font = k === 0 ? { bold: true, size: 11 } : { size: 10 }
    celda.alignment = { vertical: "middle", horizontal: "left", wrapText: true }
    if (k > 0) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FB" } }
    hoja.getRow(f).height = k === 0 ? 18 : 30
  })
  const primera = inicio + INSTRUCCIONES_EXCEL_RECURSOS.length + 1

  // Listas de los desplegables en una hoja oculta. Grupo y unidad aceptan otro
  // valor (con aviso): el catálogo puede necesitar uno nuevo.
  const hojaListas = libro.addWorksheet("Listas", { state: "veryHidden" })
  const columnasListas = [listas.grupos, listas.unidades]
  columnasListas.forEach((valores, c) => valores.forEach((v, r) => (hojaListas.getRow(r + 1).getCell(c + 1).value = v)))
  const rango = (c: number) => {
    const letra = String.fromCharCode(65 + c)
    return `Listas!$${letra}$1:$${letra}$${Math.max(columnasListas[c].length, 1)}`
  }
  const listaDe: Partial<Record<Clave, string>> = { grupo: rango(0), unidad: rango(1) }

  ORDEN.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  ORDEN.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = COLUMNAS_APROBACION_RECURSOS[c.clave]
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
    if (c.clave === "actividad")
      celda.note =
        "Nombre con que entra al catálogo: se puede cambiar. Filas con el mismo nombre y unidad quedan en una sola categoría; si ya existe en el catálogo, se enlazan a esa (con el mismo valor)."
    if (c.clave === "grupo") celda.note = "Viene el capítulo del presupuesto. Se puede cambiar o elegir uno del catálogo."
    if (c.clave === "unidad") celda.note = "Viene la del ítem. La mano de obra se paga por esta unidad."
    if (c.clave === "valor") celda.note = "Llénalo para aprobar. Precio por la unidad, sin IVA."
    if (c.clave === "motivo") celda.note = "Llénalo solo para rechazar (y deja el valor vacío). El ingeniero lo ve en el presupuesto."
  })
  encabezado.height = 32

  solicitudes.forEach((s, k) => {
    const fila = hoja.getRow(primera + 1 + k)
    const valores: Record<Clave, string | number | null> = {
      capitulo: capitulosDe(s.items).join(" · "),
      actividad: s.descripcion.trim().replace(/\s+/g, " "),
      items: codigosItems(s.items),
      grupo: (s.grupoSugerido ?? "").trim().toUpperCase() || grupoDesdeCapitulo(s.items),
      unidad: unidadPropuesta(s.unidad, s.items),
      valor: s.valorPropuesto,
      motivo: null,
      id: s.id,
    }
    ORDEN.forEach((c, i) => {
      const celda = fila.getCell(i + 1)
      celda.value = valores[c.clave]
      if (c.llenar) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } }
      const lista = listaDe[c.clave]
      if (lista) {
        celda.dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [lista],
          showErrorMessage: true,
          errorStyle: "warning",
          errorTitle: "Valor fuera de la lista",
          error: "No está en la lista. Si es correcto, acéptalo.",
        }
      }
    })
    fila.getCell(ORDEN.findIndex((c) => c.clave === "valor") + 1).numFmt = "#,##0.##"
  })
  hoja.getColumn(n).hidden = true
  hoja.autoFilter = { from: { row: primera, column: 1 }, to: { row: primera + Math.max(solicitudes.length, 1), column: n - 1 } }
  hoja.views = [{ state: "frozen", xSplit: 2, ySplit: primera }]
  return libro
}

export async function descargarExcelAprobacionRecursos(
  tipo: "mano_obra" | "equipo",
  solicitudes: SolicitudRecursoAprobar[],
  listas: { unidades: string[]; grupos: string[] }
) {
  const titulo = tipo === "mano_obra" ? "Mano de obra por aprobar" : "Equipo por aprobar"
  const libro = await construirLibroAprobacionRecursos(titulo, solicitudes, listas, await obtenerBufferLogoConyca())
  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${tipo === "mano_obra" ? "mano-de-obra" : "equipo"}-por-aprobar-${hoyColombia()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
