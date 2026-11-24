// Anexos de la requisición (20270101006000): archivos opcionales para que Compras
// tenga más información (planos, fichas técnicas, fotos, cotizaciones...). Las mismas
// reglas que exige la base (agregar_anexo_requisicion y el bucket "requisiciones").

export const MIME_ANEXO_REQUISICION = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const

export const ACEPTA_ANEXO_REQUISICION = ".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
export const TAMANO_MAXIMO_ANEXO = 10 * 1024 * 1024
export const MAX_ANEXOS_REQUISICION = 10

export type AnexoRequisicion = { id: string; nombreArchivo: string; mime: string | null; tamano: number | null; creadoEn: string }

/** null = sirve; si no, por qué no. */
export function validarAnexoRequisicion(archivo: { name: string; type: string; size: number }): string | null {
  if (!(MIME_ANEXO_REQUISICION as readonly string[]).includes(archivo.type)) {
    return `"${archivo.name}": el anexo debe ser PDF, imagen (JPG, PNG), Excel o Word.`
  }
  if (archivo.size > TAMANO_MAXIMO_ANEXO) return `"${archivo.name}" pesa más de 10 MB.`
  if (archivo.size <= 0) return `"${archivo.name}" está vacío.`
  return null
}

/** Ruta en el bucket: la carpeta es la requisición (la política del bucket lo exige). */
export function rutaAnexoRequisicion(requisicionId: string, archivo: { name: string }, aleatorio: string): string {
  const ext = archivo.name.includes(".") ? archivo.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin"
  return `${requisicionId}/${aleatorio}.${ext || "bin"}`
}

export function tamanoLegible(bytes: number | null): string {
  if (bytes == null) return ""
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`
}
