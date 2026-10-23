import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requerirAlgunaPestana } from "@/lib/permisos"
import { pdfActa, type PdfDocumento } from "@/lib/documentos-firmados"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

// PDF del acta (GET). Ruta aparte de /contratos/actas para que la abran las
// dos pestañas: Actas por grupos y Aprobación de actas (lib/pestanas.ts). La
// base revisa además el acceso al proyecto (detalle_acta). Aprobada con
// firmas, sale el PDF congelado (lib/documentos-firmados.tsx).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await requerirAlgunaPestana(["contratos.cortes", "contratos.actas_generales", "contratos.aprobar_actas"])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sin permiso." }, { status: 403 })
  }

  let doc: PdfDocumento
  try {
    doc = await pdfActa(await createClient(), id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ""
    return NextResponse.json(
      { error: msg.includes("Avisa al administrador") ? msg : "El acta no existe o no tienes acceso." },
      { status: msg.includes("Avisa al administrador") ? 500 : 404 }
    )
  }
  return new NextResponse(doc.pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.nombre}"`,
      "Cache-Control": "no-store",
      ...(doc.sha256 ? { "X-Documento-Sha256": doc.sha256 } : {}),
    },
  })
}
