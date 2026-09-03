// /**
//  * Tipos compartidos del import de APU. Viven acá, en un archivo plano sin
//  * "use server" ni "use client", en vez de en actions.ts -- así los
//  * archivos de cliente (revision-import-apu-dialog.tsx) pueden importarlos
//  * sin arrastrar accidentalmente actions.ts (y lib/supabase/server.ts, que
//  * usa next/headers) a su bundle.
//  *
//  * actions.ts importa estos mismos tipos desde acá en vez de declararlos
//  * localmente -- una sola fuente de verdad para cada tipo.
//  */

// import type { TipoInsumoApu } from "@/lib/parse-apu-excel"

// // Mismo shape que InsumoSimilar en actions.ts, duplicado A PROPÓSITO acá
// // -- este archivo no debe importar NADA de actions.ts (ni siquiera tipos),
// // para no arrastrar next/headers al bundle de cliente. Al ser tipado
// // estructural (no nominal), los valores reales que devuelve la server
// // action siguen encajando perfecto en este tipo sin ningún cast.
// export type CandidatoInsumo = {
//   id: string
//   codigo: number
//   descripcion: string
//   u_m: string | null
//   tipo: string | null
//   vr_unitario: number | null
//   similitud: number
//   medidaDistinta: boolean
//   unidadDistinta: boolean
// }

// export type LineaApuExcelInput = {
//   descripcion: string
//   tipo: TipoInsumoApu
//   unidad: string | null
//   cantidad: number
// }

// export type BloqueApuInput = {
//   codigoItem: string
//   nombreItem: string
//   lineas: LineaApuExcelInput[]
// }

// export type ResolucionInsumo = {
//   descripcionOriginal: string
//   estado: "auto_match" | "requiere_revision"
//   insumoIdAsignado: string | null
//   candidatosSugeridos: CandidatoInsumo[]
//   precioPlaceholder: boolean
// }

// // ---- Guardado inmediato + revisión en pestaña aparte ----
// // Combina cada línea de un bloque con SU resolución (matchearInsumosApuImport
// // devuelve una resolución POR DESCRIPCIÓN ÚNICA -- esto la reparte de vuelta
// // a cada línea, para poder guardar todo de una vez).

// export type LineaImportConResolucion = LineaApuExcelInput & {
//   estado: "auto_match" | "requiere_revision"
//   insumoIdAsignado: string | null
//   candidatosSugeridos: CandidatoInsumo[]
// }

// export type BloqueConResolucion = {
//   codigoItem: string
//   nombreItem: string
//   lineas: LineaImportConResolucion[]
// }

// // Una fila de apu_import_revision, tal como la lee la pestaña de
// // revisión (candidatos ya vienen calculados, no se re-busca nada ahí).
// export type FilaRevisionImport = {
//   id: string
//   loteImportId: string
//   presupuestoItemId: string
//   apuId: string
//   descripcionOriginal: string
//   tipo: string | null
//   unidad: string | null
//   cantidad: number
//   candidatos: CandidatoInsumo[]
//   estado: "auto_match" | "pendiente" | "solicitud_pendiente" | "resuelto" | "rechazado"
//   insumoIdAsignado: string | null
//   itemApuId: string | null
//   // motivo que escribió el admin al rechazar (viene de
//   // solicitudes_insumos.motivo_rechazo via solicitud_id) -- null si esta
//   // línea no está rechazada, o si el admin no escribió nada.
//   motivoRechazo: string | null
// }

// /**
//  * matchearInsumosApuImport dedup por descripción y devuelve UNA
//  * resolución por descripción única -- para guardar hace falta la
//  * resolución repartida de vuelta a CADA línea de cada bloque. Vive acá
//  * (no en actions.ts) porque page.tsx la necesita del lado del cliente,
//  * antes de guardar nada.
//  */
// export function combinarBloquesConResoluciones(
//   bloques: BloqueApuInput[],
//   resoluciones: ResolucionInsumo[]
// ): BloqueConResolucion[] {
//   const porDescripcion = new Map(
//     resoluciones.map((r) => [r.descripcionOriginal.trim().toLowerCase(), r])
//   )

//   return bloques.map((bloque) => ({
//     codigoItem: bloque.codigoItem,
//     nombreItem: bloque.nombreItem,
//     lineas: bloque.lineas.map((linea) => {
//       const resolucion = porDescripcion.get(linea.descripcion.trim().toLowerCase())
//       return {
//         ...linea,
//         estado: resolucion?.estado ?? "requiere_revision",
//         insumoIdAsignado: resolucion?.insumoIdAsignado ?? null,
//         candidatosSugeridos: resolucion?.candidatosSugeridos ?? [],
//       }
//     }),
//   }))
// }

/**
 * Tipos compartidos del import de APU. Viven acá, en un archivo plano sin
 * "use server" ni "use client", en vez de en actions.ts -- así los
 * archivos de cliente (revision-import-apu-dialog.tsx) pueden importarlos
 * sin arrastrar accidentalmente actions.ts (y lib/supabase/server.ts, que
 * usa next/headers) a su bundle.
 *
 * actions.ts importa estos mismos tipos desde acá en vez de declararlos
 * localmente -- una sola fuente de verdad para cada tipo.
 */

/**
 * Tipos compartidos del import de APU. Viven acá, en un archivo plano sin
 * "use server" ni "use client", en vez de en actions.ts -- así los
 * archivos de cliente (revision-import-apu-dialog.tsx) pueden importarlos
 * sin arrastrar accidentalmente actions.ts (y lib/supabase/server.ts, que
 * usa next/headers) a su bundle.
 *
 * actions.ts importa estos mismos tipos desde acá en vez de declararlos
 * localmente -- una sola fuente de verdad para cada tipo.
 */

import type { TipoInsumoApu } from "@/lib/parse-apu-excel"

// Mismo shape que InsumoSimilar en actions.ts, duplicado A PROPÓSITO acá
// -- este archivo no debe importar NADA de actions.ts (ni siquiera tipos),
// para no arrastrar next/headers al bundle de cliente. Al ser tipado
// estructural (no nominal), los valores reales que devuelve la server
// action siguen encajando perfecto en este tipo sin ningún cast.
export type CandidatoInsumo = {
  id: string
  codigo: number
  descripcion: string
  u_m: string | null
  tipo: string | null
  vr_unitario: number | null
  similitud: number
  medidaDistinta: boolean
  unidadDistinta: boolean
}

export type LineaApuExcelInput = {
  descripcion: string
  tipo: TipoInsumoApu
  unidad: string | null
  cantidad: number
}

export type BloqueApuInput = {
  codigoItem: string
  nombreItem: string
  lineas: LineaApuExcelInput[]
}

export type ResolucionInsumo = {
  descripcionOriginal: string
  estado: "auto_match" | "requiere_revision"
  insumoIdAsignado: string | null
  candidatosSugeridos: CandidatoInsumo[]
  precioPlaceholder: boolean
}

// ---- Mano de obra: categorías por ACTIVIDAD, no insumos de catálogo ----
// Decisión de negocio (ver conversación de diseño): la mano de obra se
// subcontrata por tipo de actividad, no se compra como un insumo -- por
// eso el matching es distinto en 3 formas:
//   1. Se busca contra `mano_obra_categorias`, no `maestro_insumos`.
//   2. La CONSULTA es el nombre del ÍTEM del presupuesto ("Demolición de
//      estructuras..."), NO el texto de la línea del Excel ("Cuadrilla
//      AA-4") -- una cuadrilla no dice nada sobre qué actividad es.
//   3. NUNCA hay auto_match -- "parecido" no basta para asignar solo,
//      siempre lo confirma el ingeniero.
// Por eso es UNA resolución POR BLOQUE (por ítem), no por descripción
// única de línea como ResolucionInsumo.

export type CategoriaManoObra = {
  id: string
  grupo: string | null
  categoria: string
  unidad: string
  valorUnitario: number | null // null = todavía sin precio definido en el catálogo
  similitud: number
}

export type ResolucionManoObra = {
  codigoItem: string
  candidatosSugeridos: CategoriaManoObra[]
}

// ---- Guardado inmediato + revisión en pestaña aparte ----
// Combina cada línea de un bloque con SU resolución (matchearInsumosApuImport
// devuelve una resolución POR DESCRIPCIÓN ÚNICA -- esto la reparte de vuelta
// a cada línea, para poder guardar todo de una vez).

export type LineaImportConResolucion = LineaApuExcelInput & {
  estado: "auto_match" | "requiere_revision"
  insumoIdAsignado: string | null
  candidatosSugeridos: CandidatoInsumo[]
}

export type BloqueConResolucion = {
  codigoItem: string
  nombreItem: string
  // Incluye TODAS las líneas del Excel, también las de tipo "MO" -- no
  // se pierden del bloque. Para esas líneas, insumoIdAsignado/
  // candidatosSugeridos quedan vacíos (matchearInsumosApuImport las
  // salta a propósito) -- su resolución real vive en
  // `resolucionManoObra` de abajo, no acá.
  lineas: LineaImportConResolucion[]
  // null si el bloque no tenía ninguna línea con tipo "MO".
  resolucionManoObra: ResolucionManoObra | null
}

// Una fila de apu_import_revision, tal como la lee la pestaña de
// revisión (candidatos ya vienen calculados, no se re-busca nada ahí).
export type FilaRevisionImport = {
  id: string
  loteImportId: string
  presupuestoItemId: string
  apuId: string
  descripcionOriginal: string
  tipo: string | null
  unidad: string | null
  cantidad: number
  // Para líneas normales (tipo !== "MO"): CandidatoInsumo[]. Para líneas
  // de mano de obra (tipo === "MO"): CategoriaManoObra[]. `tipo` es el
  // discriminador -- revísalo antes de usar `candidatos` para saber cuál
  // de las dos formas trae.
  candidatos: CandidatoInsumo[] | CategoriaManoObra[]
  estado: "auto_match" | "pendiente" | "solicitud_pendiente" | "resuelto" | "rechazado"
  insumoIdAsignado: string | null
  manoObraCategoriaIdAsignado: string | null
  itemApuId: string | null
  // motivo que escribió el admin al rechazar (viene de
  // solicitudes_insumos.motivo_rechazo via solicitud_id) -- null si esta
  // línea no está rechazada, o si el admin no escribió nada.
  motivoRechazo: string | null
}

/**
 * matchearInsumosApuImport dedup por descripción y devuelve UNA
 * resolución por descripción única -- para guardar hace falta la
 * resolución repartida de vuelta a CADA línea de cada bloque. Vive acá
 * (no en actions.ts) porque page.tsx la necesita del lado del cliente,
 * antes de guardar nada.
 *
 * `resolucionesManoObra` es opcional -- se reparte por CÓDIGO DE ÍTEM
 * (no por descripción de línea, ver nota en ResolucionManoObra arriba).
 */
export function combinarBloquesConResoluciones(
  bloques: BloqueApuInput[],
  resoluciones: ResolucionInsumo[],
  resolucionesManoObra: ResolucionManoObra[] = []
): BloqueConResolucion[] {
  const porDescripcion = new Map(
    resoluciones.map((r) => [r.descripcionOriginal.trim().toLowerCase(), r])
  )
  const manoObraPorCodigoItem = new Map(resolucionesManoObra.map((r) => [r.codigoItem, r]))

  return bloques.map((bloque) => ({
    codigoItem: bloque.codigoItem,
    nombreItem: bloque.nombreItem,
    lineas: bloque.lineas.map((linea) => {
      const resolucion = porDescripcion.get(linea.descripcion.trim().toLowerCase())
      return {
        ...linea,
        estado: resolucion?.estado ?? "requiere_revision",
        insumoIdAsignado: resolucion?.insumoIdAsignado ?? null,
        candidatosSugeridos: resolucion?.candidatosSugeridos ?? [],
      }
    }),
    resolucionManoObra: manoObraPorCodigoItem.get(bloque.codigoItem) ?? null,
  }))
}