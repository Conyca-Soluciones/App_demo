import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { requerirAlgunaPestana } from "@/lib/permisos"
import { ETIQUETA_TIPO_ACTA } from "@/lib/actas"
import { ActaPDF } from "@/components/acta-pdf"
import { obtenerActa } from "@/app/(app)/contratos/actas/actions"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

const LOGO_CONYCA_PATH = path.join(process.cwd(), "public", "logo-conyca.png")

// PDF del acta (GET). Ruta aparte de /contratos/actas para que la abran las
// dos pestañas: Actas por grupos y Aprobación de actas (lib/pestanas.ts). La
// base revisa además el acceso al proyecto (detalle_acta).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await requerirAlgunaPestana(["contratos.cortes", "contratos.aprobar_actas"])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sin permiso." }, { status: 403 })
  }

  let acta
  try {
    acta = await obtenerActa(id)
  } catch {
    return NextResponse.json({ error: "El acta no existe o no tienes acceso." }, { status: 404 })
  }

  const pdf = await renderToBuffer(<ActaPDF acta={acta} logo={LOGO_CONYCA_PATH} />)
  const nombre = `${ETIQUETA_TIPO_ACTA[acta.tipo].toLowerCase().replace(/\s+/g, "-")}-${acta.numero}-${acta.numeroContrato}.pdf`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  })
}
