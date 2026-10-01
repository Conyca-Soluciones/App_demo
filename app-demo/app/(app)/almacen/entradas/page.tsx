import { EntradasView } from "@/components/entradas-view"
import { EncabezadoPagina } from "@/components/encabezado-pagina"

export default function EntradasPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina
        titulo="Entradas"
        subtitulo="Consulta las órdenes de compra aprobadas del proyecto y selecciona una para registrar el material recibido en bodega."
        conProyecto
      />
      <div className="min-h-0 flex-1 p-4 sm:p-6">
        <EntradasView />
      </div>
    </div>
  )
}
