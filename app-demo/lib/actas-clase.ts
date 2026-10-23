// Actas por grupos (contratos por grupos, pestaña contratos.cortes) y Actas
// generales (contratos generales, pestaña contratos.actas_generales;
// 20261225000000_actas_generales.sql). Mismas tablas, funciones y pantalla:
// solo cambia qué contratos se buscan y qué pestaña se pide.

export type ClaseActas = "grupo" | "general"

export const PESTANA_ACTAS: Record<ClaseActas, string> = {
  grupo: "contratos.cortes",
  general: "contratos.actas_generales",
}

export const RUTA_ACTAS: Record<ClaseActas, string> = {
  grupo: "/contratos/actas",
  general: "/contratos/actas-generales",
}

export const TITULO_ACTAS: Record<ClaseActas, string> = {
  grupo: "Actas por grupos",
  general: "Actas generales",
}

// Las pestañas desde las que se trabaja un acta (cualquiera de las dos clases).
export const PESTANAS_ELABORAR_ACTAS = [PESTANA_ACTAS.grupo, PESTANA_ACTAS.general]

export const esClaseActas = (x: unknown): x is ClaseActas => x === "grupo" || x === "general"
