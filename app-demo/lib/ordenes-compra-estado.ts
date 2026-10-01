// Estado ÚNICO que ve el usuario de una orden de compra. En la base viven
// dos columnas -- ordenes_compra.estado (flujo de aprobación, del que
// dependen PDF, aprobaciones y funciones SQL) y ordenes_compra.estado_entrega
// (recepción en bodega) -- y acá se combinan en un solo valor visible.

export type EstadoOrdenBase = "pendiente_aprobacion" | "aprobada" | "rechazada" | "cancelada"
export type EstadoEntregaOrden = "sin_entregar" | "entrega_parcial" | "entregada"

// El estado que ve el usuario de una orden de compra es solo el de aprobación:
// Pendiente, Aprobada, Rechazada o Cancelada. La recepción en bodega
// (estado_entrega) se ve en Entradas, no acá.
export type EstadoOrdenVisible = EstadoOrdenBase

export function calcularEstadoVisible(
  estado: EstadoOrdenBase,
  _estadoEntrega?: EstadoEntregaOrden | null
): EstadoOrdenVisible {
  return estado
}

// Colores: Pendiente amarillo, Aprobada verde, Rechazada rojo, Cancelada gris.
export const ESTADO_VISIBLE_BADGE: Record<EstadoOrdenVisible, { label: string; clase: string }> = {
  pendiente_aprobacion: { label: "Pendiente", clase: "border-transparent bg-amber-100 text-amber-800" },
  aprobada: { label: "Aprobada", clase: "border-transparent bg-emerald-100 text-emerald-800" },
  rechazada: { label: "Rechazada", clase: "border-transparent bg-red-100 text-red-800" },
  cancelada: { label: "Cancelada", clase: "border-transparent bg-slate-200 text-slate-700" },
}

export const FILTROS_ESTADO_VISIBLE: { valor: EstadoOrdenVisible | "todas"; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "pendiente_aprobacion", etiqueta: "Pendientes" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: "cancelada", etiqueta: "Canceladas" },
]

// Reglas de desaprobar / cancelar (la base las vuelve a validar; esto solo
// decide si se muestra el botón).
type OrdenParaReglas = {
  estado: EstadoOrdenBase
  estadoEntrega: EstadoEntregaOrden
}

// Aprobada y sin material recibido (sin entradas de almacén).
export const sePuedeDesaprobar = (o: OrdenParaReglas) =>
  o.estado === "aprobada" && o.estadoEntrega === "sin_entregar"

// Aprobada y sin material recibido (Entrega parcial y Entregada NO se cancelan).
export const sePuedeCancelar = (o: OrdenParaReglas) =>
  o.estado === "aprobada" && o.estadoEntrega === "sin_entregar"

// Pendiente de aprobación: la puede retirar quien la creó o quien tenga
// cancelar_oc (la base lo vuelve a validar en cancelar_orden_compra).
export const sePuedeRetirar = (o: OrdenParaReglas, esCreador: boolean, puedeCancelarOC: boolean) =>
  o.estado === "pendiente_aprobacion" && (esCreador || puedeCancelarOC)

// ¿Se muestra el botón Cancelar/Retirar para esta orden?
export const muestraCancelar = (
  o: OrdenParaReglas & { creadaPorId: string | null },
  permisos: { puedeCancelar: boolean; usuarioId: string | null }
) =>
  (permisos.puedeCancelar && sePuedeCancelar(o)) ||
  sePuedeRetirar(o, o.creadaPorId !== null && o.creadaPorId === permisos.usuarioId, permisos.puedeCancelar)
