import Image from "next/image"
import { LandingProyectos } from "@/components/landing-proyectos"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { TituloPestana } from "@/components/titulo-pestana"

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  // Después de elegir el proyecto se llega a Mis pendientes (T1): lo que le
  // toca a la persona en todos sus proyectos. Es una ruta libre (cada quien ve
  // solo lo suyo, la base lo filtra).
  const destino = "/pendientes"

  return (
    // Sin título ni subtítulo (decisión del usuario, 2026-11-23): solo el logo y
    // los proyectos. El botón del menú se deja (en el celular es la única forma de abrirlo).
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TituloPestana titulo="Proyectos" />
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
      <SidebarTrigger />
      <div className="mb-8 flex justify-center pt-2">
        <div className="rounded-2xl dark:bg-white dark:px-6 dark:py-4">
          <Image
            src="/logo-conyca360.png"
            alt="CONYCA 360"
            width={1120}
            height={173}
            priority
            className="h-auto w-[280px] sm:w-[400px]"
          />
        </div>
      </div>
      <LandingProyectos destino={destino} sinPermiso={error === "no-autorizado"} />
      </div>
    </div>
  )
}
