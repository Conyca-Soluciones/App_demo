// // // Categorías del APU (Materiales / Mano de Obra / Equipo / Transporte),
// // // mapeadas a los valores REALES de maestro_insumos.tipo -- nada
// // // inventado, se sacó directamente de los 16 tipos que existen hoy en el
// // // maestro.
// // //
// // // OJO: esto vive en un archivo aparte de actions.ts a propósito. Un
// // // archivo "use server" solo puede exportar funciones async -- exportar
// // // esta constante (un array, no una función) desde actions.ts rompe el
// // // build con "A 'use server' file can only export async functions".

// // export const CATEGORIAS_APU = [
// //   { nombre: "Materiales", tipos: ["MATERIAL - M", "CONSUMIBLES - C"] },
// //   { nombre: "Mano de Obra", tipos: ["HONORARIOS - H", "NOMINA - N", "SUBCONTRATO - S"] },
// //   { nombre: "Equipo y Herramienta menor", tipos: ["EQUIPO - E", "MAQUINARIA - B"] },
// //   { nombre: "Transporte", tipos: ["TRANSPORTE - T"] },
// //   {
// //     nombre: "Otros",
// //     tipos: [
// //       "DOTACION - D",
// //       "SERVICIOS - Q",
// //       "SEÑALIZACIÓN - Ñ",
// //       "ELEMEN. PROTECCION - P",
// //       "ATENCIÓN EMERGENCIA - A",
// //       "LICENCIAS - L",
// //       "OFICINA - O",
// //       "DISEÑO-CONSULTORIA - F",
// //     ],
// //   },
// // ] as const

// // export type NombreCategoriaApu = (typeof CATEGORIAS_APU)[number]["nombre"]

// // Categorías del APU (Materiales / Mano de Obra / Equipo / Transporte),
// // mapeadas a los valores REALES de maestro_insumos.tipo -- nada
// // inventado, se sacó directamente de los 16 tipos que existen hoy en el
// // maestro.
// //
// // OJO: esto vive en un archivo aparte de actions.ts a propósito. Un
// // archivo "use server" solo puede exportar funciones async -- exportar
// // esta constante (un array, no una función) desde actions.ts rompe el
// // build con "A 'use server' file can only export async functions".
// //
// // NOTA sobre Mano de Obra / Equipo / Transporte: este array solo se
// // consulta hoy para líneas de INSUMO real (maestro_insumos.tipo, que es
// // un enum confiable). Las líneas de mano de obra/equipo/transporte se
// // categorizan en apu-editor-dialog.tsx por la columna FK que trae la
// // fila en item_apu (mano_obra_categoria_id / equipo_categoria_id /
// // transporte_precio_id), NO comparando contra este array -- el
// // `item_apu.tipo` de esas líneas es el token crudo del Excel de origen
// // ("MO", "EQUIPO", "TRANSPORTE"), que nunca coincide con los valores de
// // maestro_insumos.tipo de acá abajo. Los tipos "HONORARIOS - H" /
// // "EQUIPO - E" / "MAQUINARIA - B" / "TRANSPORTE - T" quedan documentados
// // igual, por si algún insumo del maestro sigue catalogado con ellos
// // desde antes de que mano de obra/equipo/transporte tuvieran su propio
// // catálogo dedicado.

// export const CATEGORIAS_APU = [
//   { nombre: "Materiales", tipos: ["MATERIAL - M", "CONSUMIBLES - C"] },
//   { nombre: "Mano de Obra", tipos: ["HONORARIOS - H", "NOMINA - N", "SUBCONTRATO - S"] },
//   { nombre: "Equipo y Herramienta menor", tipos: ["EQUIPO - E", "MAQUINARIA - B"] },
//   { nombre: "Transporte", tipos: ["TRANSPORTE - T"] },
//   {
//     nombre: "Otros",
//     tipos: [
//       "DOTACION - D",
//       "SERVICIOS - Q",
//       "SEÑALIZACIÓN - Ñ",
//       "ELEMEN. PROTECCION - P",
//       "ATENCIÓN EMERGENCIA - A",
//       "LICENCIAS - L",
//       "OFICINA - O",
//       "DISEÑO-CONSULTORIA - F",
//     ],
//   },
// ] as const

// export type NombreCategoriaApu = (typeof CATEGORIAS_APU)[number]["nombre"]


// Categorías del APU (Materiales / Mano de Obra / Equipo / Transporte),
// mapeadas a los valores REALES de maestro_insumos.tipo -- nada
// inventado, se sacó directamente de los 16 tipos que existen hoy en el
// maestro.
//
// OJO: esto vive en un archivo aparte de actions.ts a propósito. Un
// archivo "use server" solo puede exportar funciones async -- exportar
// esta constante (un array, no una función) desde actions.ts rompe el
// build con "A 'use server' file can only export async functions".
//
// NOTA sobre Mano de Obra / Equipo / Transporte: este array solo se
// consulta hoy para líneas de INSUMO real (maestro_insumos.tipo, que es
// un enum confiable). Las líneas de mano de obra/equipo/transporte se
// categorizan en apu-editor-dialog.tsx por la columna FK que trae la
// fila en item_apu (mano_obra_categoria_id / equipo_categoria_id /
// transporte_precio_id), NO comparando contra este array -- el
// `item_apu.tipo` de esas líneas es el token crudo del Excel de origen
// ("MO", "EQUIPO", "TRANSPORTE"), que nunca coincide con los valores de
// maestro_insumos.tipo de acá abajo. Los tipos "HONORARIOS - H" /
// "EQUIPO - E" / "MAQUINARIA - B" / "TRANSPORTE - T" quedan documentados
// igual, por si algún insumo del maestro sigue catalogado con ellos
// desde antes de que mano de obra/equipo/transporte tuvieran su propio
// catálogo dedicado.

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