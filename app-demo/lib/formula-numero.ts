// Fórmulas en los campos de pesos (pedido de Contabilidad, 2026-11-17): en la
// liquidación de un pago se puede escribir "=1.000.000*4%" o "1000000*0,04+500",
// como en Excel. Solo números en formato colombiano (los de leerNumero), + - * /,
// paréntesis y % al final de un número. Sin eval: un analizador recursivo,
// lineal en el largo del texto.

import { leerNumero } from "@/lib/contratos"

const OPERADORES = /[+\-*/()%]/

/** ¿El texto es una fórmula (empieza con "=" o tiene operaciones)? */
export function esFormula(texto: string): boolean {
  const t = texto.trim()
  if (t.startsWith("=")) return true
  // Un signo al principio ("-5") no la hace fórmula: se queda como número.
  return OPERADORES.test(t.replace(/^[+-]/, ""))
}

type Token = { tipo: "num"; valor: number } | { tipo: "op"; valor: string }

function tokens(texto: string): Token[] | null {
  const lista: Token[] = []
  let i = 0
  while (i < texto.length) {
    const c = texto[i]
    if (c === " " || c === "$") {
      i++
      continue
    }
    if (OPERADORES.test(c)) {
      lista.push({ tipo: "op", valor: c })
      i++
      continue
    }
    if (/[\d.,]/.test(c)) {
      let j = i
      while (j < texto.length && /[\d.,]/.test(texto[j])) j++
      const n = leerNumero(texto.slice(i, j))
      if (n == null) return null
      lista.push({ tipo: "num", valor: n })
      i = j
      continue
    }
    return null
  }
  return lista
}

/** Resultado de la fórmula (redondeado a centavos) o null si no se entiende. */
export function evaluarFormula(texto: string): number | null {
  const t = texto.trim().replace(/^=\+?/, "")
  if (t === "") return null
  const leidos = tokens(t)
  if (!leidos || leidos.length === 0) return null
  const lista: Token[] = leidos
  let pos = 0
  const ver = () => lista[pos]
  const esOp = (v: string) => ver()?.tipo === "op" && ver()!.valor === v

  // suma := producto (("+"|"-") producto)*
  function suma(): number | null {
    let a = producto()
    while (a != null && (esOp("+") || esOp("-"))) {
      const op = lista[pos++].valor
      const b = producto()
      if (b == null) return null
      a = op === "+" ? a + b : a - b
    }
    return a
  }
  // producto := unario (("*"|"/") unario)*
  function producto(): number | null {
    let a = unario()
    while (a != null && (esOp("*") || esOp("/"))) {
      const op = lista[pos++].valor
      const b = unario()
      if (b == null) return null
      if (op === "/" && b === 0) return null
      a = op === "*" ? a * b : a / b
    }
    return a
  }
  // unario := ("+"|"-") unario | primario "%"*
  function unario(): number | null {
    if (esOp("+") || esOp("-")) {
      const op = lista[pos++].valor
      const v = unario()
      return v == null ? null : op === "-" ? -v : v
    }
    let v = primario()
    while (v != null && esOp("%")) {
      pos++
      v = v / 100
    }
    return v
  }
  function primario(): number | null {
    const tk = ver()
    if (!tk) return null
    if (tk.tipo === "num") {
      pos++
      return tk.valor
    }
    if (tk.valor === "(") {
      pos++
      const v = suma()
      if (v == null || !esOp(")")) return null
      pos++
      return v
    }
    return null
  }

  const r = suma()
  if (r == null || pos !== lista.length || !Number.isFinite(r)) return null
  return Math.round(r * 100) / 100
}

/** Lee un campo de pesos: número o fórmula. null = vacío o no se entiende. */
export function leerNumeroOFormula(texto: string): number | null {
  return esFormula(texto) ? evaluarFormula(texto) : leerNumero(texto)
}
