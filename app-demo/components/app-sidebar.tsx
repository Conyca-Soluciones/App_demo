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

type NavItem = {
  title: string
  url: string
}

type NavGroup = {
  title: string
  icon: React.ComponentType<{ className?: string }>
  items: NavItem[]
}

const navMain: NavGroup[] = [
  {
    title: "Presupuestos",
    icon: LayoutDashboard,
    items: [
      { title: "Elaboracion de presupuestos(edit)", url: "/presupuestos" },
      { title: "Insumos maestro", url: "/presupuestos/insumos" },
      { title: "Aprobacion de insumos", url: "/presupuestos/admin-insumos" },
      { title: "Aprobacion de mano de obra", url: "/presupuestos/admin-mo" },
    ],
  },
  {
    title: "Almacen",
    icon: LayoutDashboard,
    items: [
      
      { title: "Pedidos", url: "/almacen" },
      { title: "Aprobacion de Pedidos", url: "/admin-tecnico" },
    ],
  },

  {
    title: "Contratos",
    icon: LayoutDashboard,
    items: [
      { title: "Contratos", url: "/" },
      { title: "Cortes de proyectos", url: "/" },
      { title: "Informes", url: "/" },
    ],
  },

  // {
  //   title: "Mantenimiento",
  //   icon: LayoutDashboard,
  //   items: [{ title: "Control 1", url: "/presupuestos" }],
  // },

  {
    title: "Admin",
    icon: LayoutDashboard,
    items: [{ title: "Control Administrativo", url: "/admin" }],
  },
]

// Placeholder de usuario -- reemplazar por el usuario real (perfiles.nombre
// + iniciales) cuando esté disponible en este componente; se dejó igual
// a como estaba en el código original (no se cambia lógica de datos acá,
// solo la disposición visual).
const usuarioActual = { nombre: "Sofia", rol: "Usuario", iniciales: "SP" }

export function AppSidebar() {
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
          Header: logo de CONYCA. group-data-[collapsable=icon] alterna
          entre el logo completo (expandido) y solo el ícono triangular
          (colapsado) -- mismo patrón que ya usa el resto del sidebar
          (group-data-[state=open]/collapsible en el chevron).
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
                    key={grupo.title}
                    open={gruposAbiertos[grupo.title] ?? activo}
                    onOpenChange={(open) =>
                      setGruposAbiertos((prev) => ({ ...prev, [grupo.title]: open }))
                    }
                    className="group/collapsible"
                    render={<SidebarMenuItem />}
                  >
                    <CollapsibleTrigger render={<SidebarMenuButton tooltip={grupo.title} />}>
                      <grupo.icon className="size-4" />
                      <span>{grupo.title}</span>
                      <ChevronRight className="ml-auto size-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {grupo.items.map((item) => (
                          <SidebarMenuSubItem key={item.title}>
                            <SidebarMenuSubButton
                              isActive={pathname === item.url}
                              onClick={() => router.push(item.url)}
                            >
                              <span>{item.title}</span>
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

      {/* ---------------------------------------------------------------
          Footer: usuario + cerrar sesión integrados en un solo bloque,
          en vez del botón "Cerrar sesión" suelto que antes vivía
          arriba del todo, sin relación visual con el resto. El ícono
          de logout queda a la derecha del nombre, con tooltip -- patrón
          común en apps con sidebar (Linear, Notion, Vercel).
          --------------------------------------------------------------- */}
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
                  {usuarioActual.rol}
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

            {/* En modo colapsado (solo íconos), el botón de logout se
                muestra aparte, debajo del avatar, porque no cabe en la
                misma fila -- mismo ícono, mismo handler. */}
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