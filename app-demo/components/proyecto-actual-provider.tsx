"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { elegirProyecto, listarMisProyectos } from "@/app/(app)/inicio/actions"
import type { ProyectoActual } from "@/lib/proyecto-actual"

type ContextoProyecto = {
  proyecto: ProyectoActual | null
  // null = todavía cargando
  proyectos: ProyectoActual[] | null
  errorProyectos: string | null
  cambiarProyecto: (p: ProyectoActual) => Promise<void>
}

const Contexto = createContext<ContextoProyecto | null>(null)

// Vive en el layout de (app): se monta una vez por sesión de navegación, así
// que la lista de proyectos se trae UNA vez y la comparten la landing y el
// selector del header de cada página.
export function ProyectoActualProvider({
  inicial,
  children,
}: {
  inicial: ProyectoActual | null
  children: React.ReactNode
}) {
  const [proyecto, setProyecto] = useState<ProyectoActual | null>(inicial)
  const [proyectos, setProyectos] = useState<ProyectoActual[] | null>(null)
  const [errorProyectos, setErrorProyectos] = useState<string | null>(null)

  useEffect(() => {
    listarMisProyectos()
      .then((lista: ProyectoActual[]) => {
        setProyectos(lista)
        // La cookie puede quedar vieja (le quitaron el acceso, o el proyecto
        // se renombró): se corrige contra la lista real.
        setProyecto((actual) => {
          if (!actual) return actual
          const vigente = lista.find((p: ProyectoActual) => p.id === actual.id)
          if (!vigente) {
            elegirProyecto(null).catch(() => {})
            return null
          }
          if (vigente.nombre !== actual.nombre || vigente.codigo !== actual.codigo) {
            elegirProyecto(vigente).catch(() => {})
          }
          return vigente
        })
      })
      .catch((e) => setErrorProyectos(e instanceof Error ? e.message : "No se pudieron cargar los proyectos"))
  }, [])

  const cambiarProyecto = useCallback(async (p: ProyectoActual) => {
    setProyecto(p)
    await elegirProyecto(p)
  }, [])

  return (
    <Contexto.Provider value={{ proyecto, proyectos, errorProyectos, cambiarProyecto }}>
      {children}
    </Contexto.Provider>
  )
}

export function useProyectoActual(): ContextoProyecto {
  const ctx = useContext(Contexto)
  if (!ctx) throw new Error("useProyectoActual debe usarse dentro de ProyectoActualProvider")
  return ctx
}
