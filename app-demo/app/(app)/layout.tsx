import { SidebarInset } from "@/components/ui/sidebar"
import { ShellSidebar } from "@/components/app-shell"
import { AppSidebar } from "@/components/app-sidebar"
import { ProyectoProvider } from "@/components/proyecto-provider"
import { obtenerPermisosRol, obtenerUsuarioId } from "@/lib/permisos"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { COOKIE_PROYECTO } from "@/lib/proyecto-actual"
import { listarMisProyectos } from "./inicio/actions"

async function obtenerNombreUsuario(): Promise<string | null> {
  try {
    const id = await obtenerUsuarioId()
    if (!id) return null
    const supabase = await createClient()
    const { data } = await supabase.from("perfiles").select("nombre").eq("id", id).maybeSingle()
    return data?.nombre?.trim() || null
  } catch {
    return null
  }
}

export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  // Rol, pestañas y acciones del usuario (las calcula el middleware una vez
  // por request; ver lib/permisos.ts). El menú se arma con eso.
  // Proyecto actual: la cookie que se fija en /inicio, validada contra los
  // proyectos que el usuario puede ver (si ya no tiene acceso, se ignora).
  const [permisos, proyectos, jar] = await Promise.all([
    obtenerPermisosRol(),
    listarMisProyectos().catch(() => []),
    cookies(),
  ])
  // Nombre real del usuario para el pie del menú lateral.
  const nombreUsuario = await obtenerNombreUsuario()
  const idCookie = jar.get(COOKIE_PROYECTO)?.value
  const proyectoActual = proyectos.find((p) => p.id === idCookie) ?? null

  return (
    <ProyectoProvider proyecto={proyectoActual} proyectos={proyectos}>
      <ShellSidebar>
        <AppSidebar permisos={permisos} nombreUsuario={nombreUsuario} />

        <SidebarInset className="min-w-0">{children}</SidebarInset>
      </ShellSidebar>
    </ProyectoProvider>
  )
}
