"use client"

import { createContext, useContext, useState } from "react"
import { SidebarProvider } from "@/components/ui/sidebar"

// El menú lateral crece hacia la derecha a medida que se abren sus niveles
// (módulos -> secciones -> pestañas). El ancho vive en la variable CSS
// --sidebar-width del SidebarProvider (la usan tanto el menú como el hueco que
// empuja el contenido), así que el que decide el ancho -- AppSidebar -- se lo
// avisa a este contenedor por contexto.

const ANCHO_BASE = "11rem"

const AnchoSidebarContext = createContext<(ancho: string) => void>(() => {})

export const useAnchoSidebar = () => useContext(AnchoSidebarContext)

export function ShellSidebar({ children }: { children: React.ReactNode }) {
  const [ancho, setAncho] = useState(ANCHO_BASE)
  return (
    <AnchoSidebarContext.Provider value={setAncho}>
      <SidebarProvider style={{ "--sidebar-width": ancho } as React.CSSProperties}>
        {children}
      </SidebarProvider>
    </AnchoSidebarContext.Provider>
  )
}
