import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createClient } from "@/lib/supabase/server"
import { requerirAlgunaPestana } from "@/lib/permisos"
import { hoyColombia } from "@/lib/fechas"
import { buscarMarcaEnPdf } from "@/lib/minuta-pdf-foco"
import { PESTANAS_VER_OTROSI } from "@/lib/otrosi"
import { actaPolizaPorDefecto, mapDatosActaPoliza, mezclarActaPoliza, nombreArchivoActaPoliza } from "@/lib/acta-poliza"
import { ActaPolizaPDF } from "@/components/acta-poliza-pdf"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

const MAXIMO_BYTES = 200_000
const LOGO_CONYCA_PATH = path.join(process.cwd(), "public", "logo-conyca.png")

// PDF del acta de aprobación de la póliza. Con `minuta` en el cuerpo (Jurídica
// llenándola) sale lo que está en pantalla, aún sin guardar; eso solo cuenta
// mientras la póliza está por revisar. Después sale siempre el acta guardada.
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

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("datos_acta_poliza", { p_id: id })
  if (error || !data) return NextResponse.json({ error: error?.message ?? "La póliza no existe o no tienes acceso." }, { status: 404 })
  const d = mapDatosActaPoliza(data as Record<string, unknown>)
  const base = mezclarActaPoliza(actaPolizaPorDefecto(d, hoyColombia()), d.actaDatos)
  const editable = d.poliza.estado === "por_revisar"
  const acta = { ...(editable ? mezclarActaPoliza(base, cuerpo.minuta) : base), numeroContrato: d.contrato.numeroContrato }
  const foco = typeof cuerpo.foco === "string" && /^[A-Za-z]+(:\d{1,3})?$/.test(cuerpo.foco) ? cuerpo.foco : undefined

  const pdf = await renderToBuffer(<ActaPolizaPDF acta={acta} logo={LOGO_CONYCA_PATH} foco={foco} borrador={d.poliza.estado !== "aprobada"} />)
  const marca = foco ? buscarMarcaEnPdf(pdf) : null
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombreArchivoActaPoliza(d.contrato.numeroContrato)}"`,
      "Cache-Control": "no-store",
      ...(marca ? { "X-Minuta-Pagina": String(marca.pagina), ...(marca.altura !== null ? { "X-Minuta-Altura": String(Math.round(marca.altura)) } : {}) } : {}),
    },
  })
}
