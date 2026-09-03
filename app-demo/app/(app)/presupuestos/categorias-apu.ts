// Categorías del APU (Materiales / Mano de Obra / Equipo / Transporte),
// mapeadas a los valores REALES de maestro_insumos.tipo -- nada
// inventado, se sacó directamente de los 16 tipos que existen hoy en el
// maestro.
//
// OJO: esto vive en un archivo aparte de actions.ts a propósito. Un
// archivo "use server" solo puede exportar funciones async -- exportar
// esta constante (un array, no una función) desde actions.ts rompe el
// build con "A 'use server' file can only export async functions".

export const CATEGORIAS_APU = [
  { nombre: "Materiales", tipos: ["MATERIAL - M", "CONSUMIBLES - C"] },
  { nombre: "Mano de Obra", tipos: ["HONORARIOS - H", "NOMINA - N", "SUBCONTRATO - S"] },
  { nombre: "Equipo y Herramienta menor", tipos: ["EQUIPO - E", "MAQUINARIA - B"] },
  { nombre: "Transporte", tipos: ["TRANSPORTE - T"] },
  {
    nombre: "Otros",
    tipos: [
      "DOTACION - D",
      "SERVICIOS - Q",
      "SEÑALIZACIÓN - Ñ",
      "ELEMEN. PROTECCION - P",
      "ATENCIÓN EMERGENCIA - A",
      "LICENCIAS - L",
      "OFICINA - O",
      "DISEÑO-CONSULTORIA - F",
    ],
  },
] as const

export type NombreCategoriaApu = (typeof CATEGORIAS_APU)[number]["nombre"]