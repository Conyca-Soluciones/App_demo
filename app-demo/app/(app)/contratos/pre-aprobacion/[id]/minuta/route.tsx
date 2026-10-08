import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createClient } from "@/lib/supabase/server"
import { requerirPestana } from "@/lib/permisos"
import { limpiarMinuta, mezclarMinuta, minutaVacia, nombreArchivoMinuta } from "@/lib/minuta-mano-obra"
import { MinutaManoObraPDF } from "@/components/minuta-mano-obra-pdf"
import {
  limpiarMinutaArrendamiento,
  mezclarMinutaArrendamiento,
  minutaArrendamientoVacia,
  nombreArchivoMinutaArrendamiento,
} from "@/lib/minuta-arrendamiento"
import { MinutaArrendamientoPDF } from "@/components/minuta-arrendamiento-pdf"
import { limpiarMinutaSuministro, mezclarMinutaSuministro, minutaSuministroVacia, nombreArchivoMinutaSuministro } from "@/lib/minuta-suministro"
import { MinutaSuministroPDF } from "@/components/minuta-suministro-pdf"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

const MAXIMO_BYTES = 200_000
const LOGO_CONYCA_PATH = path.join(process.cwd(), "public", "logo-conyca.png")

// PDF de la minuta con lo que está en pantalla (POST con la minuta en el
// cuerpo): así la vista previa y la descarga reflejan cambios aún sin
// guardar. Quien no tenga la pestaña o no vea el contrato recibe 403/404.
// La plantilla sale del tipo guardado en la base, no de lo que mande el
// navegador.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await requerirPestana("contratos.preaprobacion")
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sin permiso." }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: contrato, error } = await supabase.from("contratos").select("numero, tipo").eq("id", id).maybeSingle()
  if (error || !contrato) {
    return NextResponse.json({ error: "La solicitud no existe o no tienes acceso." }, { status: 404 })
  }

  // Tope de tamaño (el mismo que guardar_minuta_contrato): sin él, un cuerpo
  // enorme ocuparía el servidor generando un PDF de miles de páginas.
  const texto = await req.text()
  if (texto.length > MAXIMO_BYTES) {
    return NextResponse.json({ error: "La minuta es demasiado grande." }, { status: 413 })
  }
  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    return NextResponse.json({ error: "La minuta no es válida." }, { status: 400 })
  }
  const datos = (cuerpo as { minuta?: unknown })?.minuta
  const numero = Number(contrato.numero)

  let buffer: Buffer
  let archivo: string
  if (contrato.tipo === "mano_obra") {
    const minuta = limpiarMinuta(mezclarMinuta(minutaVacia(), datos))
    buffer = await renderToBuffer(<MinutaManoObraPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} />)
    archivo = nombreArchivoMinuta(numero, minuta.contratistaNombre)
  } else if (contrato.tipo === "arrendamiento") {
    const minuta = limpiarMinutaArrendamiento(mezclarMinutaArrendamiento(minutaArrendamientoVacia(), datos))
    buffer = await renderToBuffer(<MinutaArrendamientoPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} />)
    archivo = nombreArchivoMinutaArrendamiento(numero, minuta.arrendadorNombre)
  } else if (contrato.tipo === "suministro_instalacion") {
    const minuta = limpiarMinutaSuministro(mezclarMinutaSuministro(minutaSuministroVacia(), datos))
    buffer = await renderToBuffer(<MinutaSuministroPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} />)
    archivo = nombreArchivoMinutaSuministro(numero, minuta.contratistaNombre)
  } else {
    return NextResponse.json({ error: "Este tipo de contrato todavía no tiene plantilla de minuta." }, { status: 400 })
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${archivo}"`,
      "Cache-Control": "no-store",
    },
  })
}
