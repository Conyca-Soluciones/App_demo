// Paginación de las listas: la base devuelve una página a la vez (así el costo
// no crece con todo el historial). Se pide UNA fila de más para saber si hay
// página siguiente sin hacer un conteo total (que obligaría a recorrer todo).
export const TAMANO_PAGINA = 50

// Rango de filas (.range de Supabase) de la página `pagina` (0 = primera),
// con la fila extra.
export const rangoPagina = (pagina: number): [number, number] => [
  pagina * TAMANO_PAGINA,
  pagina * TAMANO_PAGINA + TAMANO_PAGINA,
]

// De las filas pedidas (con la extra) devuelve la página y si hay más.
export function cortarPagina<T>(filas: T[]): { filas: T[]; hayMas: boolean } {
  return { filas: filas.slice(0, TAMANO_PAGINA), hayMas: filas.length > TAMANO_PAGINA }
}
