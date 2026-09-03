"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ComposicionChart } from "@/components/composicion-chart"
import {
  listarVersiones,
  cargarVersion,
  type ItemPresupuesto,
  type VersionPresupuesto,
} from "../actions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ---------------------------------------------------------------------------
// Página de gráficas, separada de la principal de presupuestos -- a
// propósito, para que cuando exista un módulo de Ejecución (comparar
// presupuesto vs gasto real) se pueda migrar/ampliar esta página sin tocar
// la de edición del presupuesto. Recibe el presupuesto por query param
// (?presupuestoId=...) en vez de por selector de proyecto, porque siempre
// se llega acá desde el botón "Ver gráficas →" de la página principal, que
// ya sabe cuál presupuesto es.
// ---------------------------------------------------------------------------

export default function GraficasPresupuesto() {
  const searchParams = useSearchParams()
  const presupuestoId = searchParams.get("presupuestoId")

  const [versiones, setVersiones] = useState<VersionPresupuesto[]>([])
  const [versionId, setVersionId] = useState<string | null>(null)
  const [items, setItems] = useState<ItemPresupuesto[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!presupuestoId) return
    listarVersiones(presupuestoId)
      .then((lista) => {
        setVersiones(lista)
        setVersionId(lista.find((v) => v.esActual)?.id ?? lista[0]?.id ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las versiones."))
  }, [presupuestoId])

  useEffect(() => {
    if (!versionId) return
    setCargando(true)
    setError(null)
    cargarVersion(versionId)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la versión."))
      .finally(() => setCargando(false))
  }, [versionId])

  if (!presupuestoId) {
    return (
      <main className="mx-auto max-w-3xl space-y-3 p-6">
        <p className="text-sm text-muted-foreground">
          Falta el presupuesto -- entra desde el botón "Ver gráficas" dentro de un
          presupuesto.
        </p>
        <a href="/presupuestos" className="text-sm text-primary underline underline-offset-2">
          ← Volver a presupuestos
        </a>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <a
            href="/presupuestos"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            ← Volver al presupuesto
          </a>
          <h1 className="text-xl font-semibold">Gráficas del presupuesto</h1>
        </div>

        {versiones.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Versión</span>
            <Select
              value={versionId ?? ""}
              onValueChange={(id) => id && setVersionId(id)}
            >
              <SelectTrigger className="h-9 w-52 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versiones.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    v{v.numero} — {v.nombre}
                    {v.esActual ? " (actual)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : (
        <ComposicionChart data={items} />
      )}

      {/* Acá es donde entraría "presupuesto actual vs ejecución" cuando
          exista una fuente de gasto real -- ver nota en CLAUDE.md. */}
    </main>
  )
}