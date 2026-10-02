"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

// Control de página de las listas: Anterior / Página N / Siguiente. No muestra
// el total de páginas (no se cuenta, para no recorrer todo el historial).
export function PaginacionSimple({
  pagina,
  hayMas,
  cargando = false,
  onCambiar,
}: {
  pagina: number // 0 = primera
  hayMas: boolean
  cargando?: boolean
  onCambiar: (nueva: number) => void
}) {
  if (pagina === 0 && !hayMas) return null
  return (
    <div className="flex items-center justify-end gap-3 text-sm">
      <Button
        variant="outline"
        size="sm"
        disabled={pagina === 0 || cargando}
        onClick={() => onCambiar(pagina - 1)}
      >
        <ChevronLeft className="mr-1 h-4 w-4" /> Anterior
      </Button>
      <span className="text-muted-foreground">Página {pagina + 1}</span>
      <Button variant="outline" size="sm" disabled={!hayMas || cargando} onClick={() => onCambiar(pagina + 1)}>
        Siguiente <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  )
}
