import { OrdenCompraDetalleView } from "@/components/orden-compra-detalle-view"
import { SidebarTrigger } from "@/components/ui/sidebar"

export default async function OrdenCompraDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <SidebarTrigger />
      <div className="min-h-0 flex-1">
        <OrdenCompraDetalleView ordenId={id} />
      </div>
    </div>
  )
}