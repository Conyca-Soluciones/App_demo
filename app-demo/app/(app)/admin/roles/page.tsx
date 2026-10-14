import { RolesPermisosView } from "@/components/roles-permisos-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

// Alto fijo (pantalla menos la barra de arriba): así hace scroll la tabla y no
// la ventana, y la fila de títulos (sticky) queda siempre visible.
export default function RolesPage() {
  return (
    <div className="h-[calc(100svh-var(--alto-barra))]">
      <MarcoPagina
        titulo="Roles y permisos"
        subtitulo="Marca qué pestañas y qué acciones tiene cada rol. Los cambios se guardan al instante y se aplican la próxima vez que la persona cargue una página. El Administrador siempre tiene todo."
      >
        <RolesPermisosView />
      </MarcoPagina>
    </div>
  )
}
