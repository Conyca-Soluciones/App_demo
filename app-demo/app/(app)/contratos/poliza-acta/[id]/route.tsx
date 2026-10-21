import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requerirAlgunaPestana } from "@/lib/permisos"
import { buscarMarcaEnPdf } from "@/lib/minuta-pdf-foco"
import { PESTANAS_VER_OTROSI } from "@/lib/otrosi"
import { pdfActaPoliza, type PdfDocumento } from "@/lib/documentos-firmados"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

const MAXIMO_BYTES = 200_000

// PDF del acta de aprobación de la póliza. Con `minuta` en el cuerpo (Jurídica
// llenándola) sale lo que está en pantalla, aún sin guardar; eso solo cuenta
// mientras la póliza está por revisar. Después sale siempre el acta guardada
// y, aprobada con firma, el PDF congelado (lib/documentos-firmados.tsx).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sin permiso." }, { status: 403 })
  }

  const texto = await req.text()
  if (texto.length > MAXIMO_BYTES) return NextResponse.json({ error: "El acta es muy grande." }, { status: 413 })
  let cuerpo: { minuta?: unknown; foco?: unknown } = {}
  try {
    cuerpo = texto ? JSON.parse(texto) : {}
  } catch {
    return NextResponse.json({ error: "Cuerpo no válido." }, { status: 400 })
  }

  const foco = typeof cuerpo.foco === "string" && /^[A-Za-z]+(:\d{1,3})?$/.test(cuerpo.foco) ? cuerpo.foco : undefined
  let doc: PdfDocumento
  try {
    doc = await pdfActaPoliza(await createClient(), id, cuerpo.minuta, foco)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "La póliza no existe o no tienes acceso." }, { status: 404 })
  }
  const marca = foco && !doc.sha256 ? buscarMarcaEnPdf(doc.pdf) : null
  return new NextResponse(doc.pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.nombre}"`,
      "Cache-Control": "no-store",
      ...(doc.sha256 ? { "X-Documento-Sha256": doc.sha256 } : {}),
      ...(marca ? { "X-Minuta-Pagina": String(marca.pagina), ...(marca.altura !== null ? { "X-Minuta-Altura": String(Math.round(marca.altura)) } : {}) } : {}),
    },
  })
}
