// Solicitudes de mano de obra y equipo (Aprobación de mano de obra y equipos,
// 2026-11-12). Lógica pura: la usan el servidor y la pantalla.
import { normalizarUnidad } from "@/lib/unidades"

// Misma actividad = mismo nombre sin mayúsculas ni espacios de más
// (igual que public._clave_actividad en la base).
export function claveActividad(texto: string | null | undefined): string {
  return String(texto ?? "").trim().replace(/\s+/g, " ").toLowerCase()
}

// Misma unidad: "m²" = "M2" = " m2 " (igual que public._clave_unidad).
export function claveUnidad(texto: string | null | undefined): string {
  return String(texto ?? "").replace(/²/g, "2").replace(/³/g, "3").trim().toLowerCase()
}

export function claveSolicitudRecurso(descripcion: string | null | undefined, unidad: string | null | undefined): string {
  return `${claveActividad(descripcion)}|${claveUnidad(unidad)}`
}

// Ítem del presupuesto que usa la solicitud.
export type ItemSolicitudRecurso = {
  codigo: string
  cantidad: number | null
  unidad: string | null
  capituloCodigo: string | null
  capitulo: string | null
  proyecto: string | null
}

// Orden del presupuesto: 1.2 antes que 1.10.
export function compararCodigos(a: string, b: string): number {
  const x = a.split(".").map((p) => Number(p.replace(/\D/g, "")) || 0)
  const y = b.split(".").map((p) => Number(p.replace(/\D/g, "")) || 0)
  for (let k = 0; k < Math.max(x.length, y.length); k++) {
    if ((x[k] ?? -1) !== (y[k] ?? -1)) return (x[k] ?? -1) - (y[k] ?? -1)
  }
  return 0
}

// Capítulos donde se usa ("4 ESTRUCTURAS"), sin repetir y en orden.
export function capitulosDe(items: ItemSolicitudRecurso[]): string[] {
  const porCodigo = new Map<string, string>()
  for (const i of items) {
    if (!i.capituloCodigo) continue
    if (!porCodigo.has(i.capituloCodigo)) porCodigo.set(i.capituloCodigo, `${i.capituloCodigo} ${(i.capitulo ?? "").trim()}`.trim())
  }
  return [...porCodigo.keys()].sort(compararCodigos).map((c) => porCodigo.get(c)!)
}

// Grupo propuesto = el nombre del primer capítulo, en mayúsculas y sin el
// número ("4 ESTRUCTURAS" -> "ESTRUCTURAS"). Vacío si no hay capítulo.
export function grupoDesdeCapitulo(items: ItemSolicitudRecurso[]): string {
  const primero = [...items].filter((i) => i.capituloCodigo).sort((a, b) => compararCodigos(a.capituloCodigo!, b.capituloCodigo!))[0]
  return (primero?.capitulo ?? "").trim().replace(/\s+/g, " ").toUpperCase()
}

// Unidad propuesta para la categoría: la de la solicitud (o la del primer
// ítem) con el código estándar ("m³" -> "M3", "und" -> "UND").
export function unidadPropuesta(unidad: string | null | undefined, items: ItemSolicitudRecurso[]): string {
  const cruda = unidad || items.find((i) => i.unidad)?.unidad || ""
  return normalizarUnidad(cruda) ?? ""
}

// "4.1.8.4, 4.1.16.4" con los códigos en orden y sin repetir.
export function codigosItems(items: ItemSolicitudRecurso[]): string {
  return [...new Set(items.map((i) => i.codigo).filter(Boolean))].sort(compararCodigos).join(", ")
}

// Una solicitud como la muestra Aprobación de mano de obra y equipos.
export type SolicitudRecursoAprobar = {
  id: string
  descripcion: string
  unidad: string | null
  grupoSugerido: string | null
  valorPropuesto: number | null
  createdAt: string
  solicitadoPorNombre: string | null
  items: ItemSolicitudRecurso[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapSolicitudRecursoAprobar(x: any): SolicitudRecursoAprobar {
  const items: ItemSolicitudRecurso[] = ((x?.items ?? []) as any[])
    .map((i) => ({
      codigo: String(i.codigo ?? ""),
      cantidad: i.cantidad == null ? null : Number(i.cantidad),
      unidad: i.unidad ?? null,
      capituloCodigo: i.capitulo_codigo ?? null,
      capitulo: i.capitulo ?? null,
      proyecto: i.proyecto ?? null,
    }))
    .sort((a, b) => compararCodigos(a.codigo, b.codigo))
  return {
    id: String(x.id),
    descripcion: String(x.descripcion ?? ""),
    unidad: x.unidad ?? null,
    grupoSugerido: x.grupo_sugerido ?? null,
    valorPropuesto: x.valor_propuesto == null ? null : Number(x.valor_propuesto),
    createdAt: String(x.created_at ?? ""),
    solicitadoPorNombre: x.solicitado_por_nombre ?? null,
    items,
  }
}
