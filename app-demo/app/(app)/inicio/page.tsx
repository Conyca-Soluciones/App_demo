import { LandingProyectos } from "@/components/landing-proyectos"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { obtenerPermisosRol } from "@/lib/permisos"
import { rutaPrimeraPestana } from "@/lib/pestanas"

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const [permisos, { error }] = await Promise.all([obtenerPermisosRol(), searchParams])
  // A dónde ir después de elegir el proyecto: la primera pestaña del rol.
  const destino = permisos ? rutaPrimeraPestana(permisos) : "/presupuestos"

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-6">
      <SidebarTrigger />
      <LandingProyectos destino={destino} sinPermiso={error === "no-autorizado"} />
    </div>
  )
}
