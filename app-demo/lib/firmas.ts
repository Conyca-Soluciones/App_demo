import { formatearFechaHora } from "@/lib/fechas"

// ---------------------------------------------------------------------------
// Firmas electrónicas, fase 1 (20261129000000_firmas.sql). Cada usuario
// registra su firma (dibujada o foto con el fondo limpio); al aprobar un
// documento la base copia la firma de cada firmante en documento_firmas y el
// PDF aprobado se congela en storage con su SHA-256.
// Aquí: tipos, textos y la limpieza de la imagen (funciones puras, sin DOM,
// para poder probarlas).
// ---------------------------------------------------------------------------

export type EntidadFirmada = "acta" | "poliza" | "orden_compra" | "contrato"
export type PapelFirma = "elaboro" | "aprobo" | "juridica" | "representante_legal"

export type FirmaDocumento = {
  papel: PapelFirma
  nombre: string
  cargo: string | null
  imagen: string | null // data URL PNG; null = el firmante no tenía firma registrada
  codigo: string
  firmadoAt: string
}

export type DocumentoCongelado = { ruta: string; sha256: string; createdAt: string }

export type FirmasDeDocumento = { firmas: FirmaDocumento[]; congelado: DocumentoCongelado | null }

export const ETIQUETA_PAPEL: Record<PapelFirma, string> = {
  elaboro: "Elaboró",
  aprobo: "Aprobó",
  juridica: "Aprobó (Jurídica)",
  representante_legal: "Representante legal",
}

// El pendiente "Registra tu firma" (mi_firma, 20261130000000) no es una
// página: su url abre el diálogo de Mi firma de la barra de arriba. Al guardar
// la firma se avisa para que la bandeja y el número del menú se actualicen.
export const URL_MI_FIRMA = "#mi-firma"
export const EVENTO_ABRIR_MI_FIRMA = "conyca:abrir-mi-firma"
export const EVENTO_FIRMA_GUARDADA = "conyca:firma-guardada"

// Firma PNG en data URL: tope de la base (300.000 caracteres).
export const MAXIMO_CARACTERES_FIRMA = 300_000
// Tamaño final de la firma guardada (se recorta al trazo y se escala).
export const ANCHO_MAXIMO_FIRMA = 600
export const ALTO_MAXIMO_FIRMA = 240

const PAPELES: PapelFirma[] = ["elaboro", "aprobo", "juridica", "representante_legal"]

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapFirmasDeDocumento(raw: any): FirmasDeDocumento {
  const firmas: FirmaDocumento[] = (Array.isArray(raw?.firmas) ? raw.firmas : [])
    .filter((f: any) => PAPELES.includes(f?.papel))
    .map((f: any) => ({
      papel: f.papel,
      nombre: String(f.nombre ?? ""),
      cargo: f.cargo ?? null,
      imagen: typeof f.imagen === "string" && f.imagen.startsWith("data:image/png;base64,") ? f.imagen : null,
      codigo: String(f.codigo ?? ""),
      firmadoAt: String(f.firmado_at ?? ""),
    }))
  const c = raw?.congelado
  return {
    firmas,
    congelado: c && typeof c.ruta === "string" && typeof c.sha256 === "string" ? { ruta: c.ruta, sha256: c.sha256, createdAt: String(c.created_at ?? "") } : null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function firmaDe(firmas: FirmaDocumento[], papel: PapelFirma): FirmaDocumento | null {
  return firmas.find((f) => f.papel === papel) ?? null
}

// "A1B2C3D4E5F6" -> "A1B2-C3D4-E5F6"
export function formatearCodigo(codigo: string): string {
  return (codigo.toUpperCase().match(/.{1,4}/g) ?? []).join("-")
}

// Leyenda bajo la firma en el PDF.
export function textoFirmado(f: FirmaDocumento): string {
  return `Firmado electrónicamente el ${formatearFechaHora(f.firmadoAt)} · Código ${formatearCodigo(f.codigo)}`
}

// La firma de quien aprueba: con ella el documento queda firmado y su código
// es la versión del PDF congelado (una OC desaprobada y vuelta a aprobar
// renueva el código y se congela otra vez).
export function firmaPrincipal(entidad: EntidadFirmada, firmas: FirmaDocumento[]): FirmaDocumento | null {
  return firmaDe(firmas, entidad === "poliza" ? "juridica" : entidad === "contrato" ? "representante_legal" : "aprobo")
}

// ¿El documento se aprobó con firmas (desde esta fase)? Solo esos se congelan:
// un acta aprobada antes no tiene firmas y su PDF sigue saliendo como antes.
export function documentoFirmado(entidad: EntidadFirmada, firmas: FirmaDocumento[]): boolean {
  return firmaPrincipal(entidad, firmas) !== null
}

// ---------------------------------------------------------------- limpieza de la imagen
// Luminancia 0-255 de un pixel RGBA (fondo transparente = blanco).
function luminancia(d: Uint8ClampedArray, i: number): number {
  const a = d[i + 3] / 255
  const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
  return l * a + 255 * (1 - a)
}

// Umbral de Otsu sobre el histograma de luminancia: separa la tinta del papel
// aunque la foto tenga sombra o el papel no sea blanco.
export function umbralOtsu(d: Uint8ClampedArray): number {
  const hist = new Array<number>(256).fill(0)
  const n = d.length / 4
  for (let i = 0; i < d.length; i += 4) hist[Math.round(luminancia(d, i))]++
  let suma = 0
  for (let t = 0; t < 256; t++) suma += t * hist[t]
  let sumaB = 0
  let pesoB = 0
  let mejor = 0
  let desde = 128
  let hasta = 128
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t]
    if (pesoB === 0) continue
    const pesoF = n - pesoB
    if (pesoF === 0) break
    sumaB += t * hist[t]
    const mB = sumaB / pesoB
    const mF = (suma - sumaB) / pesoF
    const entre = pesoB * pesoF * (mB - mF) * (mB - mF)
    if (entre > mejor) {
      mejor = entre
      desde = t
      hasta = t
    } else if (entre === mejor) {
      hasta = t
    }
  }
  // Entre la tinta y el papel suele haber niveles vacíos con el mismo valor:
  // el punto medio deja la tinta lejos del corte.
  return Math.round((desde + hasta) / 2)
}

export type Recorte = { x: number; y: number; ancho: number; alto: number }

// Deja la tinta en azul oscuro y el resto transparente (en el mismo arreglo).
// `ajuste` (-60 a 60) corre el umbral: más alto = toma trazos más claros.
// Devuelve el rectángulo que encierra la tinta, o null si no hay tinta.
export function limpiarFondoFirma(d: Uint8ClampedArray, ancho: number, alto: number, ajuste = 0): Recorte | null {
  const umbral = Math.min(250, Math.max(5, umbralOtsu(d) + ajuste))
  // Borde suave: entre umbral y umbral - 40 la tinta va ganando opacidad.
  const suave = 40
  let minX = ancho
  let minY = alto
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4
      const l = luminancia(d, i)
      const alfa = l >= umbral ? 0 : Math.min(255, Math.round(((umbral - l) / suave) * 255))
      d[i] = 20
      d[i + 1] = 33
      d[i + 2] = 90
      d[i + 3] = alfa
      if (alfa > 64) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return conMargen({ x: minX, y: minY, ancho: maxX - minX + 1, alto: maxY - minY + 1 }, ancho, alto)
}

// Rectángulo de los pixeles con tinta (alfa) de un dibujo hecho en pantalla.
export function recorteDeTrazo(d: Uint8ClampedArray, ancho: number, alto: number): Recorte | null {
  let minX = ancho
  let minY = alto
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (d[(y * ancho + x) * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return conMargen({ x: minX, y: minY, ancho: maxX - minX + 1, alto: maxY - minY + 1 }, ancho, alto)
}

function conMargen(r: Recorte, ancho: number, alto: number, margen = 6): Recorte {
  const x = Math.max(0, r.x - margen)
  const y = Math.max(0, r.y - margen)
  return { x, y, ancho: Math.min(ancho, r.x + r.ancho + margen) - x, alto: Math.min(alto, r.y + r.alto + margen) - y }
}

// Escala para que el recorte quepa en el tamaño final (nunca agranda).
export function escalaFirma(ancho: number, alto: number): number {
  return Math.min(1, ANCHO_MAXIMO_FIRMA / ancho, ALTO_MAXIMO_FIRMA / alto)
}

// Una firma con muy poca tinta es casi seguro un clic o un punto.
export function firmaMuyPequena(r: Recorte): boolean {
  return r.ancho < 40 && r.alto < 40
}
