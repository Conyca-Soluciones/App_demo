import * as XLSX from "xlsx"

/**
 * Genera y descarga un archivo Excel de plantilla, con solo los encabezados
 * (o encabezados + filas de ejemplo, si las pasas). Reutilizable para
 * presupuesto, APU, cuadro de pago, insumos, etc. — solo cambian los
 * argumentos, no la lógica.
 */
export function exportarPlantillaExcel({
  columnas,
  nombreArchivo,
  nombreHoja = "Plantilla",
  filasEjemplo = [],
}: {
  columnas: string[]
  nombreArchivo: string
  nombreHoja?: string
  filasEjemplo?: (string | number)[][]
}) {
  const filas = [columnas, ...filasEjemplo]

  const worksheet = XLSX.utils.aoa_to_sheet(filas)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, nombreHoja)

  XLSX.writeFile(workbook, nombreArchivo)
}