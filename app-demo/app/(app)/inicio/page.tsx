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
      subtitulo="Elige un proyecto para continuar. Siempre puedes cambiarlo desde la esquina inferior izquierda."
      scroll
    >
      <LandingProyectos destino={destino} sinPermiso={error === "no-autorizado"} />
    </MarcoPagina>
  )
}
