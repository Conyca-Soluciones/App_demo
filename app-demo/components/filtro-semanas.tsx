"use client"

import { useMemo } from "react"
import { Label } from "@/components/ui/label"
import { SelectorNumeros } from "@/components/selector-numeros"
import { fechasSemanaIso, semanasDelAnio } from "@/lib/pagos"

// Años y semanas ISO de los filtros de los consolidados, con su título:
// "Semana de aprobación (ITEM)" (pagos.anio / semana) o "Semana de creación"
// (pagos.creado_en). Vacíos = todos; las semanas valen en cada año elegido.
export function FiltroSemanas({
  id,
  titulo,
  opcionesAnios,
  anios,
  semanas,
  onAnios,
  onSemanas,
}: {
  id: string
  titulo: string
  opcionesAnios: number[]
  anios: number[]
  semanas: number[]
  onAnios: (a: number[]) => void
  onSemanas: (s: number[]) => void
}) {
  const total = anios.length === 1 ? semanasDelAnio(anios[0]) : 53
  const opcionesSemanas = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total])
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`anio-${id}`}>Años</Label>
          <SelectorNumeros id={`anio-${id}`} opciones={opcionesAnios} seleccion={anios} onChange={onAnios} textoTodas="Todos" plural="años" columnas={3} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`semana-${id}`}>Semanas</Label>
          <SelectorNumeros
            id={`semana-${id}`}
            opciones={opcionesSemanas}
            seleccion={semanas}
            onChange={onSemanas}
            textoTodas="Todas"
            plural="semanas"
            ayuda={anios.length === 1 ? (n) => fechasSemanaIso(anios[0], n) : undefined}
          />
        </div>
      </div>
    </div>
  )
}
