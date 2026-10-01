import { RolesPermisosView } from "@/components/roles-permisos-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default function RolesPage() {
  return (
    <MarcoPagina
      titulo="Roles y permisos"
      subtitulo="Marca qué pestañas y qué acciones tiene cada rol. Los cambios se guardan al instante y se aplican la próxima vez que la persona cargue una página. El Administrador siempre tiene todo."
    >
      <RolesPermisosView />
    </MarcoPagina>
  )
}
