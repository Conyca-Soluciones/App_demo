import { UsuariosAccesosView } from "@/components/usuarios-accesos-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default function AccesosPage() {
  return (
    <MarcoPagina
      titulo="Usuarios y accesos"
      subtitulo="Elige el rol general de cada persona y los proyectos a los que puede entrar. Quien no tiene rol sigue con los permisos que tenía antes hasta que le asignes uno."
    >
      <UsuariosAccesosView />
    </MarcoPagina>
  )
}
