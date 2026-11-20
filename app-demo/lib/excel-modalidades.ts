// Excel de modalidades (2026-11-16, paso 4; ver lib/modalidades.ts): se baja
// con los ítems del presupuesto actual, se llenan Modalidad y Mano de obra, y
// se sube para aplicarlas sin volver a importar el presupuesto. Lo resuelto
// del APU se conserva (fijar_modalidades_presupuesto).
// leerFilasModalidades es lógica pura (tests/excel-modalidades.test.ts).
import { leerNumero } from "@/lib/contratos"
import { hoyColombia } from "@/lib/fechas"
import { AZUL_MARCA_CONYCA, agregarEncabezadoMarca, obtenerBufferLogoConyca } from "@/lib/marca-conyca"
import { leerModalidad, MODALIDADES, NOMBRE_MODALIDAD, type FilaModalidad, type Modalidad } from "@/lib/modalidades"

// Lo que trae info_modalidades_version por ítem hoja.
export type ItemInfoModalidad = {
  codigo: string
  descripcion: string
  unidad: string | null
  precioOficial: number | null
  modalidad: Modalidad | null
  manoObraOficial: number | null
  herramientaMenorPct: number | null // la del oficial, si se guardó
  herramientaMenorApu: number | null // la de la línea del APU
  tieneManoObra: boolean
  conInsumos: boolean
  conMovimientos: boolean // requisiciones o contratos: ya no cambia
}

export const COLUMNAS_MODALIDADES = {
  codigo: "Código",
  descripcion: "Descripción",
  unidad: "Unidad",
  precio: "Precio oficial",
  insumos: "¿Tiene insumos?",
  manoObra: "¿Tiene mano de obra?",
  herramienta: "Herramienta menor %",
  modalidad: "Modalidad",
  valorManoObra: "Mano de obra",
} as const

type Clave = keyof typeof COLUMNAS_MODALIDADES

const ORDEN: { clave: Clave; ancho: number; llenar?: boolean }[] = [
  { clave: "codigo", ancho: 11 },
  { clave: "descripcion", ancho: 60 },
  { clave: "unidad", ancho: 9 },
  { clave: "precio", ancho: 15, llenar: true },
  { clave: "insumos", ancho: 11 },
  { clave: "manoObra", ancho: 12 },
  { clave: "herramienta", ancho: 12 },
  { clave: "modalidad", ancho: 26, llenar: true },
  { clave: "valorManoObra", ancho: 16, llenar: true },
]

export const INSTRUCCIONES_EXCEL_MODALIDADES = [
  "Cómo llenar este Excel",
  `1. En cada ítem elige la Modalidad (amarillo): ${MODALIDADES.map((m) => NOMBRE_MODALIDAD[m]).join(", ")}. Vacía = Administración.`,
  "2. Si eliges Administración o Subcontrato mano de obra, escribe la Mano de obra: el valor unitario oficial de la mano de obra del ítem, SIN herramienta menor (la app la suma con el % del ítem). Si el ítem no tiene mano de obra, déjala vacía.",
  "3. Subcontrato todo costo: el ítem vale el % de todo costo del proyecto sobre el precio oficial. Subcontrato mano de obra sin insumos: 50 % de mano de obra + herramienta menor; con insumos, la mano de obra sale del catálogo. Administración: 100 % de mano de obra + herramienta menor.",
  "4. Subcontrato mano de obra en un ítem sin mano de obra en su APU (ej. suministro e instalación): se le agrega una línea de mano de obra para elegirla del catálogo en Revisar pendientes.",
  "5. El Precio oficial también se puede ajustar (por ejemplo, a la propuesta): al subirlo se actualiza y queda en el historial.",
  "6. No cambies los códigos. Al subirlo verás un resumen antes de aplicar; lo ya resuelto del APU se conserva.",
]

const sinTildes = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")

const texto = (v: unknown) => (v == null ? "" : String(v).trim())

function numeroCelda(v: unknown): number | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  const limpio = String(v).replace(/\$/g, "").replace(/\s/g, "").trim()
  return limpio === "" ? null : leerNumero(limpio)
}

// filaExcel: para los mensajes. vacia: la celda Modalidad venía vacía (cuenta
// como Administración, pero un ítem con requisiciones o contratos que se deja
// así no se toca: ver filasParaAplicar).
export type FilaModalidadExcel = FilaModalidad & { filaExcel: number; vacia: boolean }

// Las filas que se mandan a la base: se quitan las de ítems con requisiciones o
// contratos que se dejaron como estaban (Modalidad vacía o la misma que ya
// tienen). Si se les pone otra modalidad, sí van, y la base dice que no cambia.
export function filasParaAplicar(
  filas: FilaModalidadExcel[],
  infoPorCodigo: Map<string, Pick<ItemInfoModalidad, "conMovimientos" | "modalidad">>
): { filas: FilaModalidadExcel[]; saltadas: number } {
  const resultado: FilaModalidadExcel[] = []
  let saltadas = 0
  for (const f of filas) {
    const info = infoPorCodigo.get(f.codigo)
    if (info?.conMovimientos && (f.vacia || f.modalidad === info.modalidad)) {
      saltadas++
      continue
    }
    resultado.push(f)
  }
  return { filas: resultado, saltadas }
}

// El mensaje de la base, más claro cuando la Modalidad venía vacía.
export function mensajeErrorModalidad(fila: FilaModalidadExcel | undefined, error: string): string {
  if (fila?.vacia && error === "falta la mano de obra oficial")
    return "falta la mano de obra oficial (la Modalidad está vacía y cuenta como Administración)"
  return error
}

/**
 * Lee las filas como las da XLSX con `header: 1` (valores crudos: los
 * números llegan como número; el código se escribe como texto, así "1.10" no
 * se vuelve 1.1). Busca el encabezado
 * por "Código" y "Modalidad". Modalidad vacía = Administración; una que no se
 * reconoce es error. La mano de obra solo se manda si la celda tiene algo
 * (vacía = se deja la que ya tenga el ítem).
 */
export function leerFilasModalidades(filas: unknown[][]): { filas: FilaModalidadExcel[]; errores: string[] } {
  const iEncabezado = filas.findIndex((f) => {
    const n = (f ?? []).map(sinTildes)
    return n.includes(sinTildes(COLUMNAS_MODALIDADES.codigo)) && n.includes(sinTildes(COLUMNAS_MODALIDADES.modalidad))
  })
  if (iEncabezado < 0) {
    throw new Error('No se encontraron las columnas "Código" y "Modalidad". Usa el Excel descargado desde la app.')
  }
  const encabezado = filas[iEncabezado].map(sinTildes)
  const col = (k: Clave) => encabezado.indexOf(sinTildes(COLUMNAS_MODALIDADES[k]))
  const iCodigo = col("codigo")
  const iModalidad = col("modalidad")
  const iManoObra = col("valorManoObra")
  const iPrecio = col("precio")

  const resultado: FilaModalidadExcel[] = []
  const errores: string[] = []
  const vistos = new Set<string>()
  for (let i = iEncabezado + 1; i < filas.length; i++) {
    const f = filas[i] ?? []
    const codigo = texto(f[iCodigo])
    if (!codigo) continue
    const filaExcel = i + 1
    const error = (m: string) => errores.push(`  Fila ${filaExcel} (ítem ${codigo}): ${m}`)
    if (vistos.has(codigo)) {
      error("el código está repetido en el Excel")
      continue
    }
    vistos.add(codigo)
    const textoModalidad = texto(f[iModalidad])
    const modalidad = leerModalidad(textoModalidad)
    if (!modalidad) {
      error(`la modalidad "${textoModalidad}" no se reconoce`)
      continue
    }
    const crudo = iManoObra >= 0 ? f[iManoObra] : null
    const manoObra = numeroCelda(crudo)
    if (texto(crudo) !== "" && manoObra == null) {
      error(`la mano de obra "${texto(crudo)}" no es un número`)
      continue
    }
    if (manoObra != null && manoObra < 0) {
      error("la mano de obra no puede ser negativa")
      continue
    }
    const crudoPrecio = iPrecio >= 0 ? f[iPrecio] : null
    const precio = numeroCelda(crudoPrecio)
    if (texto(crudoPrecio) !== "" && (precio == null || precio <= 0)) {
      error(`el precio oficial "${texto(crudoPrecio)}" no es un número mayor que cero`)
      continue
    }
    resultado.push({
      filaExcel,
      vacia: textoModalidad === "",
      codigo,
      modalidad,
      ...(manoObra != null ? { mano_obra_oficial: Math.round(manoObra * 100) / 100 } : {}),
      ...(precio != null ? { precio_oficial: Math.round(precio * 100) / 100 } : {}),
    })
  }
  return { filas: resultado, errores }
}

/** El libro (sin descargarlo): separado para poder probarlo. */
export async function construirLibroModalidades(titulo: string, items: ItemInfoModalidad[], bufferLogo: ArrayBuffer | null) {
  const ExcelJS = (await import("exceljs")).default
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet("Modalidades")
  const n = ORDEN.length
  const inicio = agregarEncabezadoMarca(libro, hoja, { titulo, numColumnas: n, bufferLogo })

  const ultimaLetra = hoja.getColumn(n).letter
  INSTRUCCIONES_EXCEL_MODALIDADES.forEach((t, k) => {
    const f = inicio + k
    hoja.mergeCells(`A${f}:${ultimaLetra}${f}`)
    const celda = hoja.getCell(`A${f}`)
    celda.value = t
    celda.font = k === 0 ? { bold: true, size: 11 } : { size: 10 }
    celda.alignment = { vertical: "middle", horizontal: "left", wrapText: true }
    if (k > 0) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FB" } }
    hoja.getRow(f).height = k === 0 ? 18 : 30
  })
  const primera = inicio + INSTRUCCIONES_EXCEL_MODALIDADES.length + 1

  const hojaListas = libro.addWorksheet("Listas", { state: "veryHidden" })
  MODALIDADES.forEach((m, r) => (hojaListas.getRow(r + 1).getCell(1).value = NOMBRE_MODALIDAD[m]))
  const rangoModalidades = `Listas!$A$1:$A$${MODALIDADES.length}`

  ORDEN.forEach((c, i) => (hoja.getColumn(i + 1).width = c.ancho))
  const encabezado = hoja.getRow(primera)
  ORDEN.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1)
    celda.value = COLUMNAS_MODALIDADES[c.clave]
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } }
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MARCA_CONYCA } }
    celda.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
    if (c.clave === "modalidad") celda.note = "Elige de la lista. Vacía = Administración."
    if (c.clave === "valorManoObra")
      celda.note = "Valor unitario oficial de la mano de obra del ítem, SIN herramienta menor. Va siempre que la modalidad sea Administración o Subcontrato mano de obra."
    if (c.clave === "herramienta") celda.note = "Herramienta menor del ítem en el APU (% de la mano de obra)."
  })
  encabezado.height = 32

  items.forEach((it, k) => {
    const fila = hoja.getRow(primera + 1 + k)
    const valores: Record<Clave, string | number | null> = {
      codigo: it.codigo,
      descripcion: it.descripcion,
      unidad: it.unidad,
      precio: it.precioOficial,
      insumos: it.conInsumos ? "Sí" : "No",
      manoObra: it.tieneManoObra ? "Sí" : "No",
      herramienta: it.herramientaMenorPct ?? it.herramientaMenorApu,
      modalidad: it.modalidad ? NOMBRE_MODALIDAD[it.modalidad] : "",
      valorManoObra: it.manoObraOficial,
    }
    ORDEN.forEach((c, i) => {
      const celda = fila.getCell(i + 1)
      celda.value = valores[c.clave]
      if (c.llenar && !it.conMovimientos) celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } }
      if (!c.llenar) celda.font = { color: { argb: "FF595959" } }
    })
    if (it.conMovimientos)
      fila.getCell(ORDEN.findIndex((c) => c.clave === "modalidad") + 1).note =
        "Ya tiene requisiciones o contratos: su modalidad no cambia."
    // El código va como texto: "1.10" no se vuelve 1.1.
    fila.getCell(1).numFmt = "@"
    fila.getCell(ORDEN.findIndex((c) => c.clave === "precio") + 1).numFmt = "$ #,##0"
    fila.getCell(ORDEN.findIndex((c) => c.clave === "valorManoObra") + 1).numFmt = "#,##0.##"
    fila.getCell(ORDEN.findIndex((c) => c.clave === "modalidad") + 1).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [rangoModalidades],
      showErrorMessage: true,
      errorStyle: "stop",
      errorTitle: "Modalidad fuera de la lista",
      error: `Elige: ${MODALIDADES.map((m) => NOMBRE_MODALIDAD[m]).join(", ")} (vacía = Administración).`,
    }
  })
  hoja.autoFilter = { from: { row: primera, column: 1 }, to: { row: primera + Math.max(items.length, 1), column: n } }
  hoja.views = [{ state: "frozen", xSplit: 2, ySplit: primera }]
  return libro
}

export async function descargarExcelModalidades(nombreProyecto: string, items: ItemInfoModalidad[]) {
  const libro = await construirLibroModalidades(`Modalidades — ${nombreProyecto}`, items, await obtenerBufferLogoConyca())
  const buffer = await libro.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `modalidades-${nombreProyecto.replace(/[^\w-]+/g, "_")}-${hoyColombia()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
