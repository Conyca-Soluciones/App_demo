"use client"
// app/(app)/almacen/page.tsx
import Link from "next/link"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { useEffect, useState } from "react"

import { FormularioRequisicion } from "@/components/dialogue-nuevo-pedido"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"

import { buscarPresupuestoActivo } from "./actions"
import type { PresupuestoActivo } from "./types"

export default function Almacen() {
  // El proyecto se elige en /inicio (landing); acá solo se lee.
  const { proyecto: proyectoActual } = useProyectoActual()

  return (
    <>
      <EncabezadoPagina
        titulo="Elaboración de requisiciones"
        subtitulo="Haz requisiciones de insumos de almacén para el proyecto en el que estás trabajando."
      />

      {!proyectoActual && <SinProyecto />}

      {/* key: al cambiar de proyecto se empieza de cero (aviso, error y presupuesto). */}
      {proyectoActual && (
        <Requisiciones key={proyectoActual.id} proyectoId={proyectoActual.id} proyectoNombre={proyectoActual.nombre} />
      )}
    </>
  )
}

function Requisiciones({ proyectoId, proyectoNombre }: { proyectoId: string; proyectoNombre: string }) {
  // Aviso tras crear: "Requisición N creada" con enlace a su detalle.
  const [creada, setCreada] = useState<{ requisicionId: string; numero: number } | null>(null)
  // null = todavía cargando el presupuesto del proyecto.
  const [carga, setCarga] = useState<{ presupuesto: PresupuestoActivo | null; error: string | null } | null>(null)
  const presupuestoActivo = carga?.presupuesto ?? null
  const cargandoPresupuesto = carga === null
  const error = carga?.error ?? null

  useEffect(() => {
    let activo = true
    buscarPresupuestoActivo(proyectoId)
      .then((p) => activo && setCarga({ presupuesto: p, error: null }))
      .catch(
        (e) =>
          activo &&
          setCarga({ presupuesto: null, error: e instanceof Error ? e.message : "No se pudo cargar el presupuesto del proyecto." })
      )
    return () => {
      activo = false
    }
  }, [proyectoId])

  return (
      <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-6">
        <div className="space-y-2">
          {proyectoId && cargandoPresupuesto && (
            <p className="text-xs text-muted-foreground">Cargando presupuesto del proyecto…</p>
          )}
          {proyectoId && !cargandoPresupuesto && !presupuestoActivo && (
            <p className="text-xs text-amber-700">
              {proyectoNombre} todavía no tiene un presupuesto
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
  )
}