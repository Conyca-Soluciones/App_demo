"use client"
// app/(app)/almacen/page.tsx
import { useEffect, useState } from "react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { SelectorProyecto } from "@/components/selector-proyecto"
import { SolicitudInsumoDialog } from "@/components/dialogue-nuevo-pedido"
import { Button } from "@/components/ui/button"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"

import { buscarPresupuestoActivo } from "./actions"
import type { PresupuestoActivo } from "./types"

export default function Almacen() {
  // El proyecto se elige en /inicio (landing); acá solo se lee.
  const { proyecto: proyectoActual } = useProyectoActual()
  const proyectoId = proyectoActual?.id ?? null
  const [error, setError] = useState<string | null>(null)
  const [dialogoPedido, setDialogoPedido] = useState(false)

  const [presupuestoActivo, setPresupuestoActivo] = useState<PresupuestoActivo | null>(null)
  const [cargandoPresupuesto, setCargandoPresupuesto] = useState(false)

  useEffect(() => {
    setPresupuestoActivo(null)
    setError(null)

    if (!proyectoId) return

    setCargandoPresupuesto(true)
    buscarPresupuestoActivo(proyectoId)
      .then(setPresupuestoActivo)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el presupuesto del proyecto."))
      .finally(() => setCargandoPresupuesto(false))
  }, [proyectoId])

  const proyectoSeleccionado = proyectoActual

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Elaboración de requisiciones</h1>
          <p className="text-sm text-muted-foreground">
            Haz requisiciones de insumos de almacén para el proyecto en el que estás trabajando.
          </p>
        </div>
        <SelectorProyecto className="ml-auto" />
      </header>

      {!proyectoActual && <SinProyecto />}

      {proyectoActual && (
      <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-10 gap-1.5 rounded-sm px-3 text-xs"
              onClick={() => setDialogoPedido(true)}
              disabled={!presupuestoActivo || cargandoPresupuesto}
            >
              + Crear requisición
            </Button>
          </div>

          {proyectoId && cargandoPresupuesto && (
            <p className="text-xs text-muted-foreground">Cargando presupuesto del proyecto…</p>
          )}
          {proyectoId && !cargandoPresupuesto && !presupuestoActivo && (
            <p className="text-xs text-amber-700">
              {proyectoSeleccionado?.nombre ?? "Este proyecto"} todavía no tiene un presupuesto
              cargado — sube uno desde el módulo de Presupuestos antes de crear requisiciones.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {presupuestoActivo && (
          <SolicitudInsumoDialog
            open={dialogoPedido}
            onOpenChange={setDialogoPedido}
            versionId={presupuestoActivo.versionActualId}
          />
        )}
      </main>
      )}
    </>
  )
}