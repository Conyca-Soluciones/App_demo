const UNIDADES = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
  "dieciocho", "diecinueve", "veinte",
]

const DECENAS = [
  "", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa",
]

const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
]

// Convierte un número entre 0 y 999 a texto.
function convertirGrupo(n: number): string {
  if (n === 0) return ""
  if (n === 100) return "cien"

  const centena = Math.floor(n / 100)
  const resto = n % 100
  let resultado = centena > 0 ? CENTENAS[centena] : ""

  if (resto > 0) {
    if (resultado) resultado += " "
    if (resto <= 20) {
      resultado += UNIDADES[resto]
    } else {
      const decena = Math.floor(resto / 10)
      const unidad = resto % 10
      if (decena === 2 && unidad > 0) {
        resultado += "veinti" + UNIDADES[unidad]
      } else {
        resultado += DECENAS[decena]
        if (unidad > 0) resultado += " y " + UNIDADES[unidad]
      }
    }
  }

  return resultado
}

// Soporta hasta 999,999,999 (999 millones) -- de sobra para una orden de
// compra de construcción. Si algún día se necesita más, hay que agregar el
// grupo de "mil millones".
export function numeroATexto(n: number): string {
  if (n === 0) return "cero"

  const millones = Math.floor(n / 1_000_000)
  const miles = Math.floor((n % 1_000_000) / 1000)
  const resto = n % 1000

  const partes: string[] = []

  if (millones > 0) {
    partes.push(millones === 1 ? "un millón" : `${convertirGrupo(millones)} millones`)
  }
  if (miles > 0) {
    partes.push(miles === 1 ? "mil" : `${convertirGrupo(miles)} mil`)
  }
  if (resto > 0) {
    partes.push(convertirGrupo(resto))
  }

  return partes.join(" ").trim()
}

// Formatea un valor en pesos colombianos a texto, con centavos -- lo que
// necesita la línea "Son:" del PDF de la orden de compra.
export function numeroALetrasCOP(valor: number): string {
  const pesos = Math.floor(valor)
  const centavos = Math.round((valor - pesos) * 100)

  const pesosTexto = numeroATexto(pesos).toUpperCase()
  // Millones exactos llevan "de": "DOS MILLONES DE PESOS".
  const etiquetaPesos = pesos === 1 ? "PESO" : pesos >= 1_000_000 && pesos % 1_000_000 === 0 ? "DE PESOS" : "PESOS"

  if (centavos === 0) {
    return `${pesosTexto} ${etiquetaPesos} M/CTE`
  }

  const centavosTexto = numeroATexto(centavos).toUpperCase()
  const etiquetaCentavos = centavos === 1 ? "CENTAVO" : "CENTAVOS"

  return `${pesosTexto} ${etiquetaPesos} CON ${centavosTexto} ${etiquetaCentavos} M/CTE`
}