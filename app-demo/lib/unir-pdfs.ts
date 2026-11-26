// Une PDF en uno solo (solo servidor): el soporte de la caja menor es la
// relación de gastos seguida del soporte de cada gasto (20270101007700).
//
// PENDIENTE: necesita la librería pdf-lib (no está instalada). Mientras tanto,
// si hay soportes en PDF, se avisa en vez de generar un soporte incompleto.
export async function unirPdfs(principal: Uint8Array, anexos: { titulo: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
  if (anexos.length === 0) return principal
  throw new Error(
    `Hay ${anexos.length} soporte(s) en PDF y todavía no se pueden pegar al soporte de la caja menor (falta instalar pdf-lib).`
  )
}
