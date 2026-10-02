import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { limpiarMinuta, mezclarMinuta, minutaVacia, nombreArchivoMinuta } from "@/lib/minuta-mano-obra"
import { MinutaManoObraPDF } from "@/components/minuta-mano-obra-pdf"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

const LOGO_CONYCA_PATH = path.join(process.cwd(), "public", "logo-conyca.png")

// PDF de la minuta con lo que está en pantalla (POST con la minuta en el
// cuerpo): así la vista previa y la descarga reflejan cambios aún sin
// guardar. Quien no tenga la pestaña o no vea el contrato recibe 403/404.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await requerirPestana("contratos.preaprobacion")
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sin permiso." }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: contrato, error } = await supabase.from("contratos").select("numero").eq("id", id).maybeSingle()
  if (error || !contrato) {
    return NextResponse.json({ error: "La solicitud no existe o no tienes acceso." }, { status: 404 })
  }

  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return NextResponse.json({ error: "La minuta no es válida." }, { status: 400 })
  }
  const minuta = limpiarMinuta(mezclarMinuta(minutaVacia(), (cuerpo as { minuta?: unknown })?.minuta))
  const numero = Number(contrato.numero)

  const buffer = await renderToBuffer(<MinutaManoObraPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} />)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombreArchivoMinuta(numero, minuta.contratistaNombre)}"`,
      "Cache-Control": "no-store",
    },
  })
}
