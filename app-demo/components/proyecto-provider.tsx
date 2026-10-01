"use client"

import { createContext, useContext } from "react"
import type { ProyectoLanding } from "@/lib/proyecto-actual"

// Proyecto actual + proyectos accesibles, que calcula el layout en el
// servidor (cookie validada contra los proyectos del usuario). Cambiar de
// proyecto = seleccionarProyecto() + router.refresh(): el layout vuelve a
// correr, este valor cambia y las pantallas que dependen de `proyecto.id` se
// recargan solas.
type ValorProyecto = {
  proyecto: ProyectoLanding | null
  proyectos: ProyectoLanding[]
}

const ProyectoContext = createContext<ValorProyecto>({ proyecto: null, proyectos: [] })

export function ProyectoProvider({
  proyecto,
  proyectos,
  children,
}: ValorProyecto & { children: React.ReactNode }) {
  return <ProyectoContext.Provider value={{ proyecto, proyectos }}>{children}</ProyectoContext.Provider>
}

export function useProyectoActual() {
  return useContext(ProyectoContext)
}
