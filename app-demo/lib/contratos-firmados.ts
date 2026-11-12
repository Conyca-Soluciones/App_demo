// Copia del contrato y del otrosí firmada por el contratista (20270101001900).
// Sin imports de servidor: lo usan componentes de cliente.

export type ArchivoFirmado = {
  ruta: string
  nombre: string
  mime: string
  subidoAt: string
  subidoPorNombre: string | null
}

export type FirmadosContrato = {
  contrato: ArchivoFirmado | null
  // Por id de otrosí; solo los que ya tienen copia.
  otrosis: Record<string, ArchivoFirmado>
}

export const MIME_FIRMADO = ["application/pdf", "image/jpeg", "image/png"]
export const MAXIMO_FIRMADO = 10 * 1024 * 1024

export function validarArchivoFirmado(a: { name: string; size: number; type: string }): string | null {
  if (!MIME_FIRMADO.includes(a.type)) return "La copia firmada tiene que ser PDF, JPG o PNG."
  if (a.size <= 0 || a.size > MAXIMO_FIRMADO) return "El archivo no puede pasar de 10 MB."
  if (!a.name.trim() || a.name.length > 300) return "El nombre del archivo no es válido."
  return null
}

// <contrato>/firmado/<marca>.<ext> en el bucket contratos (la política exige la carpeta).
export function rutaArchivoFirmado(contratoId: string, nombre: string, marca: number): string {
  const ext = nombre.includes(".") ? nombre.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "pdf"
  return `${contratoId}/firmado/${marca}.${ext || "pdf"}`
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapArchivo(x: any): ArchivoFirmado | null {
  if (!x?.ruta) return null
  return {
    ruta: String(x.ruta),
    nombre: String(x.nombre ?? "copia-firmada"),
    mime: String(x.mime ?? "application/pdf"),
    subidoAt: String(x.subido_at ?? ""),
    subidoPorNombre: x.subido_por_nombre ?? null,
  }
}

export function mapFirmados(x: any): FirmadosContrato {
  const otrosis: Record<string, ArchivoFirmado> = {}
  for (const [id, v] of Object.entries(x?.otrosis ?? {})) {
    const a = mapArchivo(v)
    if (a) otrosis[id] = a
  }
  return { contrato: mapArchivo(x?.contrato), otrosis }
}
