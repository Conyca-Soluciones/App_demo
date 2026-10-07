"use client"

import { useState } from "react"
import { SalidasView } from "@/components/salidas-view"
import { SalidasRegistradasView } from "@/components/salidas-registradas-view"
import { useProyectoActual } from "@/components/proyecto-provider"

type Pestana = "nueva" | "registradas"

const PESTANAS: { valor: Pestana; etiqueta: string }[] = [
  { valor: "nueva", etiqueta: "Nueva salida" },
  { valor: "registradas", etiqueta: "Salidas registradas" },
]

// Salidas: registrar una nueva, o consultar las ya registradas para
// corregirlas o anularlas.
export function SalidasPagina() {
  const [pestana, setPestana] = useState<Pestana>("nueva")
  // Al cambiar de proyecto, la lista de registradas vuelve a empezar.
  const proyectoId = useProyectoActual().proyecto?.id ?? "sin-proyecto"

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex gap-1.5 border-b">
        {PESTANAS.map((p) => (
          <button
            key={p.valor}
            type="button"
            onClick={() => setPestana(p.valor)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              pestana === p.valor
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {pestana === "nueva" ? <SalidasView /> : <SalidasRegistradasView key={proyectoId} />}
      </div>
    </div>
  )
}
