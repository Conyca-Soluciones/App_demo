import zlib from "zlib"

// ---------------------------------------------------------------------------
// ¿En qué página del PDF quedó el dato que se está editando?
//
// Cuando Jurídica entra a un campo de la minuta, la vista previa resalta ese
// dato y pone delante una marca invisible (MARCA_FOCO, texto blanco de 1 pt).
// @react-pdf no dice en qué página termina un texto, así que se busca la
// marca en el PDF ya generado: se recorren las páginas en orden, se
// descomprime el contenido de cada una y se busca la marca. Solo servidor
// (usa zlib); lo llama la ruta del PDF.
// ---------------------------------------------------------------------------

// "~~~~~~": no hay kerning en Helvetica para "~" (el texto no se parte) y no
// aparece en los contratos.
export const MARCA_FOCO = "~~~~~~"
const MARCA_HEX = Buffer.from(MARCA_FOCO, "latin1").toString("hex")

// En un párrafo justificado el PDF reparte espacio entre letras y la marca sale
// en pedazos: [<7e> -289 <7e> -289 ...] TJ. Se busca la secuencia completa.
const PEDAZOS_MARCA = /<(?:7e)+>(?:\s+-?[\d.]+\s+<(?:7e)+>)*/g

function posicionMarca(contenido: string): number {
  for (const m of contenido.matchAll(PEDAZOS_MARCA)) {
    // Solo lo que va entre < >, sin los espacios entre letras.
    const hex = [...m[0].matchAll(/<([0-9a-f]+)>/g)].map((x) => x[1]).join("")
    if (hex.includes(MARCA_HEX)) return m.index ?? -1
  }
  return -1
}

type Matriz = [number, number, number, number, number, number]
const IDENTIDAD: Matriz = [1, 0, 0, 1, 0, 0]

// m1 × m2 (convención PDF: un punto p se transforma como p × m1 × m2).
function multiplicar(m1: Matriz, m2: Matriz): Matriz {
  const [a, b, c, d, e, f] = m1
  const [A, B, C, D, E, F] = m2
  return [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F]
}

// Altura (en puntos, desde abajo) donde empieza la marca dentro del contenido
// de la página: se siguen q/Q, cm y Tm hasta la marca.
function alturaMarca(contenido: string, posicion: number): number | null {
  const token = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(cm|Tm)\b|(?<![\w/])(q|Q)(?![\w])/g
  const pila: Matriz[] = []
  let ctm: Matriz = IDENTIDAD
  let tm: Matriz = IDENTIDAD
  let m: RegExpExecArray | null
  while ((m = token.exec(contenido)) && m.index < posicion) {
    if (m[8] === "q") pila.push(ctm)
    else if (m[8] === "Q") ctm = pila.pop() ?? IDENTIDAD
    else {
      const matriz = m.slice(1, 7).map(Number) as Matriz
      if (m[7] === "cm") ctm = multiplicar(matriz, ctm)
      else tm = matriz
    }
  }
  const [, , , , e, f] = multiplicar(tm, ctm)
  return Number.isFinite(f) && Number.isFinite(e) ? f : null
}

function objeto(pdf: string, numero: number): { cuerpo: string; inicio: number } | null {
  const re = new RegExp(`(?:^|[\\r\\n])${numero} 0 obj`, "m")
  const m = re.exec(pdf)
  if (!m) return null
  const inicio = m.index + m[0].length
  const fin = pdf.indexOf("endobj", inicio)
  return fin < 0 ? null : { cuerpo: pdf.slice(inicio, fin), inicio }
}

export function buscarMarcaEnPdf(buffer: Buffer | Uint8Array): { pagina: number; altura: number | null } | null {
  const pdf = Buffer.from(buffer).toString("latin1")
  const kids = /\/Kids \[([^\]]*)\]/.exec(pdf)
  if (!kids) return null
  const paginas = [...kids[1].matchAll(/(\d+) 0 R/g)].map((x) => Number(x[1]))
  for (let i = 0; i < paginas.length; i++) {
    const pagina = objeto(pdf, paginas[i])
    const contents = pagina && /\/Contents (\d+) 0 R/.exec(pagina.cuerpo)
    if (!contents) continue
    const flujo = objeto(pdf, Number(contents[1]))
    if (!flujo) continue
    const ini = /stream\r?\n/.exec(flujo.cuerpo)
    if (!ini) continue
    const fin = flujo.cuerpo.lastIndexOf("endstream")
    let contenido: string
    try {
      contenido = zlib.inflateSync(Buffer.from(flujo.cuerpo.slice(ini.index + ini[0].length, fin), "latin1")).toString("latin1")
    } catch {
      continue
    }
    const posicion = posicionMarca(contenido)
    if (posicion >= 0) return { pagina: i + 1, altura: alturaMarca(contenido, posicion) }
  }
  return null
}
