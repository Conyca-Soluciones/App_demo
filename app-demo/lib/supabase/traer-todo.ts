// ---------------------------------------------------------------------------
// Trae TODAS las filas de una consulta, en páginas de `tamano`.
//
// La API de Supabase corta cada respuesta en `max_rows` filas (Settings ->
// API) SIN avisar: una tabla que lo supere se vería incompleta. Pidiendo por
// páginas (.range) la carga queda completa sin importar ese límite.
//
// `consulta(desde, hasta)` debe tener un ORDER BY sobre una columna única
// (o terminar en una), si no las páginas pueden repetir o saltarse filas.
// Sin dependencias de servidor: sirve en cliente y en Server Actions.
// ---------------------------------------------------------------------------

export async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamano = 1000
): Promise<T[]> {
  const filas: T[] = []
  for (let desde = 0; ; desde += tamano) {
    const { data, error } = await consulta(desde, desde + tamano - 1)
    if (error) throw new Error(error.message)
    filas.push(...(data ?? []))
    // Página incompleta = era la última.
    if (!data || data.length < tamano) return filas
  }
}
