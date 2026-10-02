"use client"

import { COMODIN_LISTAR } from "@/lib/busqueda"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, CheckCircle2, Loader2, MapPin, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useProyectoActual } from "@/components/proyecto-provider"
import { seleccionarProyecto } from "@/app/(app)/inicio/actions"

// Landing: el ÚNICO lugar donde se elige el proyecto de trabajo.
export function LandingProyectos({
  destino,
  sinPermiso,
}: {
  destino: string
  sinPermiso: boolean
}) {
  const router = useRouter()
  const { proyecto: actual, proyectos } = useProyectoActual()
  const [busqueda, setBusqueda] = useState("")
  const [eligiendo, setEligiendo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q || q === COMODIN_LISTAR) return proyectos
    return proyectos.filter((p) =>
      [p.codigo, p.nombre, p.cliente, p.ciudad].some((x) => (x ?? "").toLowerCase().includes(q))
    )
  }, [proyectos, busqueda])

  async function elegir(id: string) {
    setEligiendo(id)
    setError(null)
    try {
      await seleccionarProyecto(id)
      router.push(destino)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo seleccionar el proyecto.")
      setEligiendo(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {sinPermiso && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          No tienes permiso para abrir esa sección. Elige un proyecto para continuar.
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {proyectos.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          No tienes proyectos asignados. Pídele a un administrador que te dé acceso a uno.
        </div>
      ) : (
        <>
          {proyectos.length > 6 && (
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar por código, nombre, cliente o ciudad"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtrados.map((p) => {
              const esActual = actual?.id === p.id
              const cargando = eligiendo === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={eligiendo !== null}
                  onClick={() => elegir(p.id)}
                  className={`flex flex-col items-start gap-2 rounded-xl border p-5 text-left transition-colors hover:border-primary hover:bg-accent/40 disabled:opacity-60 ${
                    esActual ? "border-primary bg-primary/5" : "bg-card"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    {cargando ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : esActual ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-primary">
                        <CheckCircle2 className="h-4 w-4" /> Proyecto actual
                      </span>
                    ) : null}
                  </div>
                  <div>
                    {p.codigo && <p className="font-mono text-xs text-muted-foreground">{p.codigo}</p>}
                    <p className="text-base font-semibold leading-snug">{p.nombre}</p>
                  </div>
                  {(p.cliente || p.ciudad) && (
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      {p.cliente && <p>{p.cliente}</p>}
                      {p.ciudad && (
                        <p className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" /> {p.ciudad}
                        </p>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
            {filtrados.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                Ningún proyecto coincide con la búsqueda.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
