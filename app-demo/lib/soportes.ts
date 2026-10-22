// Soportes de órdenes de compra y de entradas (T4,
// 20261202000000_soportes_oc_actas_entradas.sql). Buckets privados
// `ordenes_compra` y `entradas`: el navegador sube el archivo con la sesión
// del usuario y la base lo registra (revisa que exista).

export type TipoSoporteOrden = "cotizacion" | "cuenta_cobro" | "factura"
export const ETIQUETA_SOPORTE_ORDEN: Record<TipoSoporteOrden, string> = {
  cotizacion: "Cotización",
  cuenta_cobro: "Cuenta de cobro",
  factura: "Factura",
}

export const MIME_SOPORTE_DOCUMENTO = ["application/pdf", "image/jpeg", "image/png"]
export const TAMANO_MAXIMO_SOPORTE_DOCUMENTO = 10 * 1024 * 1024

export function validarArchivoSoporte(archivo: File): string | null {
  if (!MIME_SOPORTE_DOCUMENTO.includes(archivo.type)) return "Solo PDF, JPG o PNG."
  if (archivo.size > TAMANO_MAXIMO_SOPORTE_DOCUMENTO) return "El archivo pesa más de 10 MB."
  return null
}

// "<carpeta>/<nombre>.<ext>" sin caracteres raros (la ruta va a Storage).
export function rutaSoporte(carpeta: string, nombre: string, archivo: File): string {
  const ext = archivo.name.includes(".") ? archivo.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin"
  return `${carpeta}/${nombre}-${Date.now()}.${ext || "bin"}`
}

// Lo que se manda a la base después de subir el archivo.
export type SoporteSubidoArchivo = {
  ruta: string
  nombreArchivo: string
  tamano: number
  mime: string
}

export type SoporteGuardado = {
  id: string
  tipo: string
  nombreArchivo: string
  mime: string | null
}
