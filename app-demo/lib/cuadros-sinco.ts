// Cuadros de pagos de SINCO (20270101002500): leer el Excel GF-F-018 que Financiera
// saca de SINCO (el de compras, con varios proyectos, o el de un proyecto). Archivo
// plano: lo usan la pantalla (leer el Excel) y las pruebas.
//
// La hoja de los pagos es la que tiene la fila de encabezados con "CODIGO DE
// PROYECTO" y "TOTAL". Una fila es un pago si su ITEMS es un número mayor que 0
// (las de "PROYECTO: …", subtotales, TOTAL GENERAL y firmas no lo tienen).

export type FilaCuadroSinco = {
  orden: number // fila del Excel (1 = la primera)
  item: number | null
  proyecto: string
  grupo: string
  factura_nombre: string
  factura_documento: string
  tipo_documento: string
  titular_nombre: string
  titular_documento: string
  titular_tipo_documento: string
  banco: string
  tipo_cuenta: string
  numero_cuenta: string
  numero_factura: string
  concepto: string
  valor_documento: number | null
  base: number | null
  iva: number | null
  anticipos: number | null
  total: number | null
  observaciones: string
  solicita: string
}

export type ResumenCuadroSinco = {
  errores: { orden: number; mensaje: string }[]
  avisos: { orden: number; mensaje: string }[]
  repetidas: { orden: number; mensaje: string }[]
  pagos: number
  total: number
  tercerosNuevos: number
  cuentasNuevas: number
  porProyecto: { proyecto: string; pagos: number; total: number }[]
  cuadroId: string | null
}

/** Arregla el texto que llega mal codificado ("ANTIOQUEÃ\u0091A" -> "ANTIOQUEÑA"). */
export function arreglarTexto(s: string): string {
  if (!/[ÃÂ]/.test(s)) return s
  try {
    const bytes = Uint8Array.from([...s].map((c) => c.charCodeAt(0)))
    if ([...s].some((c) => c.charCodeAt(0) > 255)) return s
    const r = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return r
  } catch {
    return s
  }
}

const normal = (s: string) =>
  arreglarTexto(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()

const COLUMNAS = {
  item: ["ITEMS", "ITEM"],
  grupo: ["GRUPO EMPRESARIAL"],
  factura_nombre: ["EMPRESA QUE FACTURA"],
  factura_documento: ["NIT DE LA EMPRESA QUE FACTURA"],
  titular_nombre: ["TITULAR DE LA CUENTA"],
  tipo_documento: ["TIPO DE DOCUMENTO"],
  titular_documento: ["NIT O CC TITULAR DE LA CUENTA"],
  banco: ["BANCO"],
  tipo_cuenta: ["TIPO DE CUENTA"],
  numero_cuenta: ["NUMERO DE CUENTA"],
  numero_factura: ["NO. FACTURA Y/O CUENTA DE COBRO", "NO FACTURA Y/O CUENTA DE COBRO", "FACTURA"],
  concepto: ["CONCEPTO DE LA FACTURA", "CONCEPTO"],
  proyecto: ["CODIGO DE PROYECTO"],
  valor_documento: ["VALOR DOCUMENTO"],
  base: ["BASE"],
  iva: ["IVA"],
  anticipos: ["ANTICIPOS Y/O DESCUENTOS"],
  total: ["TOTAL"],
  observaciones: ["OBSERVACIONES"],
  observaciones_bogota: ["OBSERVACIONES BOGOTA"],
  solicita: ["SOLICITA"],
} as const
type Columna = keyof typeof COLUMNAS

const texto = (v: unknown) => arreglarTexto(String(v ?? "").trim())

/** Número de una celda: número de Excel o texto "1.140.000" / "1.140.000,50". */
export function numeroCelda(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  let t = String(v ?? "").trim().replace(/\s|\$/g, "")
  if (t === "") return null
  const negativo = t.startsWith("-")
  if (negativo) t = t.slice(1)
  let n: number
  if (t.includes(",")) n = Number(t.replace(/\./g, "").replace(",", "."))
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = Number(t.replace(/\./g, ""))
  else n = Number(t)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

/** Documento o cuenta: solo dígitos (los números grandes de Excel sin decimales). */
const digitos = (v: unknown) => (typeof v === "number" ? String(Math.round(v)) : String(v ?? "")).replace(/\D/g, "")

/**
 * Lee el cuadro. `hojas` = [nombre, matriz de celdas] de cada hoja (como la da
 * XLSX con header: 1 y raw: true). Devuelve las filas de pagos o el error.
 */
export function leerCuadroSinco(hojas: [string, unknown[][]][]): { filas: FilaCuadroSinco[]; error: string | null } {
  for (const [, matriz] of hojas) {
    let encabezado = -1
    const col: Partial<Record<Columna, number>> = {}
    for (let r = 0; r < Math.min(20, matriz.length) && encabezado < 0; r++) {
      const celdas = (matriz[r] ?? []).map((c) => normal(String(c ?? "")))
      if (!celdas.includes("CODIGO DE PROYECTO") || !celdas.includes("TOTAL")) continue
      encabezado = r
      for (const [clave, nombres] of Object.entries(COLUMNAS) as [Columna, readonly string[]][]) {
        const i = celdas.findIndex((c) => nombres.includes(c))
        if (i >= 0) col[clave] = i
      }
    }
    if (encabezado < 0) continue
    const faltan = (["item", "factura_nombre", "factura_documento", "proyecto", "total"] as Columna[]).filter((c) => col[c] == null)
    if (faltan.length > 0) {
      return { filas: [], error: `Al cuadro le faltan columnas: ${faltan.map((c) => COLUMNAS[c][0]).join(", ")}.` }
    }

    const filas: FilaCuadroSinco[] = []
    for (let r = encabezado + 1; r < matriz.length; r++) {
      const fila = matriz[r] ?? []
      const celda = (c: Columna) => (col[c] != null ? fila[col[c] as number] : null)
      const item = numeroCelda(celda("item"))
      if (item == null || item <= 0) continue
      const facturaDoc = digitos(celda("factura_documento"))
      const titularDoc = digitos(celda("titular_documento")) || facturaDoc
      const tipoDoc = normal(texto(celda("tipo_documento")))
      const obs = [texto(celda("observaciones")), texto(celda("observaciones_bogota"))].filter(Boolean).join(" · ")
      filas.push({
        orden: r + 1,
        item: Math.round(item),
        proyecto: texto(celda("proyecto")),
        grupo: texto(celda("grupo")),
        factura_nombre: texto(celda("factura_nombre")),
        factura_documento: facturaDoc,
        tipo_documento: titularDoc === facturaDoc ? tipoDoc : "NIT",
        titular_nombre: texto(celda("titular_nombre")),
        titular_documento: titularDoc,
        titular_tipo_documento: tipoDoc,
        banco: texto(celda("banco")),
        tipo_cuenta: texto(celda("tipo_cuenta")),
        numero_cuenta: digitos(celda("numero_cuenta")),
        numero_factura: typeof celda("numero_factura") === "number" ? String(celda("numero_factura")) : texto(celda("numero_factura")),
        concepto: texto(celda("concepto")),
        valor_documento: numeroCelda(celda("valor_documento")),
        base: numeroCelda(celda("base")),
        iva: numeroCelda(celda("iva")),
        anticipos: numeroCelda(celda("anticipos")),
        total: numeroCelda(celda("total")),
        observaciones: obs,
        solicita: texto(celda("solicita")),
      })
    }
    if (filas.length === 0) return { filas: [], error: "El cuadro no tiene pagos (filas con número en ITEMS)." }
    return { filas, error: null }
  }
  return { filas: [], error: 'No es un cuadro de pagos de SINCO: no se encontró la fila de encabezados con "CODIGO DE PROYECTO" y "TOTAL".' }
}

export const ESTADO_PAGO_SINCO: Record<string, string> = {
  preparacion: "Preparación",
  por_liquidar: "Por liquidar",
  observado: "Observado",
  liquidado: "Liquidado",
  dispersado: "Pagado",
  anulado: "Anulado",
}

/** Etapa del pago para mostrar en el cuadro. */
export function etapaPagoSinco(p: { estado: string | null; liquidacionEstado: string | null }): string {
  if (!p.estado) return "—"
  if (p.estado === "anulado") return ESTADO_PAGO_SINCO.anulado
  if (p.estado === "dispersado") return ESTADO_PAGO_SINCO.dispersado
  return ESTADO_PAGO_SINCO[p.liquidacionEstado ?? "preparacion"] ?? p.estado
}

/** El soporte se puede subir o cambiar mientras el pago no esté liquidado. */
export const puedeCambiarSoporteSinco = (p: { estado: string | null; liquidacionEstado: string | null }) =>
  p.estado === "aprobado" && p.liquidacionEstado !== "liquidado"
