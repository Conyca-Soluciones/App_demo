"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { ChevronLeft, ChevronRight, HardHat, Landmark, Settings } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useAnchoSidebar } from "@/components/app-shell"
import { construirModulos, type ModuloClave, type PermisosRol } from "@/lib/pestanas"

// El menú sale de lib/pestanas.ts filtrado por el rol del usuario (Roles y
// permisos). Un usuario sin rol asignado ve el menú completo, como antes.
//
// Tres niveles que se abren hacia la derecha, cada uno una columna:
//   1. MÓDULOS (AdPro, A&F, Admin)        -- siempre visible: el menú angosto
//   2. SECCIONES del módulo elegido   (Presupuestos, Requisiciones, ...)
//   3. PESTAÑAS de la sección elegida
// El ancho total crece con cada nivel abierto (ver AnchoSidebar en app-shell).
// Logo, proyecto, campanita y usuario están en la barra de arriba (BarraSuperior).
const ANCHO_MODULOS = 8 // rem
const ANCHO_SECCIONES = 12
const ANCHO_PESTANAS = 16

const ICONO_MODULO: Record<ModuloClave, React.ReactNode> = {
  adpro: <HardHat className="size-4" />,
  ayf: <Landmark className="size-4" />,
  admin: <Settings className="size-4" />,
}

export function AppSidebar({ permisos }: { permisos: PermisosRol | null }) {
  const modulos = permisos ? construirModulos(permisos) : []

  const router = useRouter()
  const pathname = usePathname()
  const setAncho = useAnchoSidebar()

  // Dónde está la página actual (módulo y sección), para resaltarla.
  const ubicacionActual = (() => {
    for (const m of modulos) {
      for (const g of m.grupos) {
        if (g.items.some((i) => i.url === pathname)) return { modulo: m.clave, seccion: g.titulo }
      }
    }
    return null
  })()

  // De entrada el menú está minimizado (solo módulos); la ubicación actual se
  // resalta sin abrir nada.
  const [moduloAbierto, setModuloAbierto] = useState<ModuloClave | null>(null)
  const [seccionAbierta, setSeccionAbierta] = useState<string | null>(null)

  const modulo = modulos.find((m) => m.clave === moduloAbierto) ?? null
  const seccion = modulo?.grupos.find((g) => g.titulo === seccionAbierta) ?? null

  // El menú se ensancha con cada nivel abierto.
  const ancho = ANCHO_MODULOS + (modulo ? ANCHO_SECCIONES : 0) + (seccion ? ANCHO_PESTANAS : 0)
  useEffect(() => {
    // + 1px: el borde derecho del contenedor (si no, sale una barra de scroll horizontal).
    setAncho(`calc(${ancho}rem + 1px)`)
  }, [ancho, setAncho])

  function elegirModulo(clave: ModuloClave) {
    // Volver a tocar el módulo abierto lo cierra (y con él lo de la derecha).
    setModuloAbierto((actual) => (actual === clave ? null : clave))
    setSeccionAbierta(null)
  }

  // Flecha de la orilla: con el menú minimizado lo abre completo siguiendo la
  // ruta de la página actual (su módulo y su sección ya seleccionados); con el
  // menú abierto lo vuelve a minimizar.
  const abierto = moduloAbierto !== null
  function alternarMenu() {
    if (abierto) {
      setModuloAbierto(null)
      setSeccionAbierta(null)
    } else if (ubicacionActual) {
      setModuloAbierto(ubicacionActual.modulo)
      setSeccionAbierta(ubicacionActual.seccion)
    }
  }
  // Sin una página del menú abierta (p. ej. el inicio) no hay ruta que seguir.
  const puedeAlternar = abierto || ubicacionActual !== null

  function elegirSeccion(titulo: string) {
    setSeccionAbierta((actual) => (actual === titulo ? null : titulo))
  }

  return (
    <Sidebar>
      <div className="relative h-full min-h-0 w-full">
      {puedeAlternar && (
        <button
          type="button"
          onClick={alternarMenu}
          aria-label={abierto ? "Minimizar el menú" : "Abrir el menú en la página actual"}
          title={abierto ? "Minimizar el menú" : "Abrir el menú en la página actual"}
          className="absolute top-1/2 -right-3 z-30 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
        >
          {abierto ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
      )}
      <div className="flex h-full min-h-0 w-full overflow-x-auto">
        {/* ------------------------------------------------ 1. Módulos */}
        <div
          className="flex h-full min-h-0 shrink-0 flex-col border-r"
          style={{ width: `${ANCHO_MODULOS}rem` }}
        >
          <SidebarContent>
            <SidebarMenu className="p-2">
              {modulos.map((m) => {
                const contieneActual = ubicacionActual?.modulo === m.clave
                return (
                  <SidebarMenuItem key={m.clave}>
                    <SidebarMenuButton
                      isActive={moduloAbierto === m.clave || (moduloAbierto === null && contieneActual)}
                      onClick={() => elegirModulo(m.clave)}
                      title={m.descripcion}
                    >
                      {ICONO_MODULO[m.clave]}
                      <span className="font-medium">{m.titulo}</span>
                      <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarContent>

        </div>

        {/* ------------------------------------------------ 2. Secciones */}
        {modulo && (
          <div
            className="flex h-full min-h-0 shrink-0 flex-col border-r bg-sidebar"
            style={{ width: `${ANCHO_SECCIONES}rem` }}
          >
            <div className="border-b px-3 py-4">
              <p className="text-sm font-semibold">{modulo.titulo}</p>
              <p className="text-[11px] text-muted-foreground">{modulo.descripcion}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {modulo.grupos.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Próximamente: este módulo todavía no tiene herramientas.
                </p>
              ) : (
                <SidebarMenu>
                  {modulo.grupos.map((g) => {
                    const contieneActual =
                      ubicacionActual?.modulo === modulo.clave && ubicacionActual.seccion === g.titulo
                    return (
                      <SidebarMenuItem key={g.titulo}>
                        <SidebarMenuButton
                          isActive={seccionAbierta === g.titulo || (seccionAbierta === null && contieneActual)}
                          onClick={() => elegirSeccion(g.titulo)}
                        >
                          <span>{g.titulo}</span>
                          <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              )}
            </div>
          </div>
        )}

        {/* ------------------------------------------------ 3. Pestañas */}
        {seccion && (
          <div
            className="flex h-full min-h-0 shrink-0 flex-col bg-sidebar"
            style={{ width: `${ANCHO_PESTANAS}rem` }}
          >
            <div className="border-b px-3 py-4">
              <p className="text-sm font-semibold">{seccion.titulo}</p>
              <p className="text-[11px] text-muted-foreground">{modulo?.titulo}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <SidebarMenu>
                {seccion.items.map((item, i) => (
                  <SidebarMenuItem key={`${seccion.titulo}-${item.titulo}`}>
                    {/* Encabezado del subgrupo (p. ej. "Actas") sobre su primera pestaña. */}
                    {item.subseccion && item.subseccion !== seccion.items[i - 1]?.subseccion && (
                      <p className={`px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${i > 0 ? "pt-3" : ""}`}>
                        {item.subseccion}
                      </p>
                    )}
                    {!item.subseccion && i > 0 && seccion.items[i - 1]?.subseccion && <div className="pt-2" />}
                    <SidebarMenuButton
                      isActive={pathname === item.url}
                      className={item.subseccion ? "pl-4" : undefined}
                      onClick={() => {
                        router.push(item.url)
                        // Al elegir una pestaña el menú se minimiza a solo los módulos.
                        setModuloAbierto(null)
                        setSeccionAbierta(null)
                      }}
                    >
                      <span className="whitespace-normal leading-tight">{item.titulo}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </div>
          </div>
        )}
      </div>
      </div>
    </Sidebar>
  )
}
