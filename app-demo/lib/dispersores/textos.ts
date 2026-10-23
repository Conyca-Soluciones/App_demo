// Port EXACTO de nucleo/textos.py de la consola de dispersores (Python).
// Normalización: la misma regla se aplica al generar los archivos de los
// bancos. No cambiar sin volver a correr tests/dispersores-*.test.ts.

// Tabla 1 del manual de Itaú: letras sin tilde, la Ñ, dígitos y . , ; : - * & $
const PERMITIDOS = /[^A-Z0-9 .,;:\-*&$Ñ]/g

/** Deja solo números. Aguanta floats de Excel ('1116810898.0'), NIT con guion y espacios duros. */
export function digitos(valor: unknown): string {
  let s = String(valor ?? "").replace(/ /g, " ").trim()
  if (/^\d+\.0+$/.test(s)) s = s.split(".")[0]
  return s.replace(/\D/g, "")
}

/** Mayúsculas, sin espacios dobles ni espacios duros. */
export function texto(valor: unknown): string {
  const s = String(valor ?? "").replace(/ /g, " ")
  return s.replace(/\s+/g, " ").trim().toUpperCase()
}

export function sinTildes(valor: unknown): string {
  let s = texto(valor)
  // la Ñ se conserva: los cuatro bancos la aceptan
  s = s.replace(/Ñ/g, "\x01")
  // NFKD + encode("ascii", "ignore"): se quita todo lo que no sea ASCII
  s = s.normalize("NFKD").replace(/[^\x00-\x7F]/g, "")
  return s.replace(/\x01/g, "Ñ")
}

/** Deja el texto como lo aceptan los cuatro bancos. */
export function paraBanco(valor: unknown): string {
  return sinTildes(valor).replace(PERMITIDOS, " ").trim()
}

/** Para mostrar en pantalla: 1.234.567 */
export function pesos(n: number): string {
  const entero = Math.trunc(n)
  const signo = entero < 0 ? "-" : ""
  return signo + String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

/** Trunca al peso hacia abajo: 3501.80 -> 3501. */
export function aPesos(valor: number): number {
  return Math.floor(Math.round(valor * 100) / 100)
}

// --------------------------------------------------- total en letras (soporte.py)
const UNIDADES = [
  "", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISEIS",
  "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE",
]
const DECENAS = ["", "", "VEINTI", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"]
const CENTENAS = [
  "", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
  "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS",
]

function menorMil(n: number): string {
  if (n === 0) return ""
  if (n === 100) return "CIEN"
  const c = Math.floor(n / 100)
  const r = n % 100
  const partes: string[] = c ? [CENTENAS[c]] : []
  if (r <= 20) {
    partes.push(UNIDADES[r])
  } else {
    const d = Math.floor(r / 10)
    const u = r % 10
    if (d === 2) partes.push(u ? "VEINTI" + UNIDADES[u] : "VEINTE")
    else partes.push(DECENAS[d] + (u ? " Y " + UNIDADES[u] : ""))
  }
  return partes.filter((p) => p).join(" ").trim()
}

/** El total escrito, como en el soporte de Python (en_letras). */
export function enLetras(n: number): string {
  if (n === 0) return "CERO PESOS"
  const millones = Math.floor(n / 1_000_000)
  const resto = n % 1_000_000
  const miles = Math.floor(resto / 1000)
  const unidades = resto % 1000
  const partes: string[] = []
  if (millones) {
    partes.push(
      millones === 1
        ? "UN MILLON"
        : `${millones < 1000 ? menorMil(millones) : enLetras(millones).slice(0, -6)} MILLONES`
    )
  }
  if (miles) partes.push(miles === 1 ? "MIL" : `${menorMil(miles)} MIL`)
  if (unidades) partes.push(menorMil(unidades))
  return partes.join(" ").trim() + " PESOS"
}
