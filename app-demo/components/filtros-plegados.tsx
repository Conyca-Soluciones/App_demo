"use client"

import { Filter } from "lucide-react"
import { Button } from "@/components/ui/button"

// Filtros plegados (decisión del usuario, 2026-11-24): un botón "Filtros" arriba a la
// izquierda, ENCIMA de la tabla, para no quitarle ancho. El contenedor de la página lleva
// la clase `con-filtros` (globals.css): con el panel plegado se pone en columna, así que
// este botón queda en su propia fila y la tabla usa todo el ancho. Con el panel abierto
// el panel sigue a la izquierda como siempre.
export function FiltrosPlegados({ onAbrir, detalle }: { onAbrir: () => void; detalle?: string | null }) {
  return (
    <div data-filtros="plegado" className="flex shrink-0 justify-start">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAbrir}
        title={detalle ? `Mostrar filtros — ${detalle}` : "Mostrar filtros"}
        className="max-w-full gap-1.5"
      >
        <Filter className="h-4 w-4 shrink-0" />
        Filtros
        {detalle && <span className="min-w-0 truncate font-normal text-muted-foreground">· {detalle}</span>}
      </Button>
    </div>
  )
}
