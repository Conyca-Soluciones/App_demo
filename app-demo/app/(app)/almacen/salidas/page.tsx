import { SalidasPagina } from "@/components/salidas-pagina"
import { EncabezadoPagina } from "@/components/encabezado-pagina"

export default function SalidasPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina
        titulo="Salidas"
        subtitulo="Saca insumos de la bodega hacia obra, o corrige y anula las salidas ya registradas."
        conProyecto
      />
      <div className="min-h-0 flex-1 p-4 sm:p-6">
        <SalidasPagina />
      </div>
    </div>
  )
}
