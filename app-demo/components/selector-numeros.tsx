"use client"

import { ChevronDown } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Elegir varios números de una lista (años, semanas). Sin elegir ninguno =
// "Todas": marcar uno por uno todos los números también cuenta como "Todas"
// (la selección vuelve vacía), así quien consulta no manda un IN innecesario.
// ---------------------------------------------------------------------------

// [40, 41, 42, 45] -> "40–42, 45"
export function resumirNumeros(numeros: number[]): string {
  const orden = [...numeros].sort((a, b) => a - b)
  const tramos: string[] = []
  for (let i = 0; i < orden.length; i++) {
    let j = i
    while (j + 1 < orden.length && orden[j + 1] === orden[j] + 1) j++
    tramos.push(j > i + 1 ? `${orden[i]}–${orden[j]}` : j === i + 1 ? `${orden[i]}, ${orden[j]}` : `${orden[i]}`)
    i = j
  }
  return tramos.join(", ")
}

type Props = {
  id?: string
  opciones: number[]
  seleccion: number[] // vacía = todas
  onChange: (seleccion: number[]) => void
  textoTodas: string // "Todas las semanas"
  plural: string // "semanas", para "12 semanas"
  columnas?: number
  // Ayuda de cada número (las fechas de la semana).
  ayuda?: (n: number) => string | undefined
  disabled?: boolean
}

export function SelectorNumeros({ id, opciones, seleccion, onChange, textoTodas, plural, columnas = 7, ayuda, disabled }: Props) {
  const elegidos = new Set(seleccion)
  const resumen = seleccion.length === 0 ? textoTodas : resumirNumeros(seleccion)
  const texto = resumen.length > 22 ? `${seleccion.length} ${plural}` : resumen

  function alternar(n: number) {
    const nuevo = new Set(elegidos)
    if (nuevo.has(n)) nuevo.delete(n)
    else nuevo.add(n)
    onChange(nuevo.size === opciones.length ? [] : [...nuevo].sort((a, b) => a - b))
  }

  return (
    <Popover>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        className="flex h-9 w-full min-w-0 items-center justify-between gap-1 rounded-4xl border border-input bg-input/30 px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate tabular-nums">{texto}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-1rem)] gap-3 rounded-md p-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={seleccion.length === 0} onCheckedChange={() => onChange([])} />
          {textoTodas}
        </label>
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}>
          {opciones.map((n) => {
            const activo = elegidos.has(n)
            return (
              <button
                key={n}
                type="button"
                title={ayuda?.(n)}
                aria-pressed={activo}
                onClick={() => alternar(n)}
                className={cn(
                  "h-8 min-w-9 rounded-md border px-1.5 text-xs tabular-nums transition-colors",
                  activo ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                )}
              >
                {n}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
