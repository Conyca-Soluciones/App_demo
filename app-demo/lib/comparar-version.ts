// ---------------------------------------------------------------------------
// Comparación del Excel del presupuesto con la versión vigente (2026-11-23,
// paso 1 de "versión nueva desde el Excel aplicando solo las diferencias").
//
// Antes de crear la versión nueva, la pantalla muestra qué cambia: ítems
// nuevos, ítems que ya no vienen, cantidad / descripción / unidad / precio
// oficial distintos, APU que cambian (líneas nuevas, que ya no vienen o con
// otra cantidad) y alertas (un ítem que tenía APU y el Excel no trae su bloque,
// cambios en ítems con requisiciones o contratos).
//
// Archivo plano, sin dependencias del servidor (pruebas en
// tests/comparar-version.test.ts). Las líneas del APU se emparejan por el
// texto de la línea sin mayúsculas, tildes, superíndices ni puntuación
// (claveLinea = _clave_linea_apu de la base, 20270101005600: "Volqueta (6 m3)" y
// "Volqueta (6 m³)" son la misma línea) y, si se repite, el orden. El tipo NO cuenta: el import reclasifica algunas líneas
// (una "Volqueta" que el Excel trae como EQUIPO queda como TRANSPORTE) y
// saldrían cambios que no son. La cantidad vacía cuenta como 0 (el import
// guarda 0 cuando el Excel no la trae).
// ---------------------------------------------------------------------------

import { normalizarUnidad } from "@/lib/unidades"

export type TipoLineaApu = "INSUMO" | "MO" | "EQUIPO" | "TRANSPORTE" | string

export type LineaApuComparable = {
  tipo: TipoLineaApu
  descripcion: string
  unidad: string | null
  cantidad: number | null
}

// Ítem de la versión vigente (datos_comparar_version).
export type ItemVigente = {
  codigo: string
  descripcion: string
  unidad: string | null
  cantidad: number | null
  precioOficial: number | null
  esHoja: boolean
  tieneApu: boolean
  modalidad: string | null
  // Requisiciones (pendientes o aprobadas) y contratos (no rechazados) sobre el
  // ítem, en cualquier versión (por código).
  conRequisiciones: boolean
  conContratos: boolean
  lineas: LineaApuComparable[]
}

// Ítem del Excel (hoja del presupuesto) y su bloque APU, si lo trae.
export type ItemExcel = {
  codigo: string
  descripcion: string
  unidad: string | null
  cantidad: number | null
  precioOficial: number | null
  esHoja: boolean
  // Global (GL sin bloque APU): vale su precio oficial, no necesita APU.
  esGlobal: boolean
  lineas: LineaApuComparable[] | null // null = sin bloque en la hoja APU
}

export type CambioCampo = "descripcion" | "unidad" | "cantidad" | "precioOficial"

export type CambioItem = {
  codigo: string
  descripcion: string
  campos: { campo: CambioCampo; antes: string | number | null; ahora: string | number | null }[]
  conMovimientos: boolean
}

export type CambioLinea = {
  tipo: TipoLineaApu
  descripcion: string
  unidad: string | null
  antes: number | null
  ahora: number | null
}

export type CambioApu = {
  codigo: string
  descripcion: string
  nuevas: LineaApuComparable[]
  quitadas: LineaApuComparable[]
  cantidades: CambioLinea[]
}

export type TipoAlerta = "pierde_apu" | "gana_apu" | "quitado_con_movimientos" | "baja_con_movimientos" | "capitulo_a_hoja"

export type AlertaComparacion = { tipo: TipoAlerta; codigo: string; descripcion: string; mensaje: string }

export type ResultadoComparacion = {
  nuevos: ItemExcel[]
  quitados: (ItemVigente & { conMovimientos: boolean })[]
  cambios: CambioItem[]
  apus: CambioApu[]
  alertas: AlertaComparacion[]
  sinCambios: number
  totalExcel: number
  totalVigente: number
}

const TOLERANCIA = 1e-4

export const claveTexto = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase()

// Igual que _clave_linea_apu en la base: sin mayúsculas ni tildes, ³ = 3, ² = 2,
// º/° = o, y solo letras y números separados por un espacio.
export const claveLinea = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/³/g, "3")
    .replace(/²/g, "2")
    .replace(/[º°]/g, "o")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

const igualNumero = (a: number | null, b: number | null) =>
  a == null || b == null ? a == null && b == null : Math.abs(a - b) <= TOLERANCIA * Math.max(1, Math.abs(a), Math.abs(b))
// Cantidad: vacía = 0.
const igualCantidad = (a: number | null, b: number | null) => igualNumero(a ?? 0, b ?? 0)

const igualUnidad = (a: string | null, b: string | null) =>
  (normalizarUnidad(a) ?? claveTexto(a)) === (normalizarUnidad(b) ?? claveTexto(b))

// Clave de emparejamiento de una línea: texto + orden entre iguales.
function conClaves(lineas: LineaApuComparable[]): Map<string, LineaApuComparable> {
  const vistas = new Map<string, number>()
  const out = new Map<string, LineaApuComparable>()
  for (const l of lineas) {
    const base = claveLinea(l.descripcion)
    const n = (vistas.get(base) ?? 0) + 1
    vistas.set(base, n)
    out.set(`${base}|${n}`, l)
  }
  return out
}

export function compararApu(vigente: LineaApuComparable[], excel: LineaApuComparable[]) {
  const a = conClaves(vigente)
  const b = conClaves(excel)
  const nuevas: LineaApuComparable[] = []
  const quitadas: LineaApuComparable[] = []
  const cantidades: CambioLinea[] = []
  for (const [k, l] of b) {
    const v = a.get(k)
    if (!v) nuevas.push(l)
    else if (!igualCantidad(v.cantidad, l.cantidad))
      cantidades.push({ tipo: l.tipo, descripcion: l.descripcion, unidad: l.unidad, antes: v.cantidad, ahora: l.cantidad })
  }
  for (const [k, l] of a) if (!b.has(k)) quitadas.push(l)
  return { nuevas, quitadas, cantidades }
}

export function compararVersion(vigentes: ItemVigente[], excel: ItemExcel[]): ResultadoComparacion {
  const porCodigoV = new Map(vigentes.map((i) => [i.codigo, i]))
  const porCodigoE = new Map(excel.map((i) => [i.codigo, i]))
  const nuevos: ItemExcel[] = []
  const cambios: CambioItem[] = []
  const apus: CambioApu[] = []
  const alertas: AlertaComparacion[] = []
  let sinCambios = 0

  for (const e of excel) {
    const v = porCodigoV.get(e.codigo)
    if (!v) {
      nuevos.push(e)
      continue
    }
    const conMovimientos = v.conRequisiciones || v.conContratos
    const campos: CambioItem["campos"] = []
    if (claveTexto(v.descripcion) !== claveTexto(e.descripcion))
      campos.push({ campo: "descripcion", antes: v.descripcion, ahora: e.descripcion })
    if (!igualUnidad(v.unidad, e.unidad)) campos.push({ campo: "unidad", antes: v.unidad, ahora: e.unidad })
    if (!igualCantidad(v.cantidad, e.cantidad)) campos.push({ campo: "cantidad", antes: v.cantidad, ahora: e.cantidad })
    if (e.esHoja && !igualNumero(v.precioOficial, e.precioOficial))
      campos.push({ campo: "precioOficial", antes: v.precioOficial, ahora: e.precioOficial })
    if (campos.length > 0) cambios.push({ codigo: e.codigo, descripcion: e.descripcion, campos, conMovimientos })

    if (conMovimientos && v.cantidad != null && e.cantidad != null && e.cantidad < v.cantidad - TOLERANCIA)
      alertas.push({
        tipo: "baja_con_movimientos",
        codigo: e.codigo,
        descripcion: e.descripcion,
        mensaje: `Baja la cantidad (${v.cantidad} → ${e.cantidad}) y el ítem ya tiene ${
          v.conRequisiciones && v.conContratos ? "requisiciones y contratos" : v.conRequisiciones ? "requisiciones" : "contratos"
        }: revisa que no quede por debajo de lo pedido o contratado.`,
      })
    if (!v.esHoja && e.esHoja)
      alertas.push({
        tipo: "capitulo_a_hoja",
        codigo: e.codigo,
        descripcion: e.descripcion,
        mensaje: "En la versión vigente es un capítulo y en el Excel es un ítem (o al revés).",
      })

    let cambiaApu = false
    if (e.esHoja) {
      if (e.lineas === null) {
        if (v.tieneApu && !e.esGlobal && !(v.modalidad === "todo_costo" && v.lineas.length === 0))
          alertas.push({
            tipo: "pierde_apu",
            codigo: e.codigo,
            descripcion: e.descripcion,
            mensaje: "Tenía APU y el Excel no trae su bloque en la hoja APU: en la versión nueva quedaría sin APU.",
          })
      } else {
        if (!v.tieneApu && v.lineas.length === 0)
          alertas.push({
            tipo: "gana_apu",
            codigo: e.codigo,
            descripcion: e.descripcion,
            mensaje: "No tenía APU y el Excel sí trae su bloque: se arma el APU en la versión nueva.",
          })
        const c = compararApu(v.lineas, e.lineas)
        if (c.nuevas.length || c.quitadas.length || c.cantidades.length) {
          apus.push({ codigo: e.codigo, descripcion: e.descripcion, ...c })
          cambiaApu = true
        }
      }
    }
    if (campos.length === 0 && !cambiaApu) sinCambios++
  }

  const quitados = vigentes
    .filter((v) => !porCodigoE.has(v.codigo))
    .map((v) => ({ ...v, conMovimientos: v.conRequisiciones || v.conContratos }))
  for (const q of quitados)
    if (q.conMovimientos)
      alertas.push({
        tipo: "quitado_con_movimientos",
        codigo: q.codigo,
        descripcion: q.descripcion,
        mensaje: `No viene en el Excel y tiene ${
          q.conRequisiciones && q.conContratos ? "requisiciones y contratos" : q.conRequisiciones ? "requisiciones" : "contratos"
        }: no se puede quitar.`,
      })

  const orden = (a: { codigo: string }, b: { codigo: string }) => a.codigo.localeCompare(b.codigo, "es", { numeric: true })
  nuevos.sort(orden)
  quitados.sort(orden)
  cambios.sort(orden)
  apus.sort(orden)
  alertas.sort(orden)
  return { nuevos, quitados, cambios, apus, alertas, sinCambios, totalExcel: excel.length, totalVigente: vigentes.length }
}

// ¿Hay algo que cambie? (sin diferencias no tiene sentido crear la versión).
export function hayDiferencias(r: ResultadoComparacion): boolean {
  return r.nuevos.length + r.quitados.length + r.cambios.length + r.apus.length > 0
}
