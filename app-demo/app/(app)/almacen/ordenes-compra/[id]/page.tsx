import { OrdenCompraDetalleView } from "@/components/orden-compra-detalle-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default async function OrdenCompraDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <MarcoPagina titulo="Detalle de orden de compra">
      <OrdenCompraDetalleView ordenId={id} />
    </MarcoPagina>
  )
}
