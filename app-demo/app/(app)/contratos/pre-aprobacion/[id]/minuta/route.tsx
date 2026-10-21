import { NextRequest, NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createClient } from "@/lib/supabase/server"
import { requerirAlgunaPestana } from "@/lib/permisos"
import { pdfMinutaContrato, LOGO_CONYCA_PATH } from "@/lib/pdf-minuta-contrato"
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
  const { data: contrato, error } = await supabase
    .from("contratos")
    .select("numero, numero_contrato, tipo, clase, minuta_estado")
    .eq("id", id)
    .maybeSingle()
  if (error || !contrato) {
    return NextResponse.json({ error: "La solicitud no existe o no tienes acceso." }, { status: 404 })
  }

  // Minuta aprobada con la firma del representante legal: el PDF congelado
  // (lo de pantalla no cuenta: la minuta ya no se edita). Solo entonces se
  // carga el módulo y se lee la minuta guardada (la vista previa de una minuta
  // en revisión no paga nada de esto).
  if (contrato.minuta_estado === "aprobada" && contrato.clase !== "general") try {
    const [{ pdfContratoFirmado }, guardada] = await Promise.all([
      import("@/lib/documentos-firmados"),
      supabase.from("contratos").select("minuta_datos").eq("id", id).maybeSingle(),
    ])
    const firmado = await pdfContratoFirmado(supabase, id, {
      numero: Number(contrato.numero),
      numeroContrato: contrato.numero_contrato ?? null,
      tipo: contrato.tipo,
      clase: contrato.clase,
      minutaEstado: contrato.minuta_estado ?? null,
      minutaDatos: guardada.data?.minuta_datos,
    })
    if (firmado) {
      return new NextResponse(firmado.pdf as BodyInit, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${firmado.nombre}"`,
          "Cache-Control": "no-store",
          ...(firmado.sha256 ? { "X-Documento-Sha256": firmado.sha256 } : {}),
        },
      })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo armar el contrato firmado." }, { status: 500 })
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

  const pdfMinuta = await pdfMinutaContrato(contrato.tipo, numero, datos, foco)
  if (!pdfMinuta) {
    return NextResponse.json({ error: "Este tipo de contrato todavía no tiene plantilla de minuta." }, { status: 400 })
  }
  const { buffer, archivo } = pdfMinuta
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
