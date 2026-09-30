import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { obtenerPermisosRol } from "@/lib/permisos"

export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  // Rol, pestañas y acciones del usuario (las calcula el middleware una vez
  // por request; ver lib/permisos.ts). El menú se arma con eso.
  const permisos = await obtenerPermisosRol()

  return (
    <SidebarProvider>
      <AppSidebar permisos={permisos} />

      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  )
}
