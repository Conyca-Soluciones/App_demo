// app/(app)/almacen/types.ts -- sin cambios de forma, solo el
// comentario de cantidadDisponible ahora es preciso (antes decía
// "restando lo aprobado", ahora también resta lo pendiente).

export type InsumoAgrupado = {
  insumoId: string
  insumoCodigo: number
  insumoDescripcion: string
  insumoUm: string | null
  items: {
    presupuestoItemId: string
    itemCodigo: string
    itemDescripcion: string
    itemApuId: string | null
    // Cuánto de este insumo queda disponible para pedir en ESTE ítem:
    // (cantidad_apu × cantidad del ítem) − lo ya PENDIENTE o APROBADO
    // (antes: solo aprobado -- ver CLAUDE.md "Riesgos conocidos" para
    // el porqué del cambio). Nunca negativo.
    cantidadDisponible: number
  }[]
}

export type ItemSeleccionable = {
  presupuestoItemId: string
  itemCodigo: string
  itemDescripcion: string
  itemApuId: string | null
  cantidadDisponible: number
  marcado: boolean
  cantidad: string
}

export type PresupuestoActivo = {
  presupuestoId: string
  versionActualId: string
}