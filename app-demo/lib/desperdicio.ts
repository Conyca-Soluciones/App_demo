// Desperdicio del presupuesto (20270101003000_desperdicio_presupuesto.sql).
// Lógica pura del diálogo "Desperdicio": qué insumos van marcados y cuánto
// sube el presupuesto. La base infla item_apu.cantidad con el %.

export type InsumoDesperdicio = {
  insumoId: string
  codigo: number | null
  descripcion: string
  unidad: string | null
  tipo: string | null
  nItems: number
  cantidadBase: number
  valorBase: number
  // % guardado en la versión (null = sin desperdicio)
  porcentaje: number | null
  // el APU (texto del Excel) o el nombre dicen "desperdicio": ya lo incluye
  diceDesperdicio: boolean
}

export type DatosDesperdicio = { valorPresupuesto: number; insumos: InsumoDesperdicio[] }

export type FilaDesperdicio = { insumoId: string; marcado: boolean; porcentaje: number | null }

export function mapearDatosDesperdicio(raw: unknown): DatosDesperdicio {
  const r = (raw ?? {}) as { valor_presupuesto?: unknown; insumos?: unknown[] }
  return {
    valorPresupuesto: Number(r.valor_presupuesto ?? 0),
    insumos: (r.insumos ?? []).map((x) => {
      const i = x as Record<string, unknown>
      return {
        insumoId: String(i.insumo_id),
        codigo: i.codigo == null ? null : Number(i.codigo),
        descripcion: String(i.descripcion ?? ""),
        unidad: (i.unidad as string | null) ?? null,
        tipo: (i.tipo as string | null) ?? null,
        nItems: Number(i.n_items ?? 0),
        cantidadBase: Number(i.cantidad_base ?? 0),
        valorBase: Number(i.valor_base ?? 0),
        porcentaje: i.porcentaje == null ? null : Number(i.porcentaje),
        diceDesperdicio: Boolean(i.dice_desperdicio),
      }
    }),
  }
}

// Estado inicial: si la versión ya tiene desperdicio, lo guardado; si no, todos
// marcados con el % general menos los que ya dicen "desperdicio".
export function filasIniciales(insumos: InsumoDesperdicio[]): FilaDesperdicio[] {
  const hayGuardado = insumos.some((i) => i.porcentaje != null)
  return insumos.map((i) =>
    hayGuardado
      ? { insumoId: i.insumoId, marcado: i.porcentaje != null, porcentaje: i.porcentaje }
      : { insumoId: i.insumoId, marcado: !i.diceDesperdicio, porcentaje: null }
  )
}

// % de una fila: el propio, o el general si no tiene uno.
export function porcentajeDeFila(f: FilaDesperdicio, general: number): number {
  if (!f.marcado) return 0
  return f.porcentaje ?? general
}

// Cuánto suma el desperdicio en pesos (valor sin desperdicio × %).
export function impactoDesperdicio(
  insumos: InsumoDesperdicio[],
  filas: FilaDesperdicio[],
  general: number
): { aumento: number; marcados: number } {
  const porId = new Map(filas.map((f) => [f.insumoId, f]))
  let aumento = 0
  let marcados = 0
  for (const i of insumos) {
    const f = porId.get(i.insumoId)
    if (!f) continue
    const pct = porcentajeDeFila(f, general)
    if (pct > 0) {
      marcados++
      aumento += (i.valorBase * pct) / 100
    }
  }
  return { aumento: Math.round(aumento), marcados }
}

// Lo que se manda a fijar_desperdicio_presupuesto: solo los que tienen % > 0.
export function itemsParaGuardar(filas: FilaDesperdicio[], general: number): { insumo_id: string; porcentaje: number }[] {
  const out: { insumo_id: string; porcentaje: number }[] = []
  for (const f of filas) {
    const pct = porcentajeDeFila(f, general)
    if (pct > 0) out.push({ insumo_id: f.insumoId, porcentaje: Math.round(pct * 100) / 100 })
  }
  return out
}

export function porcentajeValido(n: number | null): boolean {
  return n != null && Number.isFinite(n) && n >= 0 && n <= 100
}
