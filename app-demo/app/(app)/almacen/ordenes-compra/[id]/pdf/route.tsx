import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { pdfOrdenCompra, type PdfDocumento } from "@/lib/documentos-firmados"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

// PDF de una orden aprobada, con las firmas de quien la elaboró y quien la
// aprobó; firmada, sale el PDF congelado (lib/documentos-firmados.tsx).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let doc: PdfDocumento
  try {
    doc = await pdfOrdenCompra(await createClient(), id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo cargar la orden."
    const status = msg.startsWith("Solo se puede") ? 403 : msg.includes("Avisa al administrador") ? 500 : 404
    return NextResponse.json({ error: msg }, { status })
  }

  return new NextResponse(doc.pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${doc.nombre}"`,
      ...(doc.sha256 ? { "X-Documento-Sha256": doc.sha256 } : {}),
    },
  })
}
