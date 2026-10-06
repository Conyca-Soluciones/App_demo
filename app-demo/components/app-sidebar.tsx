"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter, usePathname } from "next/navigation"
import {
  ArrowLeftRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  HardHat,
  Landmark,
  LogOut,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { handleLogout } from "./logout-button"
import { CampanitaNotificaciones } from "@/components/campanita-notificaciones"
import { useAnchoSidebar } from "@/components/app-shell"
import { construirModulos, type ModuloClave, type PermisosRol } from "@/lib/pestanas"
import { useProyectoActual } from "@/components/proyecto-provider"

// El menú sale de lib/pestanas.ts filtrado por el rol del usuario (Roles y
// permisos). Un usuario sin rol asignado ve el menú completo, como antes.
//
// Tres niveles que se abren hacia la derecha, cada uno una columna:
//   1. MÓDULOS (AdPro, A&F...)        -- siempre visible: el menú angosto
//   2. SECCIONES del módulo elegido   (Presupuestos, Requisiciones, ...)
//   3. PESTAÑAS de la sección elegida
// El ancho total crece con cada nivel abierto (ver AnchoSidebar en app-shell).
const ROL_POR_DEFECTO = "Usuario"

const ANCHO_MODULOS = 11 // rem
const ANCHO_SECCIONES = 12
const ANCHO_PESTANAS = 16

const ICONO_MODULO: Record<ModuloClave, React.ReactNode> = {
  adpro: <HardHat className="size-4" />,
  ayf: <Landmark className="size-4" />,
}

// Hasta dos iniciales del nombre real ("Luis Pérez" -> "LP").
function iniciales(nombre: string) {
  const letras = nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
  return letras.toUpperCase() || "?"
}

export function AppSidebar({
  permisos,
  nombreUsuario,
}: {
  permisos: PermisosRol | null
  nombreUsuario: string | null
}) {
  const nombre = nombreUsuario ?? "Usuario"
  const modulos = permisos ? construirModulos(permisos) : []
  const { proyecto } = useProyectoActual()
  const rolVisible =
    permisos?.rolNombre ?? (permisos?.esAdministrador ? "Administrador" : ROL_POR_DEFECTO)

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
    setAncho(`${ancho}rem`)
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
          <SidebarHeader className="border-b px-3 py-4">
            <div className="flex items-center justify-center">
              <Image
                src="/logo-conyca.png"
                alt="CONYCA Soluciones"
                width={160}
                height={45}
                priority
                className="h-auto w-full max-w-[130px]"
              />
            </div>
            <div className="mt-2 flex items-center justify-center">
              <CampanitaNotificaciones />
            </div>
          </SidebarHeader>

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

          <SidebarFooter className="border-t">
            {/* Proyecto actual + acceso al landing para cambiarlo. Es el ÚNICO
                lugar de la app desde donde se cambia de proyecto. */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={() => router.push("/inicio")}
                    aria-label="Cambiar proyecto"
                    className="flex w-full items-center gap-2 rounded-md border bg-sidebar-accent/40 px-2 py-2 text-left transition-colors hover:bg-sidebar-accent"
                  />
                }
              >
                <Building2 className="size-4 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs font-semibold">
                    {proyecto ? proyecto.codigo ?? proyecto.nombre : "Sin proyecto"}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {proyecto ? "Cambiar proyecto" : "Seleccionar proyecto"}
                  </span>
                </div>
                <ArrowLeftRight className="size-3.5 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right">
                {proyecto ? `${proyecto.nombre} — cambiar proyecto` : "Seleccionar proyecto"}
              </TooltipContent>
            </Tooltip>

            <div className="flex items-center gap-2 px-1 py-1.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {iniciales(nombre)}
              </div>

              <div className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-sm font-medium">{nombre}</span>
                <span className="truncate text-xs text-muted-foreground">{rolVisible}</span>
              </div>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={handleLogout}
                      aria-label="Cerrar sesión"
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    />
                  }
                >
                  <LogOut className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">Cerrar sesión</TooltipContent>
              </Tooltip>
            </div>
          </SidebarFooter>
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
                {seccion.items.map((item) => (
                  <SidebarMenuItem key={`${seccion.titulo}-${item.titulo}`}>
                    <SidebarMenuButton
                      isActive={pathname === item.url}
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
