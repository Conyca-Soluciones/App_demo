"use client"

import { createContext, useContext, useState } from "react"
import { SidebarProvider } from "@/components/ui/sidebar"

// El menú lateral crece hacia la derecha a medida que se abren sus niveles
// (módulos -> secciones -> pestañas). El ancho vive en la variable CSS
// --sidebar-width del SidebarProvider (la usan tanto el menú como el hueco que
// empuja el contenido), así que el que decide el ancho -- AppSidebar -- se lo
// avisa a este contenedor por contexto.

const ANCHO_BASE = "calc(8rem + 1px)"
// Alto de la barra fija de arriba (BarraSuperior). El menú lateral empieza
// debajo y el contenido se corre este alto.
const ALTO_BARRA = "3.5rem"

const AnchoSidebarContext = createContext<(ancho: string) => void>(() => {})

export const useAnchoSidebar = () => useContext(AnchoSidebarContext)

export function ShellSidebar({ children }: { children: React.ReactNode }) {
  const [ancho, setAncho] = useState(ANCHO_BASE)
  return (
    <AnchoSidebarContext.Provider value={setAncho}>
      <SidebarProvider style={{ "--sidebar-width": ancho, "--alto-barra": ALTO_BARRA } as React.CSSProperties}>
        {children}
      </SidebarProvider>
    </AnchoSidebarContext.Provider>
  )
}
