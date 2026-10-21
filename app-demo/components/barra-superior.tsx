"use client"

import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { LogOut, PenLine, ShieldCheck } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MiFirmaDialog } from "@/components/mi-firma-dialog"
import { VerificarDocumentoDialog } from "@/components/verificar-documento-dialog"
import { CampanitaNotificaciones } from "@/components/campanita-notificaciones"
import { SelectorProyecto } from "@/components/selector-proyecto"
import { handleLogout } from "@/components/logout-button"
import type { PermisosRol } from "@/lib/pestanas"

// Barra fija de arriba, a todo el ancho de la página: logo, proyecto actual
// (el ÚNICO lugar donde se cambia de proyecto, además de /inicio), campanita
// y usuario (su menú: Mi firma y Verificar documento). Su alto es --alto-barra (app-shell): el menú lateral empieza
// debajo y el contenido se corre ese mismo alto.

const ROL_POR_DEFECTO = "Usuario"

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

export function BarraSuperior({ permisos, nombreUsuario }: { permisos: PermisosRol | null; nombreUsuario: string | null }) {
  const nombre = nombreUsuario ?? "Usuario"
  const rolVisible = permisos?.rolNombre ?? (permisos?.esAdministrador ? "Administrador" : ROL_POR_DEFECTO)
  const [dialogo, setDialogo] = useState<"firma" | "verificar" | null>(null)

  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-[var(--alto-barra)] items-center gap-2 border-b bg-background px-3 sm:gap-4 sm:px-4">
      <Link href="/inicio" aria-label="Inicio" className="shrink-0">
        <Image
          src="/logo-conyca.png"
          alt="CONYCA Soluciones"
          width={160}
          height={45}
          priority
          className="h-7 w-auto sm:h-9"
        />
      </Link>

      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-3">
        <SelectorProyecto />
        <CampanitaNotificaciones />

        <div className="flex items-center gap-2 border-l pl-2 sm:pl-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex min-w-0 items-center gap-2 rounded-md p-0.5 text-left transition-colors hover:bg-accent"
              title={`${nombre} · ${rolVisible}`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {iniciales(nombre)}
              </span>
              <span className="hidden min-w-0 flex-col md:flex">
                <span className="max-w-44 truncate text-sm font-medium leading-tight">{nombre}</span>
                <span className="max-w-44 truncate text-xs text-muted-foreground">{rolVisible}</span>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setDialogo("firma")}>
                <PenLine /> Mi firma
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialogo("verificar")}>
                <ShieldCheck /> Verificar documento
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
            <TooltipContent side="bottom">Cerrar sesión</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <MiFirmaDialog abierto={dialogo === "firma"} onCerrar={() => setDialogo(null)} />
      <VerificarDocumentoDialog abierto={dialogo === "verificar"} onCerrar={() => setDialogo(null)} />
    </header>
  )
}
