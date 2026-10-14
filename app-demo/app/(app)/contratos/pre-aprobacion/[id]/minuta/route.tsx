import path from "path"
import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createClient } from "@/lib/supabase/server"
import { requerirAlgunaPestana } from "@/lib/permisos"
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
import { limpiarMinutaVehiculo, mezclarMinutaVehiculo, minutaVehiculoVacia, nombreArchivoMinutaVehiculo } from "@/lib/minuta-vehiculo"
import { MinutaVehiculoPDF } from "@/components/minuta-vehiculo-pdf"
import { limpiarMinutaServicios, mezclarMinutaServicios, minutaServiciosVacia, nombreArchivoMinutaServicios } from "@/lib/minuta-servicios"
import { MinutaServiciosPDF } from "@/components/minuta-servicios-pdf"
import { limpiarMinutaObra, mezclarMinutaObra, minutaObraVacia, nombreArchivoMinutaObra } from "@/lib/minuta-obra"
import { MinutaObraPDF } from "@/components/minuta-obra-pdf"
import { buscarMarcaEnPdf } from "@/lib/minuta-pdf-foco"
import { ContratoGeneralPDF } from "@/components/contrato-general-pdf"
import {
  SELECT_HOJA_CONTRATO_GENERAL,
  armarHojaContratoGeneral,
  nombreArchivoContratoGeneral,
  type FilaHojaContratoGeneral,
} from "@/lib/contrato-general-hoja"

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
    // Jurídica (Pre-aprobación) y Subgerencia (Aprobación de minutas).
    await requerirAlgunaPestana(["contratos.preaprobacion", "contratos.aprobar_minutas"])
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sin permiso." }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: contrato, error } = await supabase.from("contratos").select("numero, tipo, clase").eq("id", id).maybeSingle()
  if (error || !contrato) {
    return NextResponse.json({ error: "La solicitud no existe o no tienes acceso." }, { status: 404 })
  }

  // Contrato general: no hay minuta editable; la hoja sale de la base (el
  // cuerpo de la petición no se usa).
  if (contrato.clase === "general") {
    const { data: fila, error: errorFila } = await supabase
      .from("contratos")
      .select(SELECT_HOJA_CONTRATO_GENERAL)
      .eq("id", id)
      .maybeSingle()
      .overrideTypes<FilaHojaContratoGeneral, { merge: false }>()
    if (errorFila || !fila) {
      return NextResponse.json({ error: "El contrato no existe o no tienes acceso." }, { status: 404 })
    }
    const hoja = armarHojaContratoGeneral(fila, new Date())
    const pdf = await renderToBuffer(<ContratoGeneralPDF hoja={hoja} logo={LOGO_CONYCA_PATH} />)
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${nombreArchivoContratoGeneral(hoja.numero, hoja.contratista.nombre)}"`,
        "Cache-Control": "no-store",
      },
    })
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
  // Campo que se está editando (solo la vista previa lo manda): sale resaltado
  // y se devuelve en qué página quedó para que el visor abra ahí.
  const focoCrudo = (cuerpo as { foco?: unknown })?.foco
  const foco = typeof focoCrudo === "string" && /^[A-Za-z]+(:\d{1,3})?$/.test(focoCrudo) ? focoCrudo : undefined
  const numero = Number(contrato.numero)

  let buffer: Buffer
  let archivo: string
  if (contrato.tipo === "mano_obra") {
    const minuta = limpiarMinuta(mezclarMinuta(minutaVacia(), datos))
    buffer = await renderToBuffer(<MinutaManoObraPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} />)
    archivo = nombreArchivoMinuta(numero, minuta.contratistaNombre)
  } else if (contrato.tipo === "arrendamiento") {
    const minuta = limpiarMinutaArrendamiento(mezclarMinutaArrendamiento(minutaArrendamientoVacia(), datos))
    buffer = await renderToBuffer(<MinutaArrendamientoPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} />)
    archivo = nombreArchivoMinutaArrendamiento(numero, minuta.arrendadorNombre)
  } else if (contrato.tipo === "suministro_instalacion") {
    const minuta = limpiarMinutaSuministro(mezclarMinutaSuministro(minutaSuministroVacia(), datos))
    buffer = await renderToBuffer(<MinutaSuministroPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} />)
    archivo = nombreArchivoMinutaSuministro(numero, minuta.contratistaNombre)
  } else if (contrato.tipo === "alquiler_vehiculo") {
    const minuta = limpiarMinutaVehiculo(mezclarMinutaVehiculo(minutaVehiculoVacia(), datos))
    buffer = await renderToBuffer(<MinutaVehiculoPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} />)
    archivo = nombreArchivoMinutaVehiculo(numero, minuta.contratistaNombre)
  } else if (contrato.tipo === "prestacion_servicios") {
    const minuta = limpiarMinutaServicios(mezclarMinutaServicios(minutaServiciosVacia(), datos))
    buffer = await renderToBuffer(<MinutaServiciosPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} />)
    archivo = nombreArchivoMinutaServicios(numero, minuta.contratistaNombre)
  } else if (contrato.tipo === "obra") {
    const minuta = limpiarMinutaObra(mezclarMinutaObra(minutaObraVacia(), datos))
    buffer = await renderToBuffer(<MinutaObraPDF minuta={minuta} numero={numero} logo={LOGO_CONYCA_PATH} foco={foco} />)
    archivo = nombreArchivoMinutaObra(numero, minuta.contratistaNombre)
  } else {
    return NextResponse.json({ error: "Este tipo de contrato todavía no tiene plantilla de minuta." }, { status: 400 })
  }

  const marca = foco ? buscarMarcaEnPdf(buffer) : null
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      ...(marca ? { "X-Minuta-Pagina": String(marca.pagina), ...(marca.altura !== null ? { "X-Minuta-Altura": String(Math.round(marca.altura)) } : {}) } : {}),
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${archivo}"`,
      "Cache-Control": "no-store",
    },
  })
}
