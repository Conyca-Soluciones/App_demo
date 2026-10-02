import { RequisicionDetalleView } from "@/components/requisicion-detalle-view"
import { MarcoPagina } from "@/components/encabezado-pagina"

export default async function RequisicionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <MarcoPagina titulo="Detalle de requisición">
      <RequisicionDetalleView requisicionId={id} />
    </MarcoPagina>
  )
}
