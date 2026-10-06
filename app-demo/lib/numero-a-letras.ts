// ---------------------------------------------------------------------------
// Números en letras (español de Colombia) para la línea "Son:" del PDF de la
// orden de compra y para el valor y el anticipo de los contratos.
//
// Reglas que ya fallaron y tienen prueba (tests/numero-a-letras.test.ts):
//   * "uno" se apocopa delante de lo que cuenta: UN PESO, VEINTIÚN MIL,
//     TREINTA Y UN MILLONES, CIENTO UN MIL (no "UNO PESO", "VEINTIUNO MIL").
//   * 21-29 llevan tilde donde corresponde: veintidós, veintitrés, veintiséis.
//   * Desde mil millones: "MIL MILLONES", "DOS MIL QUINIENTOS MILLONES"
//     (antes salía "UNDEFINED MILLONES").
//   * Millones exactos llevan "de": DOS MILLONES DE PESOS.
// Hasta 999.999.999.999 (casi un billón); más que eso se devuelve en cifras.
// ---------------------------------------------------------------------------

const UNIDADES = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
  "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
  "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
]

const DECENAS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]

const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
]

// 0..999 en letras. `apocope`: el número va delante de un sustantivo (pesos,
// mil, millones) y "uno" pasa a "un" ("veintiuno" a "veintiún").
function convertirGrupo(n: number, apocope: boolean): string {
  if (n === 0) return ""
  if (n === 100) return "cien"

  const centena = Math.floor(n / 100)
  const resto = n % 100
  const partes: string[] = []
  if (centena > 0) partes.push(CENTENAS[centena])

  if (resto > 0) {
    let texto: string
    if (resto < 30) texto = UNIDADES[resto]
    else {
      const unidad = resto % 10
      texto = DECENAS[Math.floor(resto / 10)] + (unidad > 0 ? ` y ${UNIDADES[unidad]}` : "")
    }
    if (apocope) texto = texto.replace(/veintiuno$/, "veintiún").replace(/(^|\s)uno$/, "$1un")
    partes.push(texto)
  }

  return partes.join(" ")
}

// 0..999.999 en letras.
function hastaMillon(n: number, apocope: boolean): string {
  const miles = Math.floor(n / 1000)
  const resto = n % 1000
  const partes: string[] = []
  if (miles > 0) partes.push(miles === 1 ? "mil" : `${convertirGrupo(miles, true)} mil`)
  if (resto > 0) partes.push(convertirGrupo(resto, apocope))
  return partes.join(" ")
}

// Entero no negativo en letras. Sin `apocope` termina en "uno" ("veintiuno");
// con `apocope`, en "un" ("veintiún"), para ponerle el sustantivo después.
export function numeroATexto(n: number, apocope = false): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return String(n)
  if (n === 0) return "cero"

  const millones = Math.floor(n / 1_000_000)
  const resto = n % 1_000_000
  const partes: string[] = []
  // Los millones se cuentan como cualquier número hasta 999.999: "mil
  // millones", "doscientos un millones" (con apócope: van delante de "millones").
  if (millones > 0) partes.push(millones === 1 ? "un millón" : `${hastaMillon(millones, true)} millones`)
  if (resto > 0) partes.push(hastaMillon(resto, apocope))
  return partes.join(" ")
}

// Valor en pesos colombianos en letras, con centavos y "M/CTE".
export function numeroALetrasCOP(valor: number): string {
  // En centavos enteros: con (valor - pesos) * 100, 1,996 daba "100 centavos".
  const totalCentavos = Math.round(valor * 100)
  const pesos = Math.floor(totalCentavos / 100)
  const centavos = totalCentavos % 100

  const pesosTexto = numeroATexto(pesos, true).toUpperCase()
  // Millones exactos llevan "de": "DOS MILLONES DE PESOS".
  const etiquetaPesos = pesos === 1 ? "PESO" : pesos >= 1_000_000 && pesos % 1_000_000 === 0 ? "DE PESOS" : "PESOS"

  if (centavos === 0) {
    return `${pesosTexto} ${etiquetaPesos} M/CTE`
  }

  const centavosTexto = numeroATexto(centavos, true).toUpperCase()
  const etiquetaCentavos = centavos === 1 ? "CENTAVO" : "CENTAVOS"

  return `${pesosTexto} ${etiquetaPesos} CON ${centavosTexto} ${etiquetaCentavos} M/CTE`
}
