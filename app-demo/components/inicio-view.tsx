"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, FolderOpen, Loader2, Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useProyectoActual } from "@/components/proyecto-actual-provider"
import type { ProyectoActual } from "@/lib/proyecto-actual"

function normalizar(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
}

export function InicioView({ destino }: { destino: string }) {
  const { proyecto, proyectos, errorProyectos, cambiarProyecto } = useProyectoActual()
  const router = useRouter()
  const [busqueda, setBusqueda] = useState("")
  const [abriendo, setAbriendo] = useState<string | null>(null)

  const filtrados = useMemo(() => {
    if (!proyectos) return []
    const q = normalizar(busqueda.trim())
    const lista = q
      ? proyectos.filter((p) => normalizar(`${p.codigo ?? ""} ${p.nombre}`).includes(q))
      : proyectos
    // El último proyecto usado primero, para que "seguir donde iba" sea un clic.
    return [...lista].sort((a, b) => Number(b.id === proyecto?.id) - Number(a.id === proyecto?.id))
  }, [proyectos, busqueda, proyecto?.id])

  async function abrir(p: ProyectoActual) {
    setAbriendo(p.id)
    try {
      await cambiarProyecto(p)
      router.push(destino)
    } catch {
      setAbriendo(null)
    }
  }

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proyectos</h1>
          <p className="text-sm text-muted-foreground">
            Escoge el proyecto en el que vas a trabajar. Puedes cambiarlo después desde el encabezado.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 p-6">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por código o nombre…"
            className="h-10 pl-9"
          />
        </div>

        {errorProyectos && <p className="text-sm text-destructive">{errorProyectos}</p>}

        {!proyectos && !errorProyectos && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        )}

        {proyectos && proyectos.length === 0 && (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">No tienes proyectos asignados</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Pídele a un administrador que te dé acceso a los proyectos en los que trabajas.
            </p>
          </div>
        )}

        {proyectos && proyectos.length > 0 && filtrados.length === 0 && (
          <p className="text-sm text-muted-foreground">Ningún proyecto coincide con &ldquo;{busqueda}&rdquo;.</p>
        )}

        {filtrados.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtrados.map((p) => {
              const esActual = p.id === proyecto?.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => abrir(p)}
                  disabled={abriendo !== null}
                  className={`group flex min-h-24 items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:border-primary hover:bg-accent/40 disabled:opacity-60 ${
                    esActual ? "border-primary bg-accent/30" : ""
                  }`}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {abriendo === p.id ? <Loader2 className="size-5 animate-spin" /> : <FolderOpen className="size-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {p.codigo && <p className="text-xs font-medium text-primary">{p.codigo}</p>}
                    <p className="line-clamp-2 text-sm font-medium">{p.nombre}</p>
                    {esActual && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Check className="size-3" /> Último usado
                      </p>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
