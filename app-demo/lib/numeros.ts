// ---------------------------------------------------------------------------
// Cantidades escritas por el usuario en campos de texto (Entradas, Salidas,
// Modificar requisición). Son SOLO NÚMEROS ENTEROS (decisión del usuario).
//
// Antes se hacía Number(texto.replace(",", ".")): en Colombia "1.500" suele
// ser MIL QUINIENTOS, pero se leía como 1,5 y se guardaba sin avisar. Con
// enteros ya no hay ambigüedad: un punto o coma solo puede separar miles.
//
//   "1500" -> 1500      "1.500" -> 1500      "1.500.000" -> 1500000
//   "1,500" -> 1500     "1,5" / "2.25" / "1.5" -> error (no es entero)
// Sin dependencias: sirve en cliente y servidor.
// ---------------------------------------------------------------------------

export type CantidadLeida = { ok: true; valor: number } | { ok: false; error: string }

export function leerCantidadEntera(texto: string): CantidadLeida {
  const t = texto.trim().replace(/\s/g, "")
  if (t === "") return { ok: false, error: "Escribe una cantidad." }

  // Solo dígitos, o dígitos con separador de miles (grupos de 3, mismo signo).
  if (/^\d+$/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t) || /^\d{1,3}(,\d{3})+$/.test(t)) {
    const n = Number(t.replace(/[.,]/g, ""))
    if (Number.isSafeInteger(n)) return { ok: true, valor: n }
  }
  if (/^-/.test(t)) return { ok: false, error: "La cantidad no puede ser negativa." }
  if (/^[\d.,]+$/.test(t)) return { ok: false, error: `"${texto}": la cantidad debe ser un número entero, sin decimales.` }
  return { ok: false, error: `"${texto}" no es un número entero.` }
}

// Para validar en el servidor lo que ya llegó como número.
export function esCantidadEnteraPositiva(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0
}
