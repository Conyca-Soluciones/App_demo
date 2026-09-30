import { EntradasView } from "@/components/entradas-view"
import { SidebarTrigger } from "@/components/ui/sidebar"

export default function EntradasPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      <SidebarTrigger />
      <div className="min-h-0 flex-1">
        <EntradasView />
      </div>
    </div>
  )
}
