import { ETIQUETA_ETAPA_CONTRATO, etapaContrato, nombreTipoContrato, pesos, type EstadoContrato, type EstadoMinuta } from "@/lib/contratos"
import { ZONA_HORARIA, formatearFechaSinHora } from "@/lib/fechas"
import type { HojaContratoGeneral } from "@/components/contrato-general-pdf"

// ---------------------------------------------------------------------------
// Arma la hoja del contrato general (components/contrato-general-pdf.tsx) con
// la fila que lee la ruta del PDF. Puro: se prueba sin base de datos
// (tests/contrato-general-hoja.test.ts).
// ---------------------------------------------------------------------------

export const SELECT_HOJA_CONTRATO_GENERAL = `
  numero, numero_contrato, tipo, tipo_detalle, estado, minuta_estado, valor, fecha_inicio, fecha_fin, forma_pago,
  retencion_garantia_pct, retencion_anticipo_pct, retencion_fic_pct, referencia, objeto, observaciones,
  enviado_at, resuelto_at, minuta_resuelta_at,
  solicitante:perfiles!contratos_solicitado_por_fkey(nombre),
  resolutor:perfiles!contratos_resuelto_por_fkey(nombre),
  minuta_resolutor:perfiles!contratos_minuta_resuelta_por_fkey(nombre),
  proyecto:proyectos!contratos_proyecto_id_fkey(codigo, nombre, ciudad, empresa:empresas(nit, razon_social)),
  contratista:contratistas!contratos_contratista_id_fkey(nombre, tipo_documento, numero_documento, digito_verificacion, direccion, telefono, correo, ciudad)
`

type Nombre = { nombre: string | null } | null

export type FilaHojaContratoGeneral = {
  numero: number
  numero_contrato: string | null
  tipo: string
  tipo_detalle: string | null
  estado: EstadoContrato
  minuta_estado: EstadoMinuta | null
  valor: number | string
  fecha_inicio: string | null
  fecha_fin: string | null
  forma_pago: string
  retencion_garantia_pct: number | string | null
  retencion_anticipo_pct: number | string | null
  retencion_fic_pct: number | string | null
  referencia: string | null
  objeto: string
  observaciones: string | null
  enviado_at: string | null
  resuelto_at: string | null
  minuta_resuelta_at: string | null
  solicitante: Nombre
  resolutor: Nombre
  minuta_resolutor: Nombre
  proyecto: { codigo: string | null; nombre: string | null; ciudad: string | null; empresa: { nit: string | null; razon_social: string | null } | null } | null
  contratista: {
    nombre: string
    tipo_documento: string
    numero_documento: string
    digito_verificacion: string | null
    direccion: string | null
    telefono: string | null
    correo: string | null
    ciudad: string | null
  } | null
}

// "10/07/2025 08:55 a. m." en hora Colombia.
export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("es-CO", {
    timeZone: ZONA_HORARIA,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

const porcentaje = (v: number | string | null) => `${String(Number(v ?? 0)).replace(".", ",")} %`

export function armarHojaContratoGeneral(f: FilaHojaContratoGeneral, ahora: Date): HojaContratoGeneral {
  const c = f.contratista
  const preaprobada = f.estado === "aprobada"
  const aprobada = preaprobada && f.minuta_estado === "aprobada"
  return {
    numero: f.numero_contrato ?? `Solicitud N° ${f.numero}`,
    empresaNombre: f.proyecto?.empresa?.razon_social ?? "",
    empresaNit: f.proyecto?.empresa?.nit ?? "",
    ciudad: f.proyecto?.ciudad ?? "",
    contratista: {
      nombre: c?.nombre ?? "",
      documento: c ? `${c.numero_documento}${c.tipo_documento === "NIT" && c.digito_verificacion ? `-${c.digito_verificacion}` : ""}` : "",
      direccion: c?.direccion ?? "",
      telefono: c?.telefono ?? "",
      correo: c?.correo ?? "",
      ciudad: c?.ciudad ?? "",
    },
    proyecto: [f.proyecto?.codigo, f.proyecto?.nombre].filter(Boolean).join(" — "),
    tipo: nombreTipoContrato({ tipo: f.tipo, tipoDetalle: f.tipo_detalle }),
    valor: pesos(Number(f.valor)),
    fechaInicio: formatearFechaSinHora(f.fecha_inicio),
    fechaFin: formatearFechaSinHora(f.fecha_fin),
    estado: ETIQUETA_ETAPA_CONTRATO[etapaContrato({ estado: f.estado, minutaEstado: f.minuta_estado })],
    formaPago: f.forma_pago,
    retencionGarantia: porcentaje(f.retencion_garantia_pct),
    retencionAnticipo: porcentaje(f.retencion_anticipo_pct),
    retencionFic: porcentaje(f.retencion_fic_pct),
    referencia: f.referencia ?? "",
    descripcion: f.objeto,
    observaciones: f.observaciones ?? "",
    elaboro: f.solicitante?.nombre ? { nombre: f.solicitante.nombre, fecha: fechaHora(f.enviado_at) } : null,
    // resuelto_por también guarda a quien la devolvió: solo cuenta si quedó pre-aprobada.
    preaprobo: preaprobada && f.resolutor?.nombre ? { nombre: f.resolutor.nombre, fecha: fechaHora(f.resuelto_at) } : null,
    aprobo: aprobada && f.minuta_resolutor?.nombre ? { nombre: f.minuta_resolutor.nombre, fecha: fechaHora(f.minuta_resuelta_at) } : null,
    impreso: fechaHora(ahora.toISOString()),
  }
}

export const nombreArchivoContratoGeneral = (numero: string, contratista: string) =>
  `Contrato general ${numero} - ${contratista}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() + ".pdf"
