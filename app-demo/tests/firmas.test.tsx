import { describe, expect, it } from "vitest"
import path from "path"
import { renderToBuffer } from "@react-pdf/renderer"
import {
  documentoFirmado,
  escalaFirma,
  firmaDe,
  firmaMuyPequena,
  formatearCodigo,
  limpiarFondoFirma,
  mapFirmasDeDocumento,
  recorteDeTrazo,
  textoFirmado,
  umbralOtsu,
} from "@/lib/firmas"
import { ActaPDF } from "@/components/acta-pdf"
import { ActaPolizaPDF } from "@/components/acta-poliza-pdf"
import { OrdenCompraPDF } from "@/components/orden-compra-pdf"
import type { OrdenCompraDetalle } from "@/app/(app)/almacen/comprar-pedidos/actions"
import { actaPolizaPorDefecto, mapDatosActaPoliza } from "@/lib/acta-poliza"
import type { ActaDetalle } from "@/lib/actas"

// PNG de 1x1 válido.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
const LOGO = path.join(process.cwd(), "public", "logo-conyca.png")

// Foto falsa: papel gris claro (con algo de ruido) y un trazo oscuro en (30..69, 20..24).
function foto(ancho = 100, alto = 50) {
  const d = new Uint8ClampedArray(ancho * alto * 4)
  for (let y = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 4
      const tinta = x >= 30 && x < 70 && y >= 20 && y < 25
      const v = tinta ? 40 : 215 + ((x * 7 + y * 13) % 20)
      d[i] = v
      d[i + 1] = v
      d[i + 2] = v + (tinta ? 30 : 0)
      d[i + 3] = 255
    }
  return d
}

const crudo = {
  firmas: [
    { papel: "elaboro", nombre: "Dir Uno", cargo: "Director de obra", imagen: PNG, codigo: "A1B2C3D4E5F6", firmado_at: "2026-10-21T20:15:00Z" },
    { papel: "aprobo", nombre: "AyF Tres", cargo: null, imagen: null, codigo: "FFFF0000AAAA", firmado_at: "2026-10-21T21:00:00Z" },
    { papel: "otro", nombre: "x" },
  ],
  congelado: { ruta: "acta/1.pdf", sha256: "a".repeat(64), created_at: "2026-10-21T21:01:00Z" },
}

describe("firmas", () => {
  it("lee las firmas del documento y descarta lo que no es válido", () => {
    const f = mapFirmasDeDocumento(crudo)
    expect(f.firmas).toHaveLength(2)
    expect(firmaDe(f.firmas, "elaboro")?.imagen).toBe(PNG)
    expect(firmaDe(f.firmas, "aprobo")?.imagen).toBeNull()
    expect(firmaDe(f.firmas, "juridica")).toBeNull()
    expect(f.congelado?.sha256).toBe("a".repeat(64))
    expect(mapFirmasDeDocumento(null)).toEqual({ firmas: [], congelado: null })
    expect(mapFirmasDeDocumento({ firmas: [{ ...crudo.firmas[0], imagen: "data:image/svg+xml;base64,xx" }] }).firmas[0].imagen).toBeNull()
  })
  it("solo se congela lo aprobado con firmas de esta fase", () => {
    const { firmas } = mapFirmasDeDocumento(crudo)
    expect(documentoFirmado("acta", firmas)).toBe(true)
    expect(documentoFirmado("poliza", firmas)).toBe(false)
    expect(documentoFirmado("acta", [])).toBe(false)
  })
  it("código y leyenda", () => {
    expect(formatearCodigo("a1b2c3d4e5f6")).toBe("A1B2-C3D4-E5F6")
    const t = textoFirmado(mapFirmasDeDocumento(crudo).firmas[0])
    expect(t).toMatch(/^Firmado electrónicamente el 21\/10\/2026/)
    expect(t).toMatch(/3:15/) // hora de Colombia
    expect(t).toMatch(/A1B2-C3D4-E5F6$/)
  })
  it("limpia el fondo de la foto: el papel queda transparente y recorta al trazo", () => {
    const d = foto()
    const u = umbralOtsu(d)
    expect(u).toBeGreaterThan(40)
    expect(u).toBeLessThan(215)
    const r = limpiarFondoFirma(d, 100, 50)!
    expect(r).toEqual({ x: 24, y: 14, ancho: 52, alto: 17 }) // trazo + margen de 6
    expect(d[(10 * 100 + 10) * 4 + 3]).toBe(0) // papel
    expect(d[(22 * 100 + 50) * 4 + 3]).toBe(255) // tinta
    expect(firmaMuyPequena(r)).toBe(false)
  })
  it("una hoja en blanco no tiene firma", () => {
    const d = new Uint8ClampedArray(20 * 20 * 4).fill(255)
    expect(limpiarFondoFirma(d, 20, 20)).toBeNull()
    expect(recorteDeTrazo(new Uint8ClampedArray(20 * 20 * 4), 20, 20)).toBeNull()
  })
  it("recorta el dibujo y nunca agranda", () => {
    const d = new Uint8ClampedArray(200 * 100 * 4)
    d[(50 * 200 + 100) * 4 + 3] = 255
    expect(recorteDeTrazo(d, 200, 100)).toEqual({ x: 94, y: 44, ancho: 13, alto: 13 })
    expect(escalaFirma(300, 100)).toBe(1)
    expect(escalaFirma(1200, 200)).toBe(0.5)
    expect(escalaFirma(600, 480)).toBe(0.5)
  })
})

const acta: ActaDetalle = {
  id: "a1", numero: 1, tipo: "parcial", estado: "aprobada", periodoDesde: null, periodoHasta: null, observaciones: null,
  porcentajeAvance: 10, valorBruto: 1_000_000, amortizacion: 0, retencion: 0, devolucionRetencion: 0, otrosDescuentos: 0,
  neto: 1_000_000, anticipoPorcentaje: null, retencionPorcentaje: null, createdAt: "2026-10-21T15:00:00Z",
  creadoPorNombre: "Dir Uno", resueltoAt: "2026-10-21T21:00:00Z", resueltoPorNombre: "AyF Tres", motivoResolucion: null,
  editadaAt: null, editadaPorNombre: null, esMio: false, contratoId: "c1", numeroContrato: "CJ-14-2026", contratoValor: 10_000_000,
  objeto: "Obra", tipoContrato: "obra", anexoTipo: "valor_global", proyectoCodigo: "P1", proyectoNombre: "Proyecto",
  proyectoCiudad: null, empresaNombre: null, empresaNit: null, contratistaId: "k1", contratistaNombre: "Contratista SAS",
  contratistaTipoPersona: "juridica", contratistaDocumento: "NIT 900", contratistaRepresentante: "Rep Legal", otrasActas: 0,
  avanceAnterior: 0, actividades: [], descuentos: [], soportes: [], pago: null, lineasAnteriores: [],
}

describe("PDF con firmas", () => {
  it("acta de obra con firma (y sin imagen para quien no la registró)", async () => {
    const { firmas } = mapFirmasDeDocumento(crudo)
    const pdf = await renderToBuffer(<ActaPDF acta={acta} logo={LOGO} firmas={firmas} />)
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
  })
  it("acta de póliza con la firma de Jurídica", async () => {
    const d = mapDatosActaPoliza({
      id: "p1", contrato_id: "c1", estado: "aprobada", nombre_archivo: "p.pdf", usuario_nombre: "Ana",
      contrato: { id: "c1", numero: 14, numero_contrato: "CJ-14-2026", clase: "grupo", tipo: "obra", objeto: "Obra", valor: 1, contratista: { nombre: "K", documento: "NIT 1" } },
    })
    const firma = { papel: "juridica" as const, nombre: "Ana", cargo: "Legal", imagen: PNG, codigo: "ABCDABCDABCD", firmadoAt: "2026-10-21T21:00:00Z" }
    const pdf = await renderToBuffer(<ActaPolizaPDF acta={actaPolizaPorDefecto(d, "2026-10-21")} logo={LOGO} firma={firma} />)
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
  })
})

describe("orden de compra firmada", () => {
  it("genera el PDF con las firmas de quien elaboró y aprobó", async () => {
    const { firmas } = mapFirmasDeDocumento(crudo)
    const orden = {
      id: "o1", numero: 50, estado: "aprobada", estadoEntrega: "pendiente", estadoVisible: "aprobada",
      proyectoCodigo: "P1", proyectoNombre: "Proyecto", proyectoCiudad: null, empresaNombre: null, empresaNit: null,
      empresaLogoUrl: null, proveedorNombre: "Proveedor", proveedorNit: null, proveedorDireccion: null, proveedorCiudad: null,
      proveedorTelefono: null, proveedorEmail: null, proveedorContacto: null, sitioEntrega: null, fechaEntrega: null,
      contactoNombre: null, telefono: null, ciudad: null, email: null, condicionesPago: null, observaciones: null,
      creadaPorNombre: "Dir Uno", creadaPorId: null, createdAt: "2026-10-21T15:00:00Z", aprobadaPorNombre: "AyF Tres",
      aprobadaAt: "2026-10-21T16:00:00Z", motivoRechazo: null, motivoDesaprobacion: null, motivoCancelacion: null,
      canceladaAt: null, anticipoPorcentaje: null, saldoModo: null, saldoFecha: null, lineas: [],
    } as unknown as OrdenCompraDetalle
    const pdf = await renderToBuffer(<OrdenCompraPDF orden={orden} firmas={firmas} />)
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
  })
})

describe("pendiente de registrar la firma", () => {
  it("sale como grupo propio y su url abre el diálogo (no es una página)", async () => {
    const { mapGrupos, defGrupo } = await import("@/lib/pendientes")
    const { URL_MI_FIRMA } = await import("@/lib/firmas")
    const g = mapGrupos([
      { tipo: "req_por_aprobar", categoria: "hacer", total: 1, monto_total: null, vencidos: 0, mas_antiguo: null, items: [] },
      { tipo: "mi_firma", categoria: "hacer", total: 1, monto_total: null, vencidos: 0, mas_antiguo: null,
        items: [{ id: "u1", proyecto_id: null, proyecto: null, titulo: "Registra tu firma", detalle: null, monto: null, desde: null, de_quien: null, vence: null, vencido: false, url: "#mi-firma" }] },
    ])
    expect(g[0].tipo).toBe("mi_firma")
    expect(g[0].items[0].url).toBe(URL_MI_FIRMA)
    expect(defGrupo("mi_firma").accion).toBe("Registrar")
    expect(defGrupo("poliza_por_revisar").titulo).toBe("Pólizas por revisar")
  })
})
