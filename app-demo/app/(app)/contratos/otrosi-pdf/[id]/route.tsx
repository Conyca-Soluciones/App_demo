import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createClient } from "@/lib/supabase/server"
import { requerirAlgunaPestana } from "@/lib/permisos"
import { hoyColombia } from "@/lib/fechas"
import { buscarMarcaEnPdf } from "@/lib/minuta-pdf-foco"
import { PESTANAS_VER_OTROSI, mapOtrosiDetalle, mezclarMinutaOtrosi, minutaOtrosiPorDefecto, nombreArchivoOtrosi } from "@/lib/otrosi"
import { OtrosiPDF } from "@/components/otrosi-pdf"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

const MAXIMO_BYTES = 200_000
const LOGO_CONYCA_PATH = path.join(process.cwd(), "public", "logo-conyca.png")

// PDF del otrosí. Con `minuta` en el cuerpo (Jurídica editando) sale lo que
// está en pantalla, aún sin guardar; sin ella, el documento guardado. El número
// (y el contrato) salen de la base. Ruta aparte para que la abran las dos
// pestañas (Solicitud y Aprobación de otrosí).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sin permiso." }, { status: 403 })
  }

  const texto = await req.text()
  if (texto.length > MAXIMO_BYTES) return NextResponse.json({ error: "El documento es muy grande." }, { status: 413 })
  let cuerpo: { minuta?: unknown; foco?: unknown } = {}
  try {
    cuerpo = texto ? JSON.parse(texto) : {}
  } catch {
    return NextResponse.json({ error: "Cuerpo no válido." }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("detalle_otrosi", { p_id: id })
  if (error || !data) return NextResponse.json({ error: "El otrosí no existe o no tienes acceso." }, { status: 404 })
  const detalle = mapOtrosiDetalle(data as Record<string, unknown>)
  const base = mezclarMinutaOtrosi(minutaOtrosiPorDefecto(detalle, hoyColombia()), detalle.minutaDatos)
  // Lo de pantalla solo cuenta mientras Jurídica lo puede editar; enviado o
  // aprobado, sale siempre el documento guardado.
  const editable = detalle.estado === "por_revisar" || detalle.estado === "devuelta_subgerencia"
  const minuta = { ...(editable ? mezclarMinutaOtrosi(base, cuerpo.minuta) : base), numeroContrato: detalle.numeroContrato }
  const numero = detalle.numero ?? detalle.numeroProvisional
  const foco = typeof cuerpo.foco === "string" && /^[A-Za-z]+(:\d{1,3})?$/.test(cuerpo.foco) ? cuerpo.foco : undefined

  const pdf = await renderToBuffer(<OtrosiPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} />)
  const marca = foco ? buscarMarcaEnPdf(pdf) : null
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombreArchivoOtrosi(detalle.numeroContrato, numero)}"`,
      "Cache-Control": "no-store",
      ...(marca ? { "X-Minuta-Pagina": String(marca.pagina), ...(marca.altura !== null ? { "X-Minuta-Altura": String(Math.round(marca.altura)) } : {}) } : {}),
    },
  })
}
