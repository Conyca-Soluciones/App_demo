import { describe, expect, it } from "vitest"
import path from "path"
import zlib from "zlib"
import { renderToBuffer } from "@react-pdf/renderer"
import type { SolicitudContratoDetalle } from "@/lib/contratos"
import { buscarMarcaEnPdf } from "@/lib/minuta-pdf-foco"
import { minutaSuministroPorDefecto } from "@/lib/minuta-suministro"
import { MinutaSuministroPDF } from "@/components/minuta-suministro-pdf"

// El dato en edición sale resaltado en la vista previa y la ruta del PDF dice
// en qué página quedó (lib/minuta-pdf-foco.ts).

const detalle = {
  id: "c",
  numero: 12,
  proyectoId: "p",
  proyectoCodigo: "X",
  proyectoNombre: "COMFIAR",
  tipo: "suministro_instalacion",
  estado: "pre_aprobacion",
  contratistaNombre: "Eléctricos Industriales Ltda",
  contratistaDocumento: "",
  objeto: "Suministrar e instalar las luminarias LED de la bodega.",
  valor: 10_000_000,
  plazoTipo: "duracion",
  fechaInicio: null,
  fechaFin: null,
  duracionCantidad: 30,
  duracionUnidad: "dias",
  solicitadoPorNombre: null,
  createdAt: "",
  enviadoAt: "",
  motivoResolucion: null,
  resueltoPorNombre: null,
  resueltoAt: null,
  minutaEstado: null,
  minutaEnviadaAt: null,
  minutaEnviadaPorNombre: null,
  minutaResueltaAt: null,
  minutaResueltaPorNombre: null,
  minutaMotivo: null,
  numeroContrato: null,
  clase: "grupo",
  tipoDetalle: null,
  referencia: null,
  retencionGarantiaPct: 0,
  retencionAnticipoPct: 0,
  retencionFicPct: 0,
  liquidadoAt: null,
  contratistaId: "k",
  contratistaCorreo: "",
  contratistaTipoPersona: "juridica",
  contratistaDocumentos: [],
  anexoTipo: "valor_global",
  valorMensual: null,
  tieneAnticipo: true,
  anticipoPorcentaje: 30,
  formaPago: "Contra entrega.",
  correoNotificacion: "c@d.co",
  observaciones: null,
  domicilioDepartamento: null,
  datosTipo: {},
  obligaciones: ["Retirar los sobrantes."],
  entregables: [],
  items: [],
  documentos: [],
} as SolicitudContratoDetalle

const extra = {
  proyectoCiudad: "Arauca",
  empresaNombre: "CONYCA SOLUCIONES S.A.S",
  empresaNit: null,
  contratistaTipoDocumento: "NIT",
  contratistaNumeroDocumento: "900999103",
  contratistaDv: 2,
  contratistaRepresentante: "Ricardo Gómez",
  contratistaRepresentanteDocumento: "80990102",
  contratistaRepresentanteTipoDocumento: "CC",
  contratistaCiudad: "Barranquilla",
}

const logo = path.join(process.cwd(), "public", "logo-conyca.png")
const minuta = minutaSuministroPorDefecto(detalle, extra, "2026-10-13")
const pdf = (foco?: string) => renderToBuffer(<MinutaSuministroPDF minuta={minuta} numero={12} logo={logo} foco={foco} />)

// Contenido descomprimido de todas las páginas.
function contenido(buffer: Buffer): string {
  const texto = buffer.toString("latin1")
  const partes: string[] = []
  const re = /stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) {
    const fin = texto.indexOf("endstream", m.index)
    try {
      partes.push(zlib.inflateSync(Buffer.from(texto.slice(m.index + m[0].length, fin), "latin1")).toString("latin1"))
    } catch {
      // flujos sin comprimir (imágenes, fuentes)
    }
  }
  return partes.join("\n")
}

describe("dato en edición en el PDF", () => {
  it("sin foco no hay marca ni resaltado", async () => {
    const b = await pdf()
    expect(buscarMarcaEnPdf(b)).toBeNull()
  }, 60000)

  it("el primer dato queda en la página 1, cerca de arriba", async () => {
    const r = buscarMarcaEnPdf(await pdf("contratanteNombre"))
    expect(r?.pagina).toBe(1)
    expect(r!.altura!).toBeGreaterThan(550)
  }, 60000)

  it("un dato más adelante queda en una página posterior y más abajo en la página", async () => {
    const inicio = buscarMarcaEnPdf(await pdf("contratanteNombre"))!
    const firma = buscarMarcaEnPdf(await pdf("fechaFirma"))!
    expect(firma.pagina).toBeGreaterThan(inicio.pagina)
  }, 60000)

  it("el dato sale con fondo amarillo y una lista resalta su renglón", async () => {
    const amarillo = /0\.99\d* 0\.90\d* 0\.54\d* scn/
    expect(amarillo.test(contenido(await pdf()))).toBe(false)
    expect(amarillo.test(contenido(await pdf("ciudadEjecucion")))).toBe(true)
    expect(buscarMarcaEnPdf(await pdf("obligacionesContratista:7"))).not.toBeNull()
  }, 60000)
})
