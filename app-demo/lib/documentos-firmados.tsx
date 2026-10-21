import path from "path"
import { createHash } from "crypto"
import { renderToBuffer } from "@react-pdf/renderer"
import type { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hoyColombia } from "@/lib/fechas"
import { ETIQUETA_TIPO_ACTA } from "@/lib/actas"
import { actaPolizaPorDefecto, mapDatosActaPoliza, mezclarActaPoliza, nombreArchivoActaPoliza } from "@/lib/acta-poliza"
import { documentoFirmado, firmaDe, mapFirmasDeDocumento, type DocumentoCongelado, type EntidadFirmada, type FirmasDeDocumento } from "@/lib/firmas"
import { ActaPDF } from "@/components/acta-pdf"
import { ActaPolizaPDF } from "@/components/acta-poliza-pdf"
import { obtenerActa } from "@/app/(app)/contratos/actas/actions"

// ---------------------------------------------------------------------------
// PDF de documentos firmados (SOLO servidor: usa la service role). Un
// documento aprobado con firmas se congela la primera vez que se genera: se
// guarda en el bucket privado documentos_firmados con su SHA-256
// (20261129000000_firmas.sql) y desde ahí sale siempre ese mismo archivo.
// El contenido lo arma la base con la sesión del usuario (que ya pasó los
// permisos); la service role solo guarda y lee el archivo, así que nadie
// puede registrar un PDF hecho por él.
// ---------------------------------------------------------------------------

type Supabase = Awaited<ReturnType<typeof createClient>>

const BUCKET = "documentos_firmados"
const LOGO_CONYCA_PATH = path.join(process.cwd(), "public", "logo-conyca.png")

export type PdfDocumento = { pdf: Uint8Array; nombre: string; sha256: string | null }

export const sha256Hex = (datos: Uint8Array) => createHash("sha256").update(datos).digest("hex")

// Firmas y PDF congelado del documento. Si la migración de firmas no se ha
// corrido, sale sin firmas (como antes).
export async function leerFirmas(supabase: Supabase, entidad: EntidadFirmada, id: string): Promise<FirmasDeDocumento> {
  const { data, error } = await supabase.rpc("firmas_de_documento", { p_entidad: entidad, p_id: id })
  if (error) {
    console.error(`firmas_de_documento(${entidad}, ${id}):`, error.message)
    return { firmas: [], congelado: null }
  }
  return mapFirmasDeDocumento(data)
}

async function descargar(ruta: string): Promise<Uint8Array | null> {
  const { data } = await createAdminClient().storage.from(BUCKET).download(ruta)
  return data ? new Uint8Array(await data.arrayBuffer()) : null
}

// El PDF congelado; si todavía no existe, lo genera, lo sube y lo registra.
export async function pdfCongelado(
  entidad: EntidadFirmada,
  id: string,
  registro: DocumentoCongelado | null,
  generar: () => Promise<Uint8Array>
): Promise<{ pdf: Uint8Array; sha256: string | null }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY no está configurada: el PDF firmado no se congela.")
    return { pdf: await generar(), sha256: null }
  }
  if (registro) {
    const pdf = await descargar(registro.ruta)
    if (!pdf) throw new Error("No se encontró el PDF firmado guardado. Avisa al administrador.")
    const hash = sha256Hex(pdf)
    if (hash !== registro.sha256) throw new Error("El PDF firmado guardado no coincide con su huella. Avisa al administrador.")
    return { pdf, sha256: hash }
  }

  const admin = createAdminClient()
  const ruta = `${entidad}/${id}.pdf`
  let pdf = await generar()
  const { error: errorSubir } = await admin.storage.from(BUCKET).upload(ruta, pdf, { contentType: "application/pdf", upsert: false })
  if (errorSubir) {
    // Otro pedido lo congeló al mismo tiempo: vale el que quedó guardado.
    const guardado = await descargar(ruta)
    if (!guardado) {
      console.error(`No se pudo congelar ${ruta}:`, errorSubir.message)
      return { pdf, sha256: null }
    }
    pdf = guardado
  }
  const hash = sha256Hex(pdf)
  const { error } = await admin
    .from("documentos_firmados")
    .upsert({ entidad, entidad_id: id, ruta, sha256: hash, tamano: pdf.byteLength }, { onConflict: "entidad,entidad_id", ignoreDuplicates: true })
  if (error) console.error(`No se pudo registrar ${ruta}:`, error.message)
  return { pdf, sha256: hash }
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")

// ---------------------------------------------------------------- acta de obra
export async function pdfActa(supabase: Supabase, id: string): Promise<PdfDocumento> {
  const [acta, { firmas, congelado: registro }] = await Promise.all([obtenerActa(id), leerFirmas(supabase, "acta", id)])
  const nombre = sinTildes(`${ETIQUETA_TIPO_ACTA[acta.tipo].toLowerCase().replace(/\s+/g, "-")}-${acta.numero}-${acta.numeroContrato}.pdf`)
  const generar = async () => new Uint8Array(await renderToBuffer(<ActaPDF acta={acta} logo={LOGO_CONYCA_PATH} firmas={firmas} />))
  if (acta.estado === "aprobada" && documentoFirmado("acta", firmas)) {
    return { nombre, ...(await pdfCongelado("acta", id, registro, generar)) }
  }
  return { nombre, pdf: await generar(), sha256: null }
}

// ---------------------------------------------------------------- acta de aprobación de póliza
// `minuta` = lo que Jurídica tiene en pantalla sin guardar (solo cuenta con la
// póliza por revisar). Aprobada con firma, sale siempre el PDF congelado.
export async function pdfActaPoliza(supabase: Supabase, id: string, minuta?: unknown, foco?: string): Promise<PdfDocumento> {
  const [{ data, error }, { firmas, congelado: registro }] = await Promise.all([
    supabase.rpc("datos_acta_poliza", { p_id: id }),
    leerFirmas(supabase, "poliza", id),
  ])
  if (error || !data) throw new Error(error?.message ?? "La póliza no existe o no tienes acceso.")
  const d = mapDatosActaPoliza(data as Record<string, unknown>)
  const base = mezclarActaPoliza(actaPolizaPorDefecto(d, hoyColombia()), d.actaDatos)
  const editable = d.poliza.estado === "por_revisar"
  const nombre = nombreArchivoActaPoliza(d.contrato.numeroContrato)
  const firmada = d.poliza.estado === "aprobada" && documentoFirmado("poliza", firmas)
  const acta = { ...(editable ? mezclarActaPoliza(base, minuta) : base), numeroContrato: d.contrato.numeroContrato }
  const generar = async () =>
    new Uint8Array(
      await renderToBuffer(
        <ActaPolizaPDF
          acta={acta}
          logo={LOGO_CONYCA_PATH}
          foco={firmada ? undefined : foco}
          borrador={d.poliza.estado !== "aprobada"}
          firma={firmaDe(firmas, "juridica")}
        />
      )
    )
  if (firmada) return { nombre, ...(await pdfCongelado("poliza", id, registro, generar)) }
  return { nombre, pdf: await generar(), sha256: null }
}
