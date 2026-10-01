import { InventarioView } from "@/components/inventario-view"
import { EncabezadoPagina } from "@/components/encabezado-pagina"

export default function InventarioPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina
        titulo="Inventario"
        subtitulo="Lo que hay en bodega: entradas menos salidas, valorado a costo promedio."
        conProyecto
      />
      <div className="min-h-0 flex-1 p-4 sm:p-6">
        <InventarioView />
      </div>
    </div>
  )
}
