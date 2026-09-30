import { SalidasView } from "@/components/salidas-view"
import { EncabezadoPagina } from "@/components/encabezado-pagina"

export default function SalidasPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina
        titulo="Salidas"
        subtitulo="Saca insumos de la bodega hacia obra. Solo puedes sacar lo que hay en el inventario."
        conProyecto
      />
      <div className="min-h-0 flex-1 p-4 sm:p-6">
        <SalidasView />
      </div>
    </div>
  )
}
