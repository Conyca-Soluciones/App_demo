import { MarcoPagina } from "@/components/encabezado-pagina"
import { CuadroSincoDetalle } from "@/components/cuadros-sinco-view"

// Un cuadro de SINCO: los pagos y su soporte (adjuntar o cambiar).
export default async function CuadroSincoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <MarcoPagina titulo="Cuadro de SINCO" subtitulo="Adjunta la factura o cuenta de cobro de cada pago." scroll>
      <CuadroSincoDetalle id={id} />
    </MarcoPagina>
  )
}
