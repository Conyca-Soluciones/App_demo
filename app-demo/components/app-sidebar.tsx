"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter, usePathname } from "next/navigation"
import { ChevronRight, LayoutDashboard, LogOut } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { handleLogout } from "./logout-button"
import { CampanitaNotificaciones } from "@/components/campanita-notificaciones"
import { construirMenu, type PermisosRol } from "@/lib/pestanas"

// El menú sale de lib/pestanas.ts filtrado por el rol del usuario (Roles y
// permisos). Un usuario sin rol asignado ve el menú completo, como antes.
// Placeholder de usuario -- reemplazar por el usuario real (perfiles.nombre
// + iniciales) cuando esté disponible en este componente; se dejó igual
// a como estaba en el código original (no se cambia lógica de datos acá,
// solo la disposición visual).
const usuarioActual = { nombre: "Sofia", rol: "Usuario", iniciales: "SP" }

export function AppSidebar({ permisos }: { permisos: PermisosRol | null }) {
  const navMain = permisos ? construirMenu(permisos) : []
  const rolVisible =
    permisos?.rolNombre ?? (permisos?.esAdministrador ? "Administrador" : usuarioActual.rol)

  const router = useRouter()
  const pathname = usePathname()

  // Controlado en vez de defaultOpen -- ver explicación en el chat: como
  // `activo` se recalcula en cada render a partir de pathname (y estos
  // Collapsible nunca se desmontan al navegar dentro de la app), pasarle
  // ese valor cambiante a defaultOpen disparaba la advertencia de Base UI
  // de "estás cambiando el estado default de un Collapsible ya
  // inicializado". Con open/onOpenChange queda controlado desde el
  // primer render (nunca undefined) y el usuario también puede abrir o
  // cerrar cualquier grupo a mano -- esa elección manda sobre el cálculo
  // automático de `activo` una vez que el usuario toca ese grupo.
  const [gruposAbiertos, setGruposAbiertos] = useState<Record<string, boolean>>({})

  return (
    <Sidebar collapsible="icon">
      {/* ---------------------------------------------------------------
          Header: logo de CONYCA + campanita de notificaciones debajo.
          group-data-[collapsable=icon] alterna entre el logo completo
          (expandido) y solo el ícono triangular (colapsado) -- mismo
          patrón que ya usa el resto del sidebar (group-data-[state=open]
          /collapsible en el chevron). La campanita no necesita variante
          para modo colapsado -- es un solo ícono con badge, cabe igual
          en las dos fila.
          --------------------------------------------------------------- */}
      <SidebarHeader className="border-b px-3 py-4">
        <div className="flex items-center justify-center group-data-[collapsible=icon]:justify-center">
          <Image
            src="/logo-conyca.png"
            alt="CONYCA Soluciones"
            width={160}
            height={45}
            priority
            className="h-auto w-full max-w-[160px] group-data-[collapsible=icon]:hidden"
          />
          <Image
            src="/logo-conyca-icono.png"
            alt="CONYCA"
            width={28}
            height={41}
            priority
            className="hidden h-9 w-auto group-data-[collapsible=icon]:block"
          />
        </div>
        <div className="mt-2 flex items-center justify-center">
          <CampanitaNotificaciones />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Módulos</SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {navMain.map((grupo) => {
                const activo = grupo.items.some((item) => item.url === pathname)

                return (
                  <Collapsible
                    key={grupo.titulo}
                    open={gruposAbiertos[grupo.titulo] ?? activo}
                    onOpenChange={(open) =>
                      setGruposAbiertos((prev) => ({ ...prev, [grupo.titulo]: open }))
                    }
                    className="group/collapsible"
                    render={<SidebarMenuItem />}
                  >
                    <CollapsibleTrigger render={<SidebarMenuButton tooltip={grupo.titulo} />}>
                      <LayoutDashboard className="size-4" />
                      <span>{grupo.titulo}</span>
                      <ChevronRight className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {grupo.items.map((item) => (
                          <SidebarMenuSubItem key={`${grupo.titulo}-${item.titulo}`}>
                            <SidebarMenuSubButton
                              isActive={pathname === item.url}
                              onClick={() => router.push(item.url)}
                            >
                              <span>{item.titulo}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {usuarioActual.iniciales}
              </div>

              <div className="flex min-w-0 flex-1 flex-col text-left group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium">{usuarioActual.nombre}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {rolVisible}
                </span>
              </div>

              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={handleLogout}
                      aria-label="Cerrar sesión"
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-data-[collapsible=icon]:hidden"
                    />
                  }
                >
                  <LogOut className="size-4" />
                </TooltipTrigger>
                <TooltipContent side="right">Cerrar sesión</TooltipContent>
              </Tooltip>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              aria-label="Cerrar sesión"
              className="mt-1 hidden w-full items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-data-[collapsible=icon]:flex"
            >
              <LogOut className="size-4" />
            </button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}