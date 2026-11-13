// Desperdicio del presupuesto (20270101003000 y 20270101003500). Un % general
// de la versión que la base aplica sola a todas las líneas de insumo, también a
// las que entren después; las líneas cuyo Excel ya dice "desperdicio" quedan en
// 0; y excepciones por insumo (0 = sin desperdicio, u otro %).
// Lógica pura del diálogo "Desperdicio".

export type InsumoDesperdicio = {
  insumoId: string
  codigo: number | null
  descripcion: string
  unidad: string | null
  tipo: string | null
  nItems: number
  cantidadBase: number
  valorBase: number
  // valor de las líneas que toman el % (sin las que ya traen desperdicio)
  valorAplicable: number
  // líneas de este insumo cuyo Excel ya dice "desperdicio" (quedan en 0)
  lineasTrae: number
  // excepción guardada (null = sigue el % general; 0 = sin desperdicio)
  excepcion: number | null
}

export type DatosDesperdicio = { general: number; valorPresupuesto: number; insumos: InsumoDesperdicio[] }

// marcado = lleva desperdicio; porcentaje null = el general
export type FilaDesperdicio = { insumoId: string; marcado: boolean; porcentaje: number | null }

export function mapearDatosDesperdicio(raw: unknown): DatosDesperdicio {
  const r = (raw ?? {}) as { general?: unknown; valor_presupuesto?: unknown; insumos?: unknown[] }
  return {
    general: Number(r.general ?? 0),
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
        valorAplicable: Number(i.valor_aplicable ?? 0),
        lineasTrae: Number(i.lineas_trae ?? 0),
        excepcion: i.excepcion == null ? null : Number(i.excepcion),
      }
    }),
  }
}

export function filasIniciales(insumos: InsumoDesperdicio[]): FilaDesperdicio[] {
  return insumos.map((i) => ({
    insumoId: i.insumoId,
    marcado: i.excepcion !== 0,
    porcentaje: i.excepcion != null && i.excepcion > 0 ? i.excepcion : null,
  }))
}

export function porcentajeDeFila(f: FilaDesperdicio, general: number): number {
  if (!f.marcado) return 0
  return f.porcentaje ?? general
}

// Cuánto suma el desperdicio en pesos sobre lo que ya está en los APU.
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
    if (pct > 0 && i.valorAplicable > 0) {
      marcados++
      aumento += (i.valorAplicable * pct) / 100
    }
  }
  return { aumento: Math.round(aumento), marcados }
}

// Excepciones para fijar_desperdicio_presupuesto: los desmarcados (0) y los que
// tienen un % distinto del general. Los demás siguen el general (también lo que
// se apruebe después).
export function excepcionesParaGuardar(filas: FilaDesperdicio[], general: number): { insumo_id: string; porcentaje: number }[] {
  const out: { insumo_id: string; porcentaje: number }[] = []
  for (const f of filas) {
    if (!f.marcado) out.push({ insumo_id: f.insumoId, porcentaje: 0 })
    else if (f.porcentaje != null && f.porcentaje !== general) {
      out.push({ insumo_id: f.insumoId, porcentaje: Math.round(f.porcentaje * 100) / 100 })
    }
  }
  return out
}

export function porcentajeValido(n: number | null): boolean {
  return n != null && Number.isFinite(n) && n >= 0 && n <= 100
}
