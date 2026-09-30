import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { obtenerOrdenCompraDetalle } from "@/app/(app)/almacen/comprar-pedidos/actions"
import { OrdenCompraPDF } from "@/components/orden-compra-pdf"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let orden
  try {
    orden = await obtenerOrdenCompraDetalle(id)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo cargar la orden." },
      { status: 404 }
    )
  }

  if (orden.estado !== "aprobada") {
    return NextResponse.json(
      { error: "Solo se puede descargar el PDF de una orden ya aprobada." },
      { status: 403 }
    )
  }

    const buffer = await renderToBuffer(<OrdenCompraPDF orden={orden} />)

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="orden-compra-${orden.numero}.pdf"`,
    },
  })
}