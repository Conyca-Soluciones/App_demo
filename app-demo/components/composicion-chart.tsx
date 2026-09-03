"use client"

import { useMemo } from "react"
import type { ItemPresupuesto } from "@/app/(app)/presupuestos/actions"

// ---------------------------------------------------------------------------
// Gráfica de composición del presupuesto por capítulo (ej. "20% es
// demolición") -- se calcula 100% en el cliente a partir de `data` (el
// mismo estado que ya usa PresupuestoTable/PresupuestoTree), sin ninguna
// llamada nueva al servidor. Sin librería de gráficas nueva -- barras
// horizontales con divs, para no depender de si el proyecto ya tiene
// recharts/d3 instalado o no.
//
// "vs ejecución" queda pendiente: necesita una fuente de gasto real
// (compras, ejecución de obra) que hoy no existe en el schema -- ver nota
// en CLAUDE.md. Por ahora esto solo muestra la composición de la versión
// que se le pase (normalmente la actual).
// ---------------------------------------------------------------------------

type Segmento = {
  id: string
  nombre: string
  valor: number
  porcentaje: number
}

const COLORES = [
  "bg-teal-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-emerald-500",
  "bg-indigo-500",
  "bg-orange-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-lime-500",
  "bg-pink-500",
]

function formatoCOP(valor: number) {
  return valor.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  })
}

// Capítulo = ítem de nivel 2 (hijo directo de la raíz nivel 1). Cada
// ítem con valorTotal sube por padreId hasta encontrar su capítulo
// ancestro, y suma ahí -- así un ítem de nivel 3, 4, etc. igual cuenta
// para el capítulo correcto sin importar qué tan hondo esté anidado.
function calcularComposicionPorCapitulo(items: ItemPresupuesto[]): Segmento[] {
  const porId = new Map(items.map((i) => [i.id, i]))
  const capitulos = items.filter((i) => i.nivel === 2)
  const valorPorCapitulo = new Map<string, number>()
  capitulos.forEach((c) => valorPorCapitulo.set(c.id, 0))

  for (const item of items) {
    if (item.valorTotal == null) continue

    let actual: ItemPresupuesto | undefined = item
    while (actual && actual.nivel > 2) {
      actual = actual.padreId ? porId.get(actual.padreId) : undefined
    }

    if (actual && actual.nivel === 2 && valorPorCapitulo.has(actual.id)) {
      valorPorCapitulo.set(actual.id, (valorPorCapitulo.get(actual.id) ?? 0) + item.valorTotal)
    }
  }

  const total = Array.from(valorPorCapitulo.values()).reduce((a, b) => a + b, 0)

  return capitulos
    .map((c) => ({ id: c.id, nombre: c.descripcion, valor: valorPorCapitulo.get(c.id) ?? 0 }))
    .filter((s) => s.valor > 0)
    .map((s) => ({ ...s, porcentaje: total > 0 ? (s.valor / total) * 100 : 0 }))
    .sort((a, b) => b.valor - a.valor)
}

export function ComposicionChart({ data }: { data: ItemPresupuesto[] }) {
  const segmentos = useMemo(() => calcularComposicionPorCapitulo(data), [data])

  if (segmentos.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        Todavía no hay costos calculados en ningún capítulo -- arma al menos
        un APU con cantidad para ver la composición.
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Composición del presupuesto por capítulo</p>
      <div className="space-y-2.5">
        {segmentos.map((s, i) => (
          <div key={s.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate font-medium">{s.nombre}</span>
              <span className="shrink-0 text-muted-foreground">
                {s.porcentaje.toFixed(1)}% · {formatoCOP(s.valor)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${COLORES[i % COLORES.length]}`}
                style={{ width: `${s.porcentaje}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}