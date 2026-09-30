import { cookies } from "next/headers"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { ProyectoActualProvider } from "@/components/proyecto-actual-provider"
import { obtenerPermisosRol } from "@/lib/permisos"
import { COOKIE_PROYECTO_ACTUAL, parsearCookieProyecto } from "@/lib/proyecto-actual"

export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  // Rol, pestañas y acciones del usuario (las calcula el middleware una vez
  // por request; ver lib/permisos.ts). El menú se arma con eso.
  const permisos = await obtenerPermisosRol()
  // Proyecto escogido en /inicio (ver lib/proyecto-actual.ts).
  const proyectoInicial = parsearCookieProyecto((await cookies()).get(COOKIE_PROYECTO_ACTUAL)?.value)

  return (
    <ProyectoActualProvider inicial={proyectoInicial}>
      <SidebarProvider>
        <AppSidebar permisos={permisos} />

        <SidebarInset className="min-w-0">{children}</SidebarInset>
      </SidebarProvider>
    </ProyectoActualProvider>
  )
}
