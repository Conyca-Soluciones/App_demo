import path from "path"
import { createHash } from "crypto"
import { renderToBuffer } from "@react-pdf/renderer"
import type { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hoyColombia } from "@/lib/fechas"
import { ETIQUETA_TIPO_ACTA } from "@/lib/actas"
import { actaPolizaPorDefecto, mapDatosActaPoliza, mezclarActaPoliza, nombreArchivoActaPoliza } from "@/lib/acta-poliza"
import {
  documentoFirmado,
  firmaDe,
  firmaPrincipal,
  mapFirmasDeDocumento,
  type DocumentoCongelado,
  type EntidadFirmada,
  type FirmaDocumento,
  type FirmasDeDocumento,
} from "@/lib/firmas"
import { ActaPDF } from "@/components/acta-pdf"
import { ActaPolizaPDF } from "@/components/acta-poliza-pdf"
import { OrdenCompraPDF } from "@/components/orden-compra-pdf"
import { pdfMinutaContrato } from "@/lib/pdf-minuta-contrato"


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

// El PDF congelado; si todavía no existe para esta versión (el código de la
// firma de quien aprobó), lo genera, lo sube y lo registra. Una versión nueva
// (OC vuelta a aprobar) reemplaza el registro: la huella vieja ya no verifica.
export async function pdfCongelado(
  entidad: EntidadFirmada,
  id: string,
  version: string,
  registro: DocumentoCongelado | null,
  generar: () => Promise<Uint8Array>
): Promise<{ pdf: Uint8Array; sha256: string | null }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY no está configurada: el PDF firmado no se congela.")
    return { pdf: await generar(), sha256: null }
  }
  const ruta = `${entidad}/${id}-${version}.pdf`
  if (registro && registro.ruta === ruta) {
    const pdf = await descargar(registro.ruta)
    if (!pdf) throw new Error("No se encontró el PDF firmado guardado. Avisa al administrador.")
    const hash = sha256Hex(pdf)
    if (hash !== registro.sha256) throw new Error("El PDF firmado guardado no coincide con su huella. Avisa al administrador.")
    return { pdf, sha256: hash }
  }

  const admin = createAdminClient()
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
    .upsert({ entidad, entidad_id: id, ruta, sha256: hash, tamano: pdf.byteLength }, { onConflict: "entidad,entidad_id" })
  if (error) console.error(`No se pudo registrar ${ruta}:`, error.message)
  return { pdf, sha256: hash }
}

// Congelado si el documento está aprobado con firmas; si no, el PDF de siempre.
async function firmadoOVivo(
  entidad: EntidadFirmada,
  id: string,
  aprobado: boolean,
  { firmas, congelado: registro }: FirmasDeDocumento,
  generar: () => Promise<Uint8Array>
): Promise<{ pdf: Uint8Array; sha256: string | null }> {
  const principal: FirmaDocumento | null = aprobado ? firmaPrincipal(entidad, firmas) : null
  if (principal) return pdfCongelado(entidad, id, principal.codigo, registro, generar)
  return { pdf: await generar(), sha256: null }
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")

// ---------------------------------------------------------------- acta de obra
export async function pdfActa(supabase: Supabase, id: string): Promise<PdfDocumento> {
  const { obtenerActa } = await import("@/app/(app)/contratos/actas/actions")
  const [acta, f] = await Promise.all([obtenerActa(id), leerFirmas(supabase, "acta", id)])
  const nombre = sinTildes(`${ETIQUETA_TIPO_ACTA[acta.tipo].toLowerCase().replace(/\s+/g, "-")}-${acta.numero}-${acta.numeroContrato}.pdf`)
  const generar = async () => new Uint8Array(await renderToBuffer(<ActaPDF acta={acta} logo={LOGO_CONYCA_PATH} firmas={f.firmas} />))
  return { nombre, ...(await firmadoOVivo("acta", id, acta.estado === "aprobada", f, generar)) }
}

// ---------------------------------------------------------------- orden de compra (solo aprobada)
export async function pdfOrdenCompra(supabase: Supabase, id: string): Promise<PdfDocumento> {
  const { obtenerOrdenCompraDetalle } = await import("@/app/(app)/almacen/comprar-pedidos/actions")
  const [orden, f] = await Promise.all([obtenerOrdenCompraDetalle(id), leerFirmas(supabase, "orden_compra", id)])
  if (orden.estado !== "aprobada") throw new Error("Solo se puede descargar el PDF de una orden ya aprobada.")
  const generar = async () => new Uint8Array(await renderToBuffer(<OrdenCompraPDF orden={orden} firmas={f.firmas} />))
  return { nombre: `orden-compra-${orden.numero}.pdf`, ...(await firmadoOVivo("orden_compra", id, true, f, generar)) }
}

// ---------------------------------------------------------------- acta de aprobación de póliza
// `minuta` = lo que Jurídica tiene en pantalla sin guardar (solo cuenta con la
// póliza por revisar). Aprobada con firma, sale siempre el PDF congelado.
export async function pdfActaPoliza(supabase: Supabase, id: string, minuta?: unknown, foco?: string): Promise<PdfDocumento> {
  const [{ data, error }, f] = await Promise.all([
    supabase.rpc("datos_acta_poliza", { p_id: id }),
    leerFirmas(supabase, "poliza", id),
  ])
  if (error || !data) throw new Error(error?.message ?? "La póliza no existe o no tienes acceso.")
  const d = mapDatosActaPoliza(data as Record<string, unknown>)
  const base = mezclarActaPoliza(actaPolizaPorDefecto(d, hoyColombia()), d.actaDatos)
  const editable = d.poliza.estado === "por_revisar"
  const nombre = nombreArchivoActaPoliza(d.contrato.numeroContrato)
  const firmada = d.poliza.estado === "aprobada" && documentoFirmado("poliza", f.firmas)
  const acta = { ...(editable ? mezclarActaPoliza(base, minuta) : base), numeroContrato: d.contrato.numeroContrato }
  const generar = async () =>
    new Uint8Array(
      await renderToBuffer(
        <ActaPolizaPDF
          acta={acta}
          logo={LOGO_CONYCA_PATH}
          foco={firmada ? undefined : foco}
          borrador={d.poliza.estado !== "aprobada"}
          firma={firmaDe(f.firmas, "juridica")}
        />
      )
    )
  return { nombre, ...(await firmadoOVivo("poliza", id, firmada, f, generar)) }
}

// ---------------------------------------------------------------- contrato (minuta aprobada)
// Con la minuta aprobada y la firma del representante legal
// (20261201000000_representantes_legales.sql): el PDF congelado. null = no
// aplica (contrato general, sin aprobar o aprobado sin representantes
// registrados): la ruta lo arma como siempre. Los datos del contrato los pasa
// cada ruta (quien entra por otrosí no lee la tabla contratos).
export type ContratoParaPdf = {
  numero: number
  numeroContrato: string | null
  tipo: string
  clase: string
  minutaEstado: string | null
  minutaDatos: unknown
}

// Versión del dibujo del contrato firmado: subirla vuelve a congelar los ya
// congelados (r2: la primera versión no dibujaba la imagen de la firma).
const VERSION_PDF_CONTRATO = "r2"

export async function pdfContratoFirmado(supabase: Supabase, id: string, c: ContratoParaPdf): Promise<PdfDocumento | null> {
  if (c.clase === "general" || c.minutaEstado !== "aprobada" || !c.minutaDatos) return null
  const f = await leerFirmas(supabase, "contrato", id)
  const principal = firmaPrincipal("contrato", f.firmas)
  if (!principal) return null
  const generar = async () => {
    const r = await pdfMinutaContrato(c.tipo, c.numero, c.minutaDatos, undefined, principal)
    if (!r) throw new Error("Este tipo de contrato no tiene plantilla de minuta.")
    return new Uint8Array(r.buffer)
  }
  const nombre = sinTildes(`contrato-${c.numeroContrato ?? c.numero}.pdf`)
  return { nombre, ...(await pdfCongelado("contrato", id, `${principal.codigo}-${VERSION_PDF_CONTRATO}`, f.congelado, generar)) }
}
