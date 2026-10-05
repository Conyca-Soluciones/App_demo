// Unidades de medida: normalizar lo que llega del Excel y del maestro
// ("UNIDAD - UND", "und", "METRO LINEAL - ML", "m²"...) a un código común,
// y decidir si la cantidad de una línea de APU está en la misma unidad que
// el precio del insumo, en una unidad convertible (kg contra un bulto de
// 50 kg) o en una que no cuadra.
//
// Presentación de un insumo (maestro_insumos): u_m es la unidad en que se
// compra y en la que está el precio (bulto, rollo, tubo); unidad_uso +
// contenido dicen cuánto trae (1 bulto = 50 KG). Sin presentación, el
// insumo solo se puede usar en su u_m.

const SINONIMOS: Record<string, string> = {
  UND: "UND", UN: "UND", U: "UND", UNID: "UND", UNIDAD: "UND", UNIDADES: "UND", UNDS: "UND", PZA: "UND", PIEZA: "UND",
  KG: "KG", KGS: "KG", KILO: "KG", KILOS: "KG", KILOGRAMO: "KG", KILOGRAMOS: "KG",
  G: "G", GR: "G", GRS: "G", GRAMO: "G", GRAMOS: "G",
  T: "TON", TON: "TON", TONELADA: "TON", TONELADAS: "TON",
  M: "M", ML: "M", MT: "M", MTS: "M", MTR: "M", MTRS: "M", METRO: "M", METROS: "M", METROLINEAL: "M", METROSLINEALES: "M",
  M2: "M2", MT2: "M2", METROCUADRADO: "M2", METROSCUADRADOS: "M2",
  M3: "M3", MT3: "M3", METROCUBICO: "M3", METROSCUBICOS: "M3",
  CM: "CM", CMS: "CM", CMT: "CM", CENTIMETRO: "CM", CENTIMETROS: "CM",
  MM: "MM", MILIMETRO: "MM", MILIMETROS: "MM",
  L: "L", LT: "L", LTS: "L", LTR: "L", LITRO: "L", LITROS: "L",
  CC: "CC", MLT: "CC", MILILITRO: "CC", MILILITROS: "CC",
  GAL: "GAL", GALON: "GAL", GALONES: "GAL",
  QT: "QT", CUARTO: "QT", CUARTODEGALON: "QT",
  LB: "LB", LBS: "LB", LIBRA: "LB", LIBRAS: "LB",
  ROLL: "ROLLO", ROLLO: "ROLLO", ROLLOS: "ROLLO", RLL: "ROLLO",
  BE: "BULTO", BULTO: "BULTO", BULTOS: "BULTO", BTO: "BULTO",
  CNT: "CUNETE", CUNETE: "CUNETE", CUNETES: "CUNETE",
  DIA: "DIA", DIAS: "DIA", D: "DIA",
  HR: "HORA", HRS: "HORA", H: "HORA", HORA: "HORA", HORAS: "HORA",
  MES: "MES", MESES: "MES", MS: "MES",
  VJ: "VIAJE", VIAJE: "VIAJE", VIAJES: "VIAJE",
  KM: "KM", KILOMETRO: "KM", KILOMETROS: "KM",
  JGO: "JUEGO", JUEGO: "JUEGO", JUEGOS: "JUEGO",
  GL: "GLOBAL", GLB: "GLOBAL", GLOBAL: "GLOBAL",
  SM: "SEMANA", SEMANA: "SEMANA", SEMANAS: "SEMANA",
  PAR: "PAR", PARES: "PAR",
  "%": "%", PORCENTAJE: "%",
}

const NOMBRES: Record<string, string> = {
  UND: "unidad", KG: "kg", G: "g", TON: "ton", M: "m", M2: "m²", M3: "m³", CM: "cm", MM: "mm",
  L: "litro", CC: "cc", GAL: "galón", QT: "cuarto", LB: "libra", ROLLO: "rollo", BULTO: "bulto",
  CUNETE: "cuñete", DIA: "día", HORA: "hora", MES: "mes", VIAJE: "viaje", KM: "km", JUEGO: "juego",
  GLOBAL: "global", SEMANA: "semana", PAR: "par", "%": "%",
}

function limpiar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tildes; la ñ queda como n
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .toUpperCase()
    .replace(/[.\s_-]+/g, "")
}

/**
 * Código común de una unidad, o null si viene vacía. "UNIDAD - UND" -> UND
 * (se prueba la parte de después del guion y la de antes); "m³" -> M3.
 * Lo que no se reconoce vuelve limpio en mayúsculas, así dos textos
 * iguales siguen cuadrando entre sí.
 */
export function normalizarUnidad(texto: string | null | undefined): string | null {
  if (texto == null) return null
  // "null - " es como queda en el maestro una unidad vacía
  const crudo = String(texto).trim().replace(/^[-\s]+|[-\s]+$/g, "")
  if (!crudo || crudo.toLowerCase() === "null") return null
  const partes = crudo.split(/\s+-\s+/).map((p) => p.trim()).filter((p) => p && p.toLowerCase() !== "null")
  for (const parte of [...partes].reverse()) {
    const codigo = SINONIMOS[limpiar(parte)]
    if (codigo) return codigo
  }
  const unido = limpiar(crudo)
  if (SINONIMOS[unido]) return SINONIMOS[unido]
  const ultima = partes.length > 0 ? limpiar(partes[partes.length - 1]) : unido
  return ultima || null
}

/** Nombre corto para mostrar ("kg", "rollo", "m²"). */
export function nombreUnidad(texto: string | null | undefined): string {
  const codigo = normalizarUnidad(texto)
  if (!codigo) return ""
  return NOMBRES[codigo] ?? codigo.toLowerCase()
}

export type PresentacionInsumo = {
  u_m: string | null
  unidad_uso: string | null
  contenido: number | null
}

export type CompatibilidadUnidad =
  /** La línea está en la unidad del precio: factor 1. */
  | { estado: "igual"; factor: 1 }
  /** La línea está en la unidad de uso: el precio se divide por el contenido. */
  | { estado: "conversion"; factor: number }
  /** La línea no trae unidad: se asume la del insumo (no hay con qué comparar). */
  | { estado: "sin_dato"; factor: 1 }
  /** No cuadra y no hay conversión: hay que elegir otro insumo, definir la presentación o confirmar. */
  | { estado: "distinta"; factor: null }

/**
 * Compara la unidad de una línea de APU contra la presentación del insumo.
 * El factor es por cuánto se divide el precio del insumo para que quede en
 * la unidad de la línea.
 */
export function compararUnidad(unidadLinea: string | null | undefined, insumo: PresentacionInsumo): CompatibilidadUnidad {
  const linea = normalizarUnidad(unidadLinea)
  if (!linea) return { estado: "sin_dato", factor: 1 }
  const compra = normalizarUnidad(insumo.u_m)
  if (!compra || linea === compra) return { estado: "igual", factor: 1 }
  const uso = normalizarUnidad(insumo.unidad_uso)
  const contenido = insumo.contenido == null ? null : Number(insumo.contenido)
  if (uso && linea === uso && contenido != null && contenido > 0) {
    return { estado: "conversion", factor: contenido }
  }
  return { estado: "distinta", factor: null }
}

/** "bulto de 50 kg" / "rollo de 100 m"; null sin presentación. */
export function describirPresentacion(insumo: PresentacionInsumo): string | null {
  if (!insumo.unidad_uso || insumo.contenido == null) return null
  const compra = nombreUnidad(insumo.u_m) || "unidad"
  return `${compra} de ${formatearCantidad(Number(insumo.contenido))} ${nombreUnidad(insumo.unidad_uso)}`
}

function formatearCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString("es-CO", { maximumFractionDigits: 4 })
}

// "X 50 KG", "X50KG", "x 6 MTS", "X 2,5 GAL". El "X" tiene que venir después
// de un espacio (o al inicio): "15X15", "1X4,60 MTS" y "100X100" son medidas,
// no contenido.
const RE_PRESENTACION = /(?:^|\s)[xX]\s*(\d+(?:[.,]\d+)?)\s*([A-Za-zÁÉÍÓÚáéíóú³²23]+)\b/g

/**
 * Sugerencia de presentación leída del nombre del insumo, para que quien
 * aprueba insumos la confirme. Toma la ÚLTIMA coincidencia ("TUBERIA 2" X 6
 * MTS" -> 6 m). "ML" con más de 20 se toma como mililitros (silicona X 300ML)
 * y no se sugiere: es ambiguo. Null si no hay nada claro o si la unidad
 * leída es la misma del precio.
 */
export function sugerirPresentacion(
  descripcion: string,
  uM: string | null
): { unidadUso: string; contenido: number } | null {
  let ultima: { numero: number; unidadCruda: string } | null = null
  for (const m of descripcion.matchAll(RE_PRESENTACION)) {
    const numero = Number(m[1].replace(",", "."))
    if (Number.isFinite(numero) && numero > 0) ultima = { numero, unidadCruda: m[2] }
  }
  if (!ultima) return null
  const cruda = limpiar(ultima.unidadCruda)
  if (cruda === "ML" && ultima.numero > 20) return null
  const unidad = SINONIMOS[cruda]
  if (!unidad || unidad === "%") return null
  if (unidad === normalizarUnidad(uM)) return null
  if (ultima.numero === 1) return null // "X 1 UND" no dice nada
  return { unidadUso: unidad, contenido: ultima.numero }
}

/** Cuántas unidades de compra hacen falta para `cantidadUso` (siempre hacia arriba). */
export function unidadesDeCompra(cantidadUso: number, contenido: number): number {
  if (!(contenido > 0)) return cantidadUso
  // el margen evita que el ruido de los decimales (150/50 = 3.0000000000000004,
  // sumas de 0,1) pida una unidad de más
  return Math.ceil(cantidadUso / contenido - 1e-6)
}

/**
 * Valida la presentación que se escribe en pantalla: los dos datos o
 * ninguno (null = sin presentación), contenido mayor que cero. La unidad
 * de uso se guarda normalizada ("KG", "M").
 */
export function validarPresentacion(
  unidadUso: string | null | undefined,
  contenido: number | string | null | undefined
): { unidadUso: string; contenido: number } | null {
  const unidad = unidadUso?.trim() ? normalizarUnidad(unidadUso) : null
  const textoContenido = contenido == null ? "" : String(contenido).trim().replace(",", ".")
  if (!unidad && !textoContenido) return null
  if (!unidad || !textoContenido) {
    throw new Error("La presentación necesita las dos cosas: cuánto trae y en qué unidad (por ejemplo 50 y kg).")
  }
  const numero = Number(textoContenido)
  if (!Number.isFinite(numero) || numero <= 0) {
    throw new Error("El contenido de la presentación tiene que ser un número mayor que cero.")
  }
  return { unidadUso: unidad, contenido: numero }
}

/** Unidades que se ofrecen como unidad de uso en pantalla. */
export const UNIDADES_DE_USO: { codigo: string; nombre: string }[] = [
  "KG", "G", "TON", "LB", "M", "CM", "M2", "M3", "L", "CC", "GAL", "UND",
].map((codigo) => ({ codigo, nombre: NOMBRES[codigo] ?? codigo.toLowerCase() }))

/**
 * Texto para Compras cuando la requisición está en otra unidad que la de
 * compra: "pedido: 120 m · 1 rollo = 100 m". Null si es la misma unidad.
 */
export function textoConversionCompra(
  cantidadUso: number,
  unidadUso: string | null,
  factor: number,
  unidadCompra: string | null
): string | null {
  if (!(factor > 0) || factor === 1) return null
  const uso = nombreUnidad(unidadUso) || "unidad"
  const compra = nombreUnidad(unidadCompra) || "unidad"
  return `pedido: ${formatearCantidad(cantidadUso)} ${uso} · 1 ${compra} = ${formatearCantidad(factor)} ${uso}`
}
