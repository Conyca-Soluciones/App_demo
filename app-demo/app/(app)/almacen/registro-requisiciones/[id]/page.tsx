import { RequisicionDetalleView } from "@/components/requisicion-detalle-view"
import { SidebarTrigger } from "@/components/ui/sidebar"

export default async function RequisicionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <SidebarTrigger />
      <div className="min-h-0 flex-1">
        <RequisicionDetalleView requisicionId={id} />
      </div>
    </div>
  )
}
