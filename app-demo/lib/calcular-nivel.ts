// lib/calcular-nivel.ts
//
// Deriva el "Nivel" jerárquico de cada ítem a partir de su código, sin
// necesitar una columna "Nivel" separada en el Excel. Soporta DOS
// formatos de código, que pueden mezclarse en el mismo archivo:
//
//   A) Con puntos (o comas, que Excel en configuración regional
//      colombiana a veces usa como separador decimal):
//         "1", "1.1", "1.2", "4.1.1.1", "5,1" (= "5.1")
//      -> nivel = cantidad de segmentos separados por punto. Siempre
//         se resuelve sin ambigüedad, sin importar la longitud del
//         capítulo (soporta capítulo "1" o capítulo "100").
//
//   B) Dígitos seguidos, sin puntos: "1", "10", "101", "10101"
//      -> el capítulo puede tener 1, 2 o 3 dígitos (hasta 999
//         capítulos), lo que por sí solo es ambiguo (ej. "100" podría
//         ser el capítulo 100, o el subcapítulo "00" del capítulo "1").
//         Para resolverlo SIN ambigüedad se usa el CONTEXTO: se
//         procesan los códigos en el orden del archivo, manteniendo
//         una pila (stack) de qué código está "abierto" en cada nivel.
//
//         Un código es descendiente de un ancestro abierto en el stack
//         si EMPIEZA con ese ancestro y le sobran dígitos de a pares
//         (2, 4, 6...) -- cada par de dígitos extra es un nivel más
//         de profundidad. Esto permite que un capítulo "salte"
//         directo a un ítem sin subcapítulo intermedio: con "2"
//         (capítulo, 1 dígito) abierto, "20101" (5 dígitos, 4 extra =
//         2 pares) resuelve directo a nivel 3, sin necesitar un "201"
//         de por medio. Se busca el ancestro más profundo posible
//         (recorriendo el stack de más reciente a más antiguo) para
//         no perder profundidad cuando sí existe un subcapítulo
//         intermedio real (ej. "101" abierto -> "10101" es su hijo
//         directo, nivel = padre+1, no salta a más).
//
// Esto requiere procesar las filas EN ORDEN (de arriba hacia abajo del
// Excel), por eso calcularNivelDesdeCodigo recibe y muta un `stack`
// compartido entre llamadas -- no es una función pura aislada.

export type ResultadoNivel =
  | { ok: true; nivel: number }
  | { ok: false; razon: "vacio" | "formato_no_reconocido" }

// Crea un stack nuevo -- llamar una vez por archivo importado, antes de
// procesar la primera fila.
export function nuevoStackNiveles(): string[] {
  return []
}

export function calcularNivelDesdeCodigo(codigoRaw: string, stack: string[]): ResultadoNivel {
  const codigoOriginal = (codigoRaw ?? "").trim()
  if (!codigoOriginal) return { ok: false, razon: "vacio" }

  // Coma como separador decimal -> se trata igual que el punto.
  const codigo = codigoOriginal.replace(/,/g, ".")

  // --- Patrón A: con puntos -- sin ambigüedad, no depende del stack ---
  if (codigo.includes(".")) {
    const partes = codigo.split(".").filter((p) => p !== "")
    const esValido = partes.length > 0 && partes.every((p) => /^\d+$/.test(p))
    if (!esValido) return { ok: false, razon: "formato_no_reconocido" }
    const nivel = partes.length
    while (stack.length >= nivel) stack.pop()
    stack.push(codigo)
    return { ok: true, nivel }
  }

  // --- Patrón B: dígitos seguidos -- usa el stack para resolver el nivel ---
  if (!/^\d+$/.test(codigo)) return { ok: false, razon: "formato_no_reconocido" }

  // Busca, del ancestro más reciente al más antiguo, el primero del que
  // el código actual sea descendiente (empieza con él, y le sobran
  // dígitos en pares completos). El primer match recorriendo desde el
  // final del stack ya es el ancestro más profundo posible.
  for (let i = stack.length - 1; i >= 0; i--) {
    const ancestro = stack[i].replace(/\./g, "")
    if (codigo.startsWith(ancestro) && codigo.length > ancestro.length) {
      const digitosExtra = codigo.length - ancestro.length
      if (digitosExtra % 2 === 0) {
        const bloquesExtra = digitosExtra / 2
        const nivel = i + 1 + bloquesExtra
        stack.length = i + 1
        stack.push(codigo)
        return { ok: true, nivel }
      }
    }
  }

  // No es descendiente de nada abierto -> nuevo capítulo (nivel 1). Se
  // acepta de 1 a 3 dígitos (hasta 999 capítulos).
  if (codigo.length >= 1 && codigo.length <= 3) {
    stack.length = 0
    stack.push(codigo)
    return { ok: true, nivel: 1 }
  }

  return { ok: false, razon: "formato_no_reconocido" }
}

export function mensajeError(razon: "vacio" | "formato_no_reconocido"): string {
  return razon === "vacio"
    ? "código vacío"
    : "código en un formato no reconocido (debe ser tipo 1 / 1.1 / 4.1.1.1, o 1 / 101 / 10101 -- este último debe encajar como descendiente del capítulo/subcapítulo anterior, agregando dígitos de a pares)"
}