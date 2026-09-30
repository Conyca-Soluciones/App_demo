import { SalidasView } from "@/components/salidas-view"
import { SidebarTrigger } from "@/components/ui/sidebar"

export default function SalidasPage() {
  return (
    <div className="h-full p-6">
      <SidebarTrigger />
      <SalidasView />
    </div>
  )
}