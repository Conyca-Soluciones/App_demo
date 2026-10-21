import { NextResponse } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import { createClient } from "@/lib/supabase/server"
import { requerirAlgunaPestana } from "@/lib/permisos"
import { LOGO_CONYCA_PATH, pdfMinutaContrato } from "@/lib/pdf-minuta-contrato"
import { PESTANAS_VER_OTROSI } from "@/lib/otrosi"
import { ContratoGeneralPDF } from "@/components/contrato-general-pdf"
import { armarHojaContratoGeneral, nombreArchivoContratoGeneral, type FilaHojaContratoGeneral } from "@/lib/contrato-general-hoja"

// @react-pdf/renderer usa APIs de Node -- no corre en el edge runtime.
export const runtime = "nodejs"

// El contrato aprobado (su minuta guardada, o la hoja si es general), para
// verlo desde Solicitud y Aprobación de otrosí. Los datos salen de
// contrato_para_ver_otrosi (20261120000000_ver_contrato_otrosi.sql): quien pide
// el otrosí puede no tener permiso para leer `contratos`. POST, como las demás
// rutas de PDF (la vista previa del navegador las pide así); el cuerpo no se usa.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await requerirAlgunaPestana(PESTANAS_VER_OTROSI)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Sin permiso." }, { status: 403 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("contrato_para_ver_otrosi", { p_contrato_id: id })
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "El contrato no existe o no tienes acceso." }, { status: 404 })
  }
  const fila = data as FilaHojaContratoGeneral & { clase: string; minuta_datos: unknown; minuta_estado?: string | null }

  // Aprobado con la firma del representante legal: el PDF congelado.
  if (fila.minuta_estado === "aprobada" && fila.clase !== "general") try {
    const { pdfContratoFirmado } = await import("@/lib/documentos-firmados")
    const firmado = await pdfContratoFirmado(supabase, id, {
      numero: Number(fila.numero),
      numeroContrato: fila.numero_contrato ?? null,
      tipo: fila.tipo,
      clase: fila.clase,
      minutaEstado: fila.minuta_estado ?? null,
      minutaDatos: fila.minuta_datos,
    })
    if (firmado) return respuestaPdf(firmado.pdf, firmado.nombre, firmado.sha256)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo armar el contrato firmado." }, { status: 500 })
  }

  let buffer: Buffer
  let archivo: string
  if (fila.clase === "general") {
    const hoja = armarHojaContratoGeneral(fila, new Date())
    buffer = await renderToBuffer(<ContratoGeneralPDF hoja={hoja} logo={LOGO_CONYCA_PATH} />)
    archivo = nombreArchivoContratoGeneral(hoja.numero, hoja.contratista.nombre)
  } else {
    // Contratos aprobados antes de que la minuta se guardara al enviarla.
    if (!fila.minuta_datos) {
      return NextResponse.json({ error: `El contrato ${fila.numero_contrato ?? ""} no tiene la minuta guardada en el sistema.` }, { status: 404 })
    }
    const pdf = await pdfMinutaContrato(fila.tipo, Number(fila.numero), fila.minuta_datos)
    if (!pdf) return NextResponse.json({ error: "Este tipo de contrato no tiene plantilla de minuta." }, { status: 400 })
    ;({ buffer, archivo } = pdf)
  }

  return respuestaPdf(new Uint8Array(buffer), archivo, null)
}

function respuestaPdf(pdf: Uint8Array, archivo: string, sha256: string | null) {
  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${archivo}"`,
      "Cache-Control": "no-store",
      ...(sha256 ? { "X-Documento-Sha256": sha256 } : {}),
    },
  })
}
