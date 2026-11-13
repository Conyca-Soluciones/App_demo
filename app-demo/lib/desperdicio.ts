// Desperdicio del presupuesto (20270101003000, 3500 y 3700). Es de la CANTIDAD:
// un % general de la versión que la base aplica sola a todas las líneas de
// insumo del APU, también a las que se aprueben después. Excepciones por línea
// del Excel (su texto): desmarcar = sin desperdicio, u otro %.
// Lógica pura del diálogo "Desperdicio".

// Una línea de insumo del Excel (agrupada por su texto) en la versión.
export type LineaDesperdicio = {
  clave: string // texto normalizado: con esto se guarda la excepción
  descripcion: string
  unidad: string | null
  nItems: number
  lineas: number
  lineasPendientes: number // esperan aprobación del insumo
  cantidadBase: number // sin desperdicio, por la cantidad de cada ítem
  valorBase: number // solo de las líneas ya aprobadas (las pendientes no tienen precio)
  diceDesperdicio: boolean // el texto ya dice "desperdicio"
  excepcion: number | null // null = el % general; 0 = sin desperdicio
}

export type DatosDesperdicio = { general: number; configurado: boolean; lineas: LineaDesperdicio[] }

// marcado = lleva desperdicio; porcentaje null = el general
export type FilaDesperdicio = { clave: string; marcado: boolean; porcentaje: number | null }

export function mapearDatosDesperdicio(raw: unknown): DatosDesperdicio {
  const r = (raw ?? {}) as { general?: unknown; configurado?: unknown; insumos?: unknown[] }
  return {
    general: Number(r.general ?? 0),
    configurado: Boolean(r.configurado),
    lineas: (r.insumos ?? []).map((x) => {
      const i = x as Record<string, unknown>
      return {
        clave: String(i.clave),
        descripcion: String(i.descripcion ?? ""),
        unidad: (i.unidad as string | null) ?? null,
        nItems: Number(i.n_items ?? 0),
        lineas: Number(i.lineas ?? 0),
        lineasPendientes: Number(i.lineas_pendientes ?? 0),
        cantidadBase: Number(i.cantidad_base ?? 0),
        valorBase: Number(i.valor_base ?? 0),
        diceDesperdicio: Boolean(i.dice_desperdicio),
        excepcion: i.excepcion == null ? null : Number(i.excepcion),
      }
    }),
  }
}

// La primera vez (versión sin desperdicio) se proponen desmarcadas las líneas
// cuyo texto ya dice "desperdicio"; después, lo guardado.
export function filasIniciales(datos: DatosDesperdicio): FilaDesperdicio[] {
  return datos.lineas.map((l) =>
    datos.configurado
      ? { clave: l.clave, marcado: l.excepcion !== 0, porcentaje: l.excepcion != null && l.excepcion > 0 ? l.excepcion : null }
      : { clave: l.clave, marcado: !l.diceDesperdicio, porcentaje: null }
  )
}

export function porcentajeDeFila(f: FilaDesperdicio, general: number): number {
  if (!f.marcado) return 0
  return f.porcentaje ?? general
}

// Cuánto suma el desperdicio en pesos sobre las líneas ya aprobadas (las
// pendientes lo toman cuando se aprueben).
export function impactoDesperdicio(
  lineas: LineaDesperdicio[],
  filas: FilaDesperdicio[],
  general: number
): { aumento: number; marcadas: number } {
  const porClave = new Map(filas.map((f) => [f.clave, f]))
  let aumento = 0
  let marcadas = 0
  for (const l of lineas) {
    const f = porClave.get(l.clave)
    if (!f) continue
    const pct = porcentajeDeFila(f, general)
    if (pct > 0) {
      marcadas++
      aumento += (l.valorBase * pct) / 100
    }
  }
  return { aumento: Math.round(aumento), marcadas }
}

// Excepciones para fijar_desperdicio_presupuesto: las desmarcadas (0) y las de
// un % distinto del general. Las demás siguen el general.
export function excepcionesParaGuardar(filas: FilaDesperdicio[], general: number): { clave: string; porcentaje: number }[] {
  const out: { clave: string; porcentaje: number }[] = []
  for (const f of filas) {
    if (!f.marcado) out.push({ clave: f.clave, porcentaje: 0 })
    else if (f.porcentaje != null && f.porcentaje !== general) {
      out.push({ clave: f.clave, porcentaje: Math.round(f.porcentaje * 100) / 100 })
    }
  }
  return out
}

export function porcentajeValido(n: number | null): boolean {
  return n != null && Number.isFinite(n) && n >= 0 && n <= 100
}
