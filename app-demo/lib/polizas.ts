import { nombreTipoContrato, type ClaseContrato } from "@/lib/contratos"

// ---------------------------------------------------------------------------
// Pólizas de los contratos (supabase/migrations/20261126000000_polizas.sql).
// Cuando Subgerencia aprueba un contrato queda "Póliza pendiente"; el ingeniero
// sube el archivo ("Póliza recibida") y Jurídica la aprueba ("Póliza
// aprobada") o la devuelve con motivo (otra vez pendiente). Sin póliza
// aprobada no se hacen actas.
// ---------------------------------------------------------------------------

export type EstadoPolizaContrato = "pendiente" | "recibida" | "aprobada"
export type EstadoPoliza = "por_revisar" | "aprobada" | "devuelta"

export const ETIQUETA_POLIZA_CONTRATO: Record<EstadoPolizaContrato, string> = {
  pendiente: "Póliza pendiente",
  recibida: "Póliza recibida",
  aprobada: "Póliza aprobada",
}
export const CLASE_POLIZA_CONTRATO: Record<EstadoPolizaContrato, string> = {
  pendiente: "border-amber-300 bg-amber-50 text-amber-800",
  recibida: "border-sky-300 bg-sky-50 text-sky-800",
  aprobada: "border-emerald-300 bg-emerald-50 text-emerald-800",
}
export const ETIQUETA_ESTADO_POLIZA: Record<EstadoPoliza, string> = {
  por_revisar: "Por revisar",
  aprobada: "Aprobada",
  devuelta: "Devuelta",
}
export const CLASE_ESTADO_POLIZA: Record<EstadoPoliza, string> = {
  por_revisar: "border-sky-300 bg-sky-50 text-sky-800",
  aprobada: "border-emerald-300 bg-emerald-50 text-emerald-800",
  devuelta: "border-orange-300 bg-orange-50 text-orange-800",
}

export const esEstadoPolizaContrato = (v: unknown): v is EstadoPolizaContrato =>
  v === "pendiente" || v === "recibida" || v === "aprobada"

export type ContratistaPoliza = {
  id: string
  nombre: string
  tipoPersona: string
  documento: string
  representanteNombre: string | null
  representanteDocumento: string | null
  direccion: string | null
  telefono: string | null
  correo: string | null
  ciudad: string | null
}

export type ContratoPoliza = {
  id: string
  numero: number
  numeroContrato: string
  clase: ClaseContrato
  tipo: string
  tipoDetalle: string | null
  objeto: string
  valor: number // vigente (con otrosí)
  fechaInicio: string | null
  fechaFin: string | null // vigente
  polizaEstado: EstadoPolizaContrato | null
  aprobadoAt: string | null
  solicitadoPorNombre: string | null
  proyectoId: string
  proyectoCodigo: string | null
  proyectoNombre: string | null
  contratista: ContratistaPoliza
}

export type Poliza = {
  id: string
  contratoId: string
  estado: EstadoPoliza
  motivo: string | null
  ruta: string
  nombreArchivo: string
  tamano: number
  mime: string
  subidaPorNombre: string | null
  createdAt: string
  resueltaPorNombre: string | null
  resueltaAt: string | null
}

export type PolizaConContrato = Poliza & { contrato: ContratoPoliza }

type Fila = Record<string, unknown>
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v))
const textoONulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v))

export function mapContratoPoliza(x: Fila): ContratoPoliza {
  const k = (x.contratista ?? {}) as Fila
  return {
    id: texto(x.id),
    numero: Number(x.numero ?? 0),
    numeroContrato: texto(x.numero_contrato),
    clase: (x.clase === "general" ? "general" : "grupo") as ClaseContrato,
    tipo: texto(x.tipo),
    tipoDetalle: textoONulo(x.tipo_detalle),
    objeto: texto(x.objeto),
    valor: Number(x.valor ?? 0),
    fechaInicio: textoONulo(x.fecha_inicio),
    fechaFin: textoONulo(x.fecha_fin),
    polizaEstado: esEstadoPolizaContrato(x.poliza_estado) ? x.poliza_estado : null,
    aprobadoAt: textoONulo(x.aprobado_at),
    solicitadoPorNombre: textoONulo(x.solicitado_por_nombre),
    proyectoId: texto(x.proyecto_id),
    proyectoCodigo: textoONulo(x.proyecto_codigo),
    proyectoNombre: textoONulo(x.proyecto_nombre),
    contratista: {
      id: texto(k.id),
      nombre: texto(k.nombre),
      tipoPersona: texto(k.tipo_persona),
      documento: texto(k.documento),
      representanteNombre: textoONulo(k.representante_nombre),
      representanteDocumento: textoONulo(k.representante_documento),
      direccion: textoONulo(k.direccion),
      telefono: textoONulo(k.telefono),
      correo: textoONulo(k.correo),
      ciudad: textoONulo(k.ciudad),
    },
  }
}

export function mapPoliza(x: Fila): Poliza {
  const estado = x.estado === "aprobada" || x.estado === "devuelta" ? x.estado : "por_revisar"
  return {
    id: texto(x.id),
    contratoId: texto(x.contrato_id),
    estado,
    motivo: textoONulo(x.motivo),
    ruta: texto(x.ruta),
    nombreArchivo: texto(x.nombre_archivo),
    tamano: Number(x.tamano ?? 0),
    mime: texto(x.mime),
    subidaPorNombre: textoONulo(x.subida_por_nombre),
    createdAt: texto(x.created_at),
    resueltaPorNombre: textoONulo(x.resuelta_por_nombre),
    resueltaAt: textoONulo(x.resuelta_at),
  }
}

export const mapPolizaConContrato = (x: Fila): PolizaConContrato => ({
  ...mapPoliza(x),
  contrato: mapContratoPoliza((x.contrato ?? {}) as Fila),
})

export const tipoContratoPoliza = (c: Pick<ContratoPoliza, "clase" | "tipo" | "tipoDetalle">) => nombreTipoContrato(c)

// ---------------------------------------------------------------- archivo
export const MIME_POLIZA = ["application/pdf", "image/jpeg", "image/png"] as const
export const TAMANO_MAXIMO_POLIZA = 10 * 1024 * 1024

// Lo mismo que revisa subir_poliza (y el bucket).
export function validarArchivoPoliza(a: { name: string; size: number; type: string }): string | null {
  if (!(MIME_POLIZA as readonly string[]).includes(a.type)) return "La póliza tiene que ser PDF, JPG o PNG."
  if (a.size <= 0) return "El archivo está vacío."
  if (a.size > TAMANO_MAXIMO_POLIZA) return "El archivo no puede pasar de 10 MB."
  if (!a.name.trim() || a.name.length > 300) return "El nombre del archivo no es válido."
  return null
}

// polizas/<contrato_id>/<marca>.<ext>
export function rutaArchivoPoliza(contratoId: string, nombre: string, marca: number): string {
  const ext = nombre.includes(".") ? nombre.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf" : "pdf"
  return `${contratoId}/${marca}.${ext}`
}

// Sin póliza aprobada no hay actas (igual que _guardar_acta).
export const motivoSinActasPorPoliza = (estado: EstadoPolizaContrato | null): string | null =>
  estado === "aprobada"
    ? null
    : estado === "recibida"
      ? "La póliza del contrato está en revisión de Jurídica: cuando la apruebe se pueden hacer actas."
      : "Falta la póliza del contrato aprobada por Jurídica (Contratos › Pólizas): sin ella no se pueden hacer actas."
