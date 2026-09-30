import { GenerarOCView } from "@/components/generar-oc-view"
import { SidebarTrigger } from "@/components/ui/sidebar"

export default function GenerarOCPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <SidebarTrigger />
      <div className="min-h-0 flex-1">
        <GenerarOCView />
      </div>
    </div>
  )
}