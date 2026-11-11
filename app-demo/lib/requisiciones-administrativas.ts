// ---------------------------------------------------------------------------
// Requisiciones administrativas (A&F › Administrativo; 20261231900000): lo que
// Compras compra para FUNCIONAMIENTO (proyecto 000) o para un proyecto que la
// persona ve (sin cupo del presupuesto). Las hace cualquier usuario y las
// aprueba Subgerencia (Paquete A, 20261231999400; las de antes nacieron
// aprobadas); aprobadas pasan a Requisiciones por comprar.
// (No confundir con los pagos administrativos, lib/requisiciones-admin.ts.)
//
// Archivo plano: tipos, validación y mapeos (pruebas en
// tests/requisiciones-administrativas.test.ts).
// ---------------------------------------------------------------------------

import { leerCantidadEntera } from "@/lib/numeros"

export const MAX_LINEAS_REQ_ADMINISTRATIVA = 50

// Para dónde se pide (proyectos_requisicion_administrativa).
export type ProyectoReqAdministrativa = {
  id: string
  codigo: string | null
  nombre: string
  funcionamiento: boolean
}

export function nombreProyectoReqAdministrativa(p: Pick<ProyectoReqAdministrativa, "codigo" | "nombre">): string {
  return p.codigo ? `${p.codigo} - ${p.nombre}` : p.nombre
}

export type LineaFormReqAdministrativa = {
  insumoId: string
  codigo: number
  descripcion: string
  unidad: string | null
  cantidad: string // como se escribe
}

// Primer error (null = lista para enviar). Mismas reglas que
// crear_requisicion_administrativa.
export function validarReqAdministrativa(
  lineas: LineaFormReqAdministrativa[],
  fechaRequerida: string,
  hoy: string,
  proyectoId: string | null = "x"
): string | null {
  if (!proyectoId) return "Elige FUNCIONAMIENTO o el proyecto."
  if (!fechaRequerida) return "Escribe la fecha requerida."
  if (fechaRequerida < hoy) return "La fecha requerida no puede ser anterior a hoy."
  if (lineas.length === 0) return "Agrega al menos un insumo."
  if (lineas.length > MAX_LINEAS_REQ_ADMINISTRATIVA) return `Una requisición puede tener máximo ${MAX_LINEAS_REQ_ADMINISTRATIVA} insumos.`
  if (new Set(lineas.map((l) => l.insumoId)).size !== lineas.length) return "Hay un insumo repetido."
  for (const l of lineas) {
    const n = leerCantidadEntera(l.cantidad)
    if (!n.ok) return `${l.descripcion}: ${n.error}`
    if (n.valor <= 0) return `${l.descripcion}: la cantidad tiene que ser mayor que cero.`
  }
  return null
}

// Solo con líneas ya validadas (validarReqAdministrativa).
export function lineasParaGuardar(lineas: LineaFormReqAdministrativa[]) {
  return lineas.map((l) => {
    const n = leerCantidadEntera(l.cantidad)
    return { insumo_id: l.insumoId, cantidad: n.ok ? n.valor : 0 }
  })
}

// ---------------------------------------------------------------- lista y detalle
export type EstadoCompraReqAdministrativa = "pendiente" | "parcial" | "completa" | "rechazada_compras" | null

export type ReqAdministrativaFila = {
  id: string
  numero: number
  codigo: string // RQ-001-0001
  estado: "aprobada" | "cancelada" | "pendiente" | "rechazada"
  estadoCompra: EstadoCompraReqAdministrativa
  nLineas: number
  fechaRequerida: string | null
  urgente: boolean
  observaciones: string | null
  createdAt: string
  proyecto: string | null
}

export type LineaReqAdministrativa = {
  id: string
  insumoCodigo: number
  insumoDescripcion: string
  unidad: string | null
  cantidad: number
  estado: string
  comprado: number
  rechazadoCompras: boolean
}

export type ReqAdministrativaDetalle = ReqAdministrativaFila & {
  esMia: boolean
  solicitante: string | null
  cancelable: boolean
  direccionEntrega: string | null
  // Quién la aprobó o rechazó (Subgerencia) y el motivo del rechazo.
  resolucion: { por: string | null; at: string | null; motivo: string | null } | null
  lineas: LineaReqAdministrativa[]
}

// Estado que ve quien la pidió (en Compras).
export function etapaReqAdministrativa(r: Pick<ReqAdministrativaFila, "estado" | "estadoCompra">): {
  etiqueta: string
  clase: string
} {
  if (r.estado === "cancelada") return { etiqueta: "Cancelada", clase: "border-gray-300 bg-gray-50 text-gray-500" }
  if (r.estado === "pendiente") return { etiqueta: "Por aprobar (Subgerencia)", clase: "border-violet-300 bg-violet-50 text-violet-700" }
  if (r.estado === "rechazada") return { etiqueta: "Rechazada por Subgerencia", clase: "border-red-300 bg-red-50 text-red-700" }
  if (r.estadoCompra === "completa") return { etiqueta: "Comprada", clase: "border-green-300 bg-green-50 text-green-700" }
  if (r.estadoCompra === "rechazada_compras") return { etiqueta: "Rechazada por Compras", clase: "border-red-300 bg-red-50 text-red-700" }
  if (r.estadoCompra === "parcial") return { etiqueta: "Compra parcial", clase: "border-sky-300 bg-sky-50 text-sky-700" }
  return { etiqueta: "En Compras", clase: "border-amber-300 bg-amber-50 text-amber-700" }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapFilaReqAdministrativa(r: any): ReqAdministrativaFila {
  return {
    id: String(r.id),
    numero: Number(r.numero),
    codigo: r.codigo ?? `N° ${r.numero}`,
    estado: r.estado,
    estadoCompra: r.estado_compra ?? null,
    nLineas: Number(r.n_lineas ?? 0),
    fechaRequerida: r.fecha_requerida ?? null,
    urgente: Boolean(r.urgente),
    observaciones: r.observaciones ?? null,
    createdAt: String(r.created_at ?? ""),
    proyecto: r.proyecto ?? null,
  }
}

export function mapDetalleReqAdministrativa(r: any): ReqAdministrativaDetalle {
  return {
    ...mapFilaReqAdministrativa({ ...r, n_lineas: Array.isArray(r.lineas) ? r.lineas.length : 0 }),
    esMia: Boolean(r.es_mia),
    solicitante: r.solicitante ?? null,
    cancelable: Boolean(r.cancelable),
    direccionEntrega: r.direccion_entrega ?? null,
    resolucion: r.resolucion
      ? { por: r.resolucion.por ?? null, at: r.resolucion.at ?? null, motivo: r.resolucion.motivo ?? null }
      : null,
    lineas: (Array.isArray(r.lineas) ? r.lineas : []).map((l: any) => ({
      id: String(l.id),
      insumoCodigo: Number(l.insumo_codigo),
      insumoDescripcion: String(l.insumo_descripcion ?? ""),
      unidad: l.unidad ?? null,
      cantidad: Number(l.cantidad ?? 0),
      estado: String(l.estado ?? ""),
      comprado: Number(l.comprado ?? 0),
      rechazadoCompras: Boolean(l.rechazado_compras),
    })),
  }
}
export function mapProyectoReqAdministrativa(r: any): ProyectoReqAdministrativa {
  return { id: String(r.id), codigo: r.codigo ?? null, nombre: String(r.nombre ?? ""), funcionamiento: Boolean(r.funcionamiento) }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
