/**
 * MOTOR DE SIMILITUD DE TEXTO
 * ============================
 * Reemplaza el enfoque anterior (Levenshtein puro, calculado en SQL) por
 * un pipeline con varias señales combinadas. Corre en TypeScript, no en
 * la base de datos, porque:
 *
 *   1) Postgres no tiene TF-IDF/coseno nativo, y escribirlo a mano en
 *      PL/pgSQL es mucho más difícil de mantener que en TS.
 *   2) Levenshtein SOLO mide "cuántos caracteres hay que cambiar" entre
 *      dos strings -- no distingue que "COLUMNA 0.25X0.25" y
 *      "COLUMNA 0.30X0.30" son productos DISTINTOS aunque el texto sea
 *      casi idéntico. Hace falta comparar también números y unidades
 *      por separado, como reglas explícitas.
 *
 * PIPELINE:
 *   1. Normalización      -> mayúsculas, sin tildes, limpieza básica
 *   2. Tokenización        -> separar en palabras/números
 *   3. Limpieza/Stopwords  -> quitar palabras de relleno sin valor
 *      discriminante ("de", "para", "incluye", "materiales"...)
 *   4. Extraer información -> números (posibles medidas/dimensiones)
 *   5. Generar candidatos   -> 3 señales de texto:
 *        - TF-IDF + coseno      (importancia relativa de cada palabra)
 *        - Token matching        (solapamiento Jaccard de palabras clave)
 *        - Fuzzy matching        (Levenshtein, como una señal más, no la única)
 *   6. Reglas especiales    -> penaliza fuerte si las medidas numéricas
 *      no calzan, o si la unidad (M2/M3/UN/...) es distinta
 *   7. Combinar scores      -> promedio ponderado de las 3 señales de
 *      texto, multiplicado por los factores de las reglas especiales
 *   8. Ranking top N
 */

// ---------------------------------------------------------------------------
// 1. Normalización
// ---------------------------------------------------------------------------

export function normalizar(texto: string): string {
  let t = texto.trim().toUpperCase()
  t = t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "") // quitar tildes
  t = t.replace(/[""'']/g, '"')
  t = t.replace(/[^A-Z0-9",.\s/-]+/g, " ")
  t = t.replace(/\s+/g, " ").trim()
  return t
}

// ---------------------------------------------------------------------------
// 2. Tokenización
// ---------------------------------------------------------------------------

function tokenizar(textoNormalizado: string): string[] {
  return textoNormalizado
    .split(/[\s,./-]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// 3. Limpieza / Stopwords
// ---------------------------------------------------------------------------
// Palabras que aparecen en casi TODAS las descripciones de este dominio
// (construcción) y por lo tanto no ayudan a distinguir un ítem de otro.
// Ajustar esta lista libremente según lo que se vea en los datos reales.

const STOPWORDS = new Set([
  "DE", "EN", "PARA", "CON", "LA", "EL", "LOS", "LAS", "Y", "O", "A",
  "SU", "SUS", "UN", "UNA", "UNOS", "UNAS", "AL", "DEL", "QUE", "SE",
  "ES", "SON", "POR",
  "INCLUYE", "INCLUYENDO", "INCLUYE.", "TODOS", "TODAS", "TODO", "TODA",
  "NECESARIOS", "NECESARIO", "NECESARIA", "NECESARIAS",
  "MATERIALES", "MATERIAL", "ELEMENTOS", "DEMAS", "DEMÁS", "DEMÁS.",
  "CORRECTA", "CORRECTO", "CORRECTOS", "CORRECTAS",
  "INSTALACION", "INSTALACIÓN", "FUNCIONAMIENTO", "EJECUCION", "EJECUCIÓN",
  "SEGUN", "SEGÚN", "COMO", "TIPO", "SIMILAR",
])

function quitarStopwords(tokens: string[]): string[] {
  return tokens.filter((t) => !STOPWORDS.has(t) && t.length > 1).map(singularizar)
}

// ---------------------------------------------------------------------------
// 3b. Singularización simple (des-pluralizar) -- el catálogo suele usar
// plural ("CERCHAS", "METALICAS") y el ingeniero a veces escribe
// singular ("Cercha", "metalica") -- sin esto, el algoritmo los trata
// como palabras SIN NINGUNA relación entre sí para Jaccard y TF-IDF
// (Levenshtein sobre el string completo sí los ve parecidos, pero pesa
// menos en el score final). Caso real que no matcheaba por esto:
// "Cercha o viga metalica 3.0 m" vs "CERCHAS METALICAS DE 3 M DE LARGO
// USADAS" -- 0.21 con las palabras tal cual, ~0.5+ singularizando.
//
// Reglas simples de español (no es un stemmer completo, a propósito --
// más agresivo arriesga falsos positivos):
//   - vocal + S al final  -> quitar la S       (CERCHAS -> CERCHA)
//   - consonante + ES     -> quitar el ES       (PAREDES -> PARED)
// Números y tokens de 3 letras o menos no se tocan (para no arruinar
// palabras cortas reales como "GAS", "MES", o números como "125").
// ---------------------------------------------------------------------------

function singularizar(token: string): string {
  if (token.length <= 3 || /^\d+$/.test(token)) return token
  if (/[AEIOU]S$/.test(token)) return token.slice(0, -1)
  if (/[^AEIOUS]ES$/.test(token)) return token.slice(0, -2)
  return token
}

// ---------------------------------------------------------------------------
// 4. Extraer información: números (posibles medidas/dimensiones)
// ---------------------------------------------------------------------------

// Solo decimales de 1-2 dígitos después del punto (0.25, 0.30, 4.5) --
// se excluyen a propósito los de 3 dígitos ("3.000", "4.000") porque en
// este dominio casi siempre son notación de miles en español (3.000 =
// 3000, típicamente PSI de concreto), no una medida real. Confundir
// "3.000 psi" con una dimensión de "3.000 m" habría arruinado la regla
// de penalización por medidas distintas.
function extraerNumeros(textoNormalizado: string): number[] {
  const matches = textoNormalizado.match(/\d+\.\d{1,2}(?!\d)/g) ?? []
  return matches.map((n) => parseFloat(n))
}

// ---------------------------------------------------------------------------
// Distancia de Levenshtein (implementación propia -- ya no depende de la
// extensión fuzzystrmatch de Postgres).
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + costo)
    }
  }
  return dp[m][n]
}

function fuzzyRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length, 1)
  return 1 - levenshtein(a, b) / maxLen
}

// ---------------------------------------------------------------------------
// 5/7. TF-IDF + coseno, sobre el corpus formado por TODOS los candidatos
// más la consulta -- así las palabras raras (más discriminantes, ej.
// "GRAUTING", "BUITRON") pesan más que las comunes (ej. "CONCRETO",
// "INSTALAR") sin necesidad de mantener una lista fija a mano.
// ---------------------------------------------------------------------------

function vectorTfIdf(tokens: string[], df: Map<string, number>, nDocs: number): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)

  const vec = new Map<string, number>()
  for (const [t, freq] of tf) {
    const idf = Math.log((nDocs + 1) / ((df.get(t) ?? 0) + 1)) + 1
    vec.set(t, (freq / tokens.length) * idf)
  }
  return vec
}

function coseno(v1: Map<string, number>, v2: Map<string, number>): number {
  let dot = 0
  let norm1 = 0
  let norm2 = 0
  for (const [, w] of v1) norm1 += w * w
  for (const [, w] of v2) norm2 += w * w
  for (const [t, w1] of v1) {
    const w2 = v2.get(t)
    if (w2) dot += w1 * w2
  }
  if (norm1 === 0 || norm2 === 0) return 0
  return dot / (Math.sqrt(norm1) * Math.sqrt(norm2))
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export interface CandidatoTexto {
  id: string
  texto: string
  unidad?: string | null
}

export interface ResultadoSimilitud<T extends CandidatoTexto> {
  candidato: T
  score: number
  // desglose útil para depurar o para mostrar "por qué" se sugirió algo
  // -- y en particular, para que la UI pueda avisar "esta opción tiene
  // otra medida" o "otra unidad" en vez de esconderla del todo.
  detalle: {
    cosine: number
    tokenOverlap: number
    fuzzy: number
    medidaDistinta: boolean
    unidadDistinta: boolean
  }
}

export function buscarSimilares<T extends CandidatoTexto>(
  consultaTexto: string,
  consultaUnidad: string | null | undefined,
  candidatos: T[],
  opciones?: { top?: number; umbral?: number }
): ResultadoSimilitud<T>[] {
  const top = opciones?.top ?? 6
  // OJO: este umbral es un score COMBINADO (0..1), no el % de edición
  // de Levenshtein -- con las 3 señales + penalizaciones suaves, 0.4
  // ya filtra el ruido obvio (ítems sin relación) pero deja pasar
  // variantes del mismo tipo de ítem con otra medida o unidad, para
  // que el ingeniero las vea como opciones y elija con criterio en vez
  // de que el algoritmo decida por él escondiéndolas.
  const umbral = opciones?.umbral ?? 0.4

  if (candidatos.length === 0) return []

  const consultaNorm = normalizar(consultaTexto)
  const consultaTokensCrudos = tokenizar(consultaNorm)
  const consultaTokens = quitarStopwords(consultaTokensCrudos)
  const consultaNumeros = extraerNumeros(consultaNorm)
  const consultaSet = new Set(consultaTokens)

  // normalizar() se calcula UNA vez por candidato acá -- antes se
  // llamaba de nuevo, para el mismo texto, dentro del cálculo de fuzzy
  // (Levenshtein) y otra vez más para extraer números -- 3 llamadas a
  // normalizar() (con su normalize("NFKD") + varios regex) por
  // candidato, por búsqueda. Con hasta 300 candidatos y cientos de
  // búsquedas en un import grande, eso se sumaba.
  const docsNorm = candidatos.map((c) => normalizar(c.texto))
  const docsTokens = docsNorm.map((n) => quitarStopwords(tokenizar(n)))
  const todosDocs = [...docsTokens, consultaTokens]

  const df = new Map<string, number>()
  for (const doc of todosDocs) {
    for (const token of new Set(doc)) {
      df.set(token, (df.get(token) ?? 0) + 1)
    }
  }
  const nDocs = todosDocs.length

  const vecConsulta = vectorTfIdf(consultaTokens, df, nDocs)

  const resultados: ResultadoSimilitud<T>[] = candidatos.map((candidato, i) => {
    const tokensCand = docsTokens[i]
    const normCand = docsNorm[i]

    const candSet = new Set(tokensCand)
    const interseccion = [...consultaSet].filter((t) => candSet.has(t)).length
    // Cobertura de la búsqueda, NO Jaccard simétrico -- acá la pregunta
    // correcta es "¿el candidato contiene lo que estoy buscando?", no
    // "¿se parecen en tamaño estas dos descripciones?". Con Jaccard
    // (dividir por la UNIÓN), una búsqueda corta como "andamio" contra
    // un candidato largo y detallado del catálogo ("ANDAMIO TUBULAR
    // USADO DE 1.50 X 1.42...") salía con score bajísimo solo por tener
    // más palabras -- aunque contuviera EXACTO lo buscado. Dividiendo
    // por el tamaño de la consulta en vez de la unión, ese mismo caso
    // pasa de 0.17 a 1.0.
    const tokenOverlap = consultaSet.size > 0 ? interseccion / consultaSet.size : 0

    // EARLY EXIT (matemáticamente exacto, no una aproximación): si la
    // consulta y el candidato NO comparten ni una sola palabra,
    // tokenOverlap = 0 -- y como el coseno de TF-IDF se calcula sobre
    // ese MISMO vocabulario compartido, si no hay palabras en común el
    // coseno también es EXACTAMENTE 0 (el producto punto solo suma
    // sobre términos que aparecen en ambos). Con cosine=0 y
    // tokenOverlap=0, el score máximo posible es 0.25×fuzzy ≤ 0.25 --
    // no puede llegar al umbral (0.4 por default) sin importar qué tan
    // parecidos sean los caracteres letra por letra. Se puede filtrar
    // este candidato de una, sin gastar el Levenshtein (lo más caro del
    // pipeline) calculando algo cuyo resultado no puede cambiar el
    // veredicto.
    if (tokenOverlap === 0 && umbral > 0.25) {
      return {
        candidato,
        score: 0,
        detalle: { cosine: 0, tokenOverlap: 0, fuzzy: 0, medidaDistinta: false, unidadDistinta: false },
      }
    }

    const vecCand = vectorTfIdf(tokensCand, df, nDocs)
    const cosine = coseno(vecConsulta, vecCand)
    const fuzzy = fuzzyRatio(consultaNorm, normCand)

    let score = 0.45 * cosine + 0.3 * tokenOverlap + 0.25 * fuzzy

    // --- reglas especiales: números (medidas/dimensiones) ---
    // Penalización SUAVE a propósito -- no se quiere esconder estas
    // opciones (ej. columnas de distinto tamaño con texto casi
    // idéntico), sino mostrarlas igual y dejar que el ingeniero elija
    // con criterio, viendo la medida marcada como distinta.
    const candNumeros = extraerNumeros(normCand)
    let medidaDistinta = false
    if (consultaNumeros.length > 0 && candNumeros.length > 0) {
      const coincideAlgunNumero = consultaNumeros.some((n) =>
        candNumeros.some((m) => Math.abs(n - m) < 0.001)
      )
      if (!coincideAlgunNumero) {
        score *= 0.85
        medidaDistinta = true
      }
    }

    // --- reglas especiales: unidad (M2, M3, UN...) ---
    let unidadDistinta = false
    if (consultaUnidad && candidato.unidad && consultaUnidad !== candidato.unidad) {
      score *= 0.85
      unidadDistinta = true
    }

    return {
      candidato,
      score: Math.min(1, Math.max(0, score)),
      detalle: { cosine, tokenOverlap, fuzzy, medidaDistinta, unidadDistinta },
    }
  })

  return resultados
    .filter((r) => r.score >= umbral)
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
}