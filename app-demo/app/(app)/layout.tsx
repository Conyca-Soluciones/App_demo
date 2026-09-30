import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { ProyectoProvider } from "@/components/proyecto-provider"
import { obtenerPermisosRol } from "@/lib/permisos"
import { cookies } from "next/headers"
import { COOKIE_PROYECTO } from "@/lib/proyecto-actual"
import { listarMisProyectos } from "./inicio/actions"

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
  const idCookie = jar.get(COOKIE_PROYECTO)?.value
  const proyectoActual = proyectos.find((p) => p.id === idCookie) ?? null

  return (
    <ProyectoProvider proyecto={proyectoActual} proyectos={proyectos}>
      <SidebarProvider>
        <AppSidebar permisos={permisos} />

        <SidebarInset className="min-w-0">{children}</SidebarInset>
      </SidebarProvider>
    </ProyectoProvider>
  )
}
