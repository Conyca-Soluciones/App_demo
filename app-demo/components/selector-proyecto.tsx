"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LayoutGrid, Loader2 } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useProyectoActual } from "@/components/proyecto-provider"
import { seleccionarProyecto } from "@/app/(app)/inicio/actions"
import { etiquetaProyecto } from "@/lib/proyecto-actual"

// Selector del proyecto actual en el encabezado de las páginas que trabajan
// sobre un proyecto. Es un atajo: el proyecto se elige en /inicio (landing)
// y también se cambia desde el sidebar. Mismo mecanismo que la landing:
// seleccionarProyecto() fija la cookie (validando acceso en el servidor) y
// router.refresh() vuelve a correr el layout, que recalcula el proyecto.
export function SelectorProyecto({ className }: { className?: string }) {
  const { proyecto, proyectos } = useProyectoActual()
  const router = useRouter()
  const [cambiando, iniciarCambio] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function alCambiar(id: string | null) {
    if (!id || id === proyecto?.id) return
    setError(null)
    iniciarCambio(async () => {
      try {
        await seleccionarProyecto(id)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cambiar de proyecto.")
      }
    })
  }

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <span className="text-xs text-muted-foreground">Proyecto</span>
      <Select value={proyecto?.id ?? ""} onValueChange={alCambiar} disabled={cambiando}>
        <SelectTrigger
          className="h-9 w-[min(18rem,calc(100vw-7rem))] rounded-sm"
          title={error ?? undefined}
          aria-invalid={error ? true : undefined}
        >
          <SelectValue placeholder="Selecciona un proyecto">
            <span className="flex min-w-0 items-center gap-1.5">
              {cambiando && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
              <span className="truncate">{proyecto ? etiquetaProyecto(proyecto) : "Selecciona un proyecto"}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {proyectos.map((p) => (
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
              href="/inicio"
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
