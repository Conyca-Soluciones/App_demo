// Modalidad de ejecución de cada ítem del presupuesto (20270101003900,
// decisión del usuario 2026-11-16). El cálculo de verdad lo hace la base
// (_aplicar_modalidad_item); esto es lo mismo en TypeScript para la pantalla,
// el Excel y las pruebas. Si cambia una regla, cambiar los dos.
//
//   todo_costo     valor del ítem = % del proyecto × precio oficial
//   mano_obra      sin insumos: mano de obra = 50 % × (MO oficial + herramienta menor)
//                  con insumos: mano de obra del catálogo, como siempre
//   administracion mano de obra = 100 % × (MO oficial + herramienta menor)
//   null           sin modalidad: como antes

export type Modalidad = "administracion" | "todo_costo" | "mano_obra"

export const MODALIDADES: readonly Modalidad[] = ["administracion", "todo_costo", "mano_obra"]

// Textos de la lista desplegable del Excel y de la pantalla.
export const NOMBRE_MODALIDAD: Record<Modalidad, string> = {
  administracion: "Administración",
  todo_costo: "Subcontrato todo costo",
  mano_obra: "Subcontrato mano de obra",
}

// Para etiquetas pequeñas (tabla del presupuesto).
export const NOMBRE_CORTO_MODALIDAD: Record<Modalidad, string> = {
  administracion: "Administración",
  todo_costo: "Todo costo",
  mano_obra: "Subc. mano de obra",
}

// Línea de valor fijo del APU (item_apu.concepto_fijo).
export type ConceptoFijo = "todo_costo" | "mano_obra_subcontrato" | "mano_obra_administracion"

export const NOMBRE_CONCEPTO_FIJO: Record<ConceptoFijo, string> = {
  todo_costo: "Subcontrato a todo costo",
  mano_obra_subcontrato: "Mano de obra subcontratada",
  mano_obra_administracion: "Mano de obra por administración",
}

export const esConceptoFijo = (v: unknown): v is ConceptoFijo =>
  v === "todo_costo" || v === "mano_obra_subcontrato" || v === "mano_obra_administracion"

export const esConceptoManoObra = (c: ConceptoFijo | null | undefined) =>
  c === "mano_obra_subcontrato" || c === "mano_obra_administracion"

export const esModalidad = (v: unknown): v is Modalidad =>
  v === "administracion" || v === "todo_costo" || v === "mano_obra"

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")

// Lee la celda "Modalidad" del Excel. Vacía = Administración (decisión del
// usuario). Acepta el texto de la lista y variantes ("todo costo", "MO",
// "admin"...). Devuelve null si no la reconoce.
export function leerModalidad(valor: unknown): Modalidad | null {
  const texto = sinTildes(String(valor ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  if (texto === "") return "administracion"
  if (texto.startsWith("admin")) return "administracion"
  if (texto.includes("todo costo") || texto === "tc") return "todo_costo"
  if (texto.includes("mano de obra") || texto === "mo" || texto === "subcontrato mo") return "mano_obra"
  return null
}

// % de herramienta menor que dice el nombre de la línea del APU
// ("Herramienta menor 10% M.O. AA" -> 10). null si la línea no lo dice.
export function porcentajeHerramientaMenor(descripcion: string): number | null {
  const texto = sinTildes(descripcion).toLowerCase()
  if (!texto.includes("herramienta menor")) return null
  const m = texto.match(/(\d+(?:[.,]\d+)?)\s*%/)
  return m ? Number(m[1].replace(",", ".")) : null
}

const redondear2 = (n: number) => Math.round(n * 100) / 100

export type DatosModalidadItem = {
  modalidad: Modalidad | null
  precioOficial: number | null
  topeTodoCostoPct: number | null
  manoObraOficial: number | null
  herramientaMenorPct: number | null
  tieneManoObra: boolean
  conInsumos: boolean
}

export type LineaFija = { concepto: ConceptoFijo; valor: number }

// La línea fija que le toca al ítem, o null si su modalidad no usa una
// (sin modalidad, subcontrato de mano de obra con insumos, administración sin
// mano de obra). Lanza un Error con el motivo si faltan datos.
export function lineaFijaModalidad(d: DatosModalidadItem): LineaFija | null {
  const hm = d.herramientaMenorPct ?? 0
  if (d.modalidad === "todo_costo") {
    if (d.topeTodoCostoPct == null) throw new Error("el proyecto no tiene el % de subcontrato a todo costo")
    if (!d.precioOficial || d.precioOficial <= 0) throw new Error("no tiene precio oficial")
    return { concepto: "todo_costo", valor: redondear2((d.precioOficial * d.topeTodoCostoPct) / 100) }
  }
  if (d.modalidad === "mano_obra") {
    // Sin mano de obra pero con insumos (suministro e instalación): la base le
    // agrega una línea de mano de obra para elegirla del catálogo (20270101004600).
    if (!d.tieneManoObra && !d.conInsumos)
      throw new Error("no tiene mano de obra ni insumos: no puede ser subcontrato de mano de obra")
    if (d.conInsumos) return null
    if (!d.manoObraOficial || d.manoObraOficial <= 0) throw new Error("falta la mano de obra oficial")
    return { concepto: "mano_obra_subcontrato", valor: redondear2(0.5 * d.manoObraOficial * (1 + hm / 100)) }
  }
  if (d.modalidad === "administracion") {
    if (!d.tieneManoObra) return null
    if (!d.manoObraOficial || d.manoObraOficial <= 0) throw new Error("falta la mano de obra oficial")
    return { concepto: "mano_obra_administracion", valor: redondear2(d.manoObraOficial * (1 + hm / 100)) }
  }
  return null
}

// ---------------------------------------------------------------------------
// Import del Excel del presupuesto (columnas Modalidad y Mano de obra)
// ---------------------------------------------------------------------------

// Fila que recibe fijar_modalidades_presupuesto.
export type FilaModalidad = {
  codigo: string
  modalidad: Modalidad | null
  mano_obra_oficial?: number | null
  herramienta_menor_pct?: number | null
  // Precio oficial ajustado (ej. a la propuesta); si cambia, se actualiza
  // antes de aplicar la modalidad (20270101004600).
  precio_oficial?: number | null
}

// Lo que devuelve fijar_modalidades_presupuesto.
export type ResultadoModalidades = {
  aplicado: boolean
  errores: { fila: number; codigo: string | null; error: string }[]
  cambian: number
  porModalidad: Partial<Record<Modalidad | "sin_modalidad", number>>
  lineasGuardadas: number
  lineasNoRequeridas: number
  solicitudesCerradas: number
  valorAntes: number
  valorDespues: number
  // Ítems cuyo precio oficial cambia con el Excel (20270101004600).
  preciosCambian: number
}

// Lo que dice la hoja APU de un ítem, para validar su modalidad.
export type ResumenApuModalidad = { tieneManoObra: boolean; conInsumos: boolean; herramientaMenorPct: number | null }

// Líneas del bloque de un ítem en la hoja APU. El equipo NO cuenta como
// material; la herramienta menor es la línea "Herramienta menor X% ...".
export function resumenApuParaModalidad(lineas: { tipo: string; descripcion: string }[]): ResumenApuModalidad {
  let hm: number | null = null
  let tieneManoObra = false
  let conInsumos = false
  for (const l of lineas) {
    if (l.tipo === "MO") tieneManoObra = true
    else if (l.tipo === "INSUMO") conInsumos = true
    const pct = porcentajeHerramientaMenor(l.descripcion)
    if (pct != null) hm = (hm ?? 0) + pct
  }
  return { tieneManoObra, conInsumos, herramientaMenorPct: hm }
}

export type ItemModalidadImport = {
  codigo: string
  fila: number // fila del Excel, para los mensajes
  modalidad: Modalidad
  manoObraOficial: number | null
  precioOficial: number | null
}

// Valida las modalidades leídas del Excel contra su bloque de la hoja APU y
// arma las filas para la base. Solo ítems hoja (los capítulos se ignoran).
// Un error corta la importación, como un código mal escrito.
export function validarModalidadesImport(
  items: ItemModalidadImport[],
  codigosConHijos: Set<string>,
  apuPorCodigo: Map<string, ResumenApuModalidad>,
  topeTodoCostoPct: number | null
): { filas: FilaModalidad[]; errores: string[] } {
  const filas: FilaModalidad[] = []
  const errores: string[] = []
  for (const it of items) {
    if (codigosConHijos.has(it.codigo)) continue
    const apu = apuPorCodigo.get(it.codigo) ?? { tieneManoObra: false, conInsumos: false, herramientaMenorPct: null }
    try {
      lineaFijaModalidad({
        modalidad: it.modalidad,
        precioOficial: it.precioOficial,
        topeTodoCostoPct,
        manoObraOficial: it.manoObraOficial,
        herramientaMenorPct: apu.herramientaMenorPct,
        tieneManoObra: apu.tieneManoObra,
        conInsumos: apu.conInsumos,
      })
    } catch (e) {
      errores.push(`  Fila ${it.fila} (ítem ${it.codigo}, ${NOMBRE_MODALIDAD[it.modalidad]}): ${(e as Error).message}`)
      continue
    }
    filas.push({
      codigo: it.codigo,
      modalidad: it.modalidad,
      mano_obra_oficial: it.manoObraOficial,
      herramienta_menor_pct: apu.herramientaMenorPct,
    })
  }
  return { filas, errores }
}
