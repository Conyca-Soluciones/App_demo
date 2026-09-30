"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGrid } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useProyectoActual } from "@/components/proyecto-actual-provider"
import { etiquetaProyecto, type ProyectoActual } from "@/lib/proyecto-actual"

// Selector del proyecto actual para el header de las páginas que trabajan
// sobre un proyecto (Presupuestos, Pedidos). Cambiarlo acá lo cambia para
// toda la app (cookie + contexto), no solo para la página abierta.
export function SelectorProyecto({ className }: { className?: string }) {
  const { proyecto, proyectos, cambiarProyecto } = useProyectoActual()
  const pathname = usePathname()

  // Mientras llega la lista, al menos el proyecto actual aparece como opción
  // (si no, el Select mostraría el valor crudo).
  const opciones: ProyectoActual[] = proyectos ?? (proyecto ? [proyecto] : [])

  function alCambiar(id: string | null) {
    const elegido = opciones.find((p) => p.id === id)
    if (elegido && elegido.id !== proyecto?.id) cambiarProyecto(elegido)
  }

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <span className="text-xs text-muted-foreground">Proyecto</span>
      <Select value={proyecto?.id ?? ""} onValueChange={alCambiar}>
        <SelectTrigger className="h-9 w-72 rounded-sm">
          <SelectValue placeholder="Selecciona un proyecto">
            <span className="truncate">{proyecto ? etiquetaProyecto(proyecto) : "Selecciona un proyecto"}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {opciones.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {etiquetaProyecto(p)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href={`/inicio?next=${encodeURIComponent(pathname)}`}
              aria-label="Ver todos los proyectos"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            />
          }
        >
          <LayoutGrid className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Ver todos los proyectos</TooltipContent>
      </Tooltip>
    </div>
  )
}

// Aviso para cuando se entra a una página de proyecto sin haber escogido uno
// (ej. link directo, o la cookie venció).
export function AvisoSinProyecto() {
  const pathname = usePathname()
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">Todavía no has escogido un proyecto</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Escoge uno arriba, o desde la página de proyectos.
      </p>
      <Link
        href={`/inicio?next=${encodeURIComponent(pathname)}`}
        className="mt-4 inline-flex h-9 items-center rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Escoger proyecto
      </Link>
    </div>
  )
}
