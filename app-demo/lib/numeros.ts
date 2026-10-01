// ---------------------------------------------------------------------------
// Cantidades escritas por el usuario en campos de texto (Entradas, Salidas,
// Modificar requisición). Antes se hacía Number(texto.replace(",", ".")):
// en Colombia "1.500" suele ser MIL QUINIENTOS, pero se leía como 1,5 y se
// guardaba sin ningún aviso.
//
// Reglas:
//   "1500" -> 1500        "1,5" -> 1.5          "0.125" -> 0.125
//   "1.500,5" -> 1500.5   "1,500.5" -> 1500.5   "1.500.000" -> 1500000
//   "2.25" -> 2.25 (un punto con 1-2 decimales: decimal)
//   "1.500" -> AMBIGUO (podría ser 1500 o 1,5): se pide escribirlo sin
//   separador de miles o con coma decimal, en vez de adivinar.
// Sin dependencias: sirve en cliente y servidor.
// ---------------------------------------------------------------------------

export type CantidadLeida = { ok: true; valor: number } | { ok: false; error: string }

export function leerCantidad(texto: string): CantidadLeida {
  const t = texto.trim().replace(/\s/g, "")
  if (t === "") return { ok: false, error: "Escribe una cantidad." }
  if (!/^-?[\d.,]+$/.test(t)) return { ok: false, error: `"${texto}" no es un número.` }

  const puntos = (t.match(/\./g) ?? []).length
  const comas = (t.match(/,/g) ?? []).length
  let normalizado: string

  if (puntos > 0 && comas > 0) {
    // El último separador es el decimal; el otro, de miles.
    const decimalEsComa = t.lastIndexOf(",") > t.lastIndexOf(".")
    normalizado = decimalEsComa ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "")
  } else if (comas > 0) {
    if (comas > 1) return { ok: false, error: `"${texto}": usa coma solo para los decimales (ej. 1,5).` }
    normalizado = t.replace(",", ".")
  } else if (puntos > 1) {
    normalizado = t.replace(/\./g, "") // 1.500.000
  } else if (puntos === 1) {
    const [entero, decimales] = t.split(".")
    const sinSigno = entero.replace("-", "")
    if (decimales.length === 3 && sinSigno !== "" && sinSigno !== "0") {
      return {
        ok: false,
        error: `"${texto}" es ambiguo: escribe ${entero}${decimales} (sin punto) si son miles, o ${entero},${decimales} si son decimales.`,
      }
    }
    normalizado = t
  } else {
    normalizado = t
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? { ok: true, valor: n } : { ok: false, error: `"${texto}" no es un número.` }
}
