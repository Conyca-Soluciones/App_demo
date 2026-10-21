import { BancosAdminView } from "@/components/bancos-admin-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default function BancosPage() {
  return (
    <MarcoPagina
      titulo="Bancos"
      subtitulo="La lista de bancos que se elige en Contratistas y en Terceros. Agrega bancos nuevos, corrige el nombre o desactiva los que ya no se usan."
    >
      <BancosAdminView />
    </MarcoPagina>
  )
}
