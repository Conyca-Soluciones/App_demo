// Dirección de entrega de las requisiciones (Paquete A, decisión del usuario:
// obligatoria en normales, extraordinarias y administrativas). La base la
// vuelve a validar (_fijar_direccion_requisicion, mismas reglas).

export const MAX_DIRECCION_ENTREGA = 300

/** Sin espacios de más: "  Cra 5  # 10-20 " -> "Cra 5 # 10-20". */
export function normalizarDireccion(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\s+/g, " ").trim()
}

/** null si sirve; si no, el motivo para mostrar. */
export function validarDireccion(texto: string | null | undefined): string | null {
  const d = normalizarDireccion(texto)
  if (!d) return "Falta la dirección de entrega."
  if (d.length > MAX_DIRECCION_ENTREGA) return `La dirección de entrega es muy larga (máximo ${MAX_DIRECCION_ENTREGA} caracteres).`
  return null
}

/**
 * Sitio de entrega sugerido para una OC con varias requisiciones: la dirección
 * si todas coinciden (sin importar mayúsculas ni espacios), y si no, las
 * distintas para que Compras elija. Las requisiciones de antes no tienen.
 */
export function direccionesDeRequisiciones(direcciones: (string | null | undefined)[]): {
  unica: string | null
  distintas: string[]
} {
  const vistas = new Map<string, string>()
  for (const d of direcciones) {
    const n = normalizarDireccion(d)
    if (!n) continue
    const clave = n.toLowerCase()
    if (!vistas.has(clave)) vistas.set(clave, n)
  }
  const distintas = [...vistas.values()]
  return { unica: distintas.length === 1 ? distintas[0] : null, distintas }
}
