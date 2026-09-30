import { TodasLasOrdenesView } from "@/components/todas-las-ordenes-view"
import { SidebarTrigger } from "@/components/ui/sidebar"

export default function OrdenesCompraPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <SidebarTrigger />
      <div className="min-h-0 flex-1">
        <TodasLasOrdenesView />
      </div>
    </div>
  )
}