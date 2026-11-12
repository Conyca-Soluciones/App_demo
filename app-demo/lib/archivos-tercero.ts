// Archivos de un tercero (RUT, certificación bancaria) y comprobantes de pago:
// PDF, JPG o PNG de hasta 10 MB (la base vuelve a revisar el tipo).

export const TIPOS_ARCHIVO_TERCERO = ["application/pdf", "image/jpeg", "image/png"] as const
export const MAXIMO_ARCHIVO_TERCERO = 10 * 1024 * 1024

/** null si sirve; si no, el mensaje ("El RUT debe ser PDF, JPG o PNG."). */
export function revisarArchivoTercero(f: { type: string; size: number }, que: string): string | null {
  if (!(TIPOS_ARCHIVO_TERCERO as readonly string[]).includes(f.type)) return `${que} debe ser PDF, JPG o PNG.`
  if (f.size > MAXIMO_ARCHIVO_TERCERO) return `${que} pesa más de 10 MB.`
  return null
}

export const extensionArchivo = (f: { type: string }) => (f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : "jpg")
