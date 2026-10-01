"use client"
// app/(app)/almacen/page.tsx
import Link from "next/link"
import { useEffect, useState } from "react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { SelectorProyecto } from "@/components/selector-proyecto"
import { FormularioRequisicion } from "@/components/dialogue-nuevo-pedido"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"

import { buscarPresupuestoActivo } from "./actions"
import type { PresupuestoActivo } from "./types"

export default function Almacen() {
  // El proyecto se elige en /inicio (landing); acá solo se lee.
  const { proyecto: proyectoActual } = useProyectoActual()
  const proyectoId = proyectoActual?.id ?? null
  const [error, setError] = useState<string | null>(null)
  // Aviso tras crear: "Requisición N creada" con enlace a su detalle.
  const [creada, setCreada] = useState<{ requisicionId: string; numero: number } | null>(null)

  const [presupuestoActivo, setPresupuestoActivo] = useState<PresupuestoActivo | null>(null)
  const [cargandoPresupuesto, setCargandoPresupuesto] = useState(false)

  useEffect(() => {
    setPresupuestoActivo(null)
    setCreada(null)
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
          {proyectoId && cargandoPresupuesto && (
            <p className="text-xs text-muted-foreground">Cargando presupuesto del proyecto…</p>
          )}
          {proyectoId && !cargandoPresupuesto && !presupuestoActivo && (
            <p className="text-xs text-amber-700">
              {proyectoSeleccionado?.nombre ?? "Este proyecto"} todavía no tiene un presupuesto
              cargado — sube uno desde el módulo de Presupuestos antes de crear requisiciones.
            </p>
          )}
          {creada && (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Requisición {creada.numero} creada.{" "}
              <Link
                href={`/almacen/registro-requisiciones/${creada.requisicionId}`}
                className="font-medium underline underline-offset-2"
              >
                Ver detalle
              </Link>
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* El formulario va directo en la página (sin botón para abrirlo). */}
        {presupuestoActivo && (
          <section className="rounded-lg border bg-card">
            <h2 className="border-b px-6 py-4 text-xl font-semibold">Nueva requisición</h2>
            <FormularioRequisicion
              versionId={presupuestoActivo.versionActualId}
              onPedidoCreado={(c) => setCreada(c ?? null)}
            />
          </section>
        )}
      </main>
      )}
    </>
  )
}