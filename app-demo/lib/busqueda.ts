// Comodín de los buscadores de texto: escribir "_" lista las opciones
// disponibles (en Postgres, ilike '%_%' coincide con cualquier texto no
// vacío). Cualquier otro texto sigue pidiendo al menos MIN_CARACTERES.
export const COMODIN_LISTAR = "_"
export const MIN_CARACTERES = 2
export const LIMITE_BUSQUEDA = 15
// Cuando se pide "ver todo" se muestran más opciones que en una búsqueda normal.
export const LIMITE_LISTAR = 50

export function puedeBuscar(termino: string | null | undefined, minimo = MIN_CARACTERES): boolean {
  const t = (termino ?? "").trim()
  return t === COMODIN_LISTAR || t.length >= minimo
}

export function limiteBusqueda(termino: string): number {
  return termino.trim() === COMODIN_LISTAR ? LIMITE_LISTAR : LIMITE_BUSQUEDA
}
