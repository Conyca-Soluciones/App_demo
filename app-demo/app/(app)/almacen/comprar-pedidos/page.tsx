import { PedidosCompraView } from "@/components/pedidos-compras-view"
import { SidebarTrigger } from "@/components/ui/sidebar"
export default function ComprasPage() {
  return (
    
    <div className="h-full p-6">
      <SidebarTrigger/>
      <PedidosCompraView />
    </div>
  )
}