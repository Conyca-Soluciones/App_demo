"use client"

import { useState } from "react"
import { ChevronLeft, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FiltrosPlegados } from "@/components/filtros-plegados"

// Cascarón común de los paneles de filtros a la izquierda (mismo aspecto que
// el de Registro y Aprobación de requisiciones): encabezado azul con botón para
// ocultarlo, campos propios de cada pantalla (children), Consultar y Limpiar.
// Al consultar se minimiza para dejar el ancho a los resultados.

type Props = {
  children: React.ReactNode
  // Si devuelve false (p. ej. un filtro inválido) el panel no se minimiza.
  onConsultar: () => void | boolean
  onLimpiar: () => void
  cargando?: boolean
  // Texto de ayuda al pie (opcional).
  ayuda?: string
  // En el celular el panel abierto va ARRIBA de los resultados (la página pone
  // flex-col md:flex-row). Plegado es igual en todas: FiltrosPlegados.
  apilarEnCelular?: boolean
}

export function PanelFiltros({ children, onConsultar, onLimpiar, cargando = false, ayuda, apilarEnCelular = false }: Props) {
  const [abierto, setAbierto] = useState(true)

  if (!abierto) return <FiltrosPlegados onAbrir={() => setAbierto(true)} />

  return (
    <div className={`h-fit w-full shrink-0 rounded-lg border bg-card ${apilarEnCelular ? "md:max-w-xs" : "max-w-xs"}`}>
      <div className="flex items-center justify-between rounded-t-lg bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          <span className="font-medium">Filtros</span>
        </div>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="rounded p-1 hover:bg-primary-foreground/10"
          title="Ocultar filtros"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {children}

        <div className="space-y-2">
          <Button
            className="w-full"
            disabled={cargando}
            onClick={() => {
              if (onConsultar() !== false) setAbierto(false)
            }}
          >
            {cargando ? "Consultando..." : "Consultar"}
          </Button>
          <Button className="w-full" variant="ghost" onClick={onLimpiar}>
            Limpiar filtros
          </Button>
          {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
        </div>
      </div>
    </div>
  )
}
