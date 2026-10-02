import { PedidosCompraView } from "@/components/pedidos-compras-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default function ComprasPage() {
  return (
    <MarcoPagina
      titulo="Comprar requisiciones"
    >
      <PedidosCompraView />
    </MarcoPagina>
  )
}
