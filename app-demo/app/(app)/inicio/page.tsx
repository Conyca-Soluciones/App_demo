import Image from "next/image"
import { LandingProyectos } from "@/components/landing-proyectos"
import { MarcoPagina } from "@/components/encabezado-pagina"

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
