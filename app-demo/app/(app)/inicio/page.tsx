import Image from "next/image"
import { LandingProyectos } from "@/components/landing-proyectos"
import { MarcoPagina } from "@/components/encabezado-pagina"
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
    <MarcoPagina
      titulo="¿En qué proyecto vas a trabajar?"
      subtitulo="Elige un proyecto para continuar. Siempre puedes cambiarlo desde la barra de arriba."
      scroll
    >
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
    </MarcoPagina>
  )
}
