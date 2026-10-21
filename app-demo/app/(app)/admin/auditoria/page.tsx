import { AuditoriaView } from "@/components/auditoria-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default function AuditoriaPage() {
  return (
    <MarcoPagina
      titulo="Auditoría"
      subtitulo="Quién hizo qué y cuándo en toda la plataforma: compras, contratos, pagos, terceros, almacén, presupuestos, roles y usuarios."
    >
      <AuditoriaView />
    </MarcoPagina>
  )
}
