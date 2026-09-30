// Estado ÚNICO que ve el usuario de una orden de compra. En la base viven
// dos columnas -- ordenes_compra.estado (flujo de aprobación, del que
// dependen PDF, aprobaciones y funciones SQL) y ordenes_compra.estado_entrega
// (recepción en bodega) -- y acá se combinan en un solo valor visible.

export type EstadoOrdenBase = "pendiente_aprobacion" | "aprobada" | "rechazada" | "cancelada"
export type EstadoEntregaOrden = "sin_entregar" | "entrega_parcial" | "entregada"

export type EstadoOrdenVisible =
  | "pendiente_aprobacion"
  | "aprobada"
  | "rechazada"
  | "entrega_parcial"
  | "entregada"
  | "cancelada"

export function calcularEstadoVisible(
  estado: EstadoOrdenBase,
  estadoEntrega: EstadoEntregaOrden | null | undefined
): EstadoOrdenVisible {
  if (estado === "aprobada" && estadoEntrega === "entrega_parcial") return "entrega_parcial"
  if (estado === "aprobada" && estadoEntrega === "entregada") return "entregada"
  return estado
}

export const ESTADO_VISIBLE_BADGE: Record<
  EstadoOrdenVisible,
  { label: string; variant: "default" | "destructive" | "secondary" | "outline" }
> = {
  pendiente_aprobacion: { label: "Pendiente", variant: "secondary" },
  aprobada: { label: "Aprobada", variant: "default" },
  rechazada: { label: "Rechazada", variant: "destructive" },
  entrega_parcial: { label: "Entrega parcial", variant: "secondary" },
  entregada: { label: "Entregada", variant: "outline" },
  cancelada: { label: "Cancelada", variant: "destructive" },
}

export const FILTROS_ESTADO_VISIBLE: { valor: EstadoOrdenVisible | "todas"; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "pendiente_aprobacion", etiqueta: "Pendientes" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: "entrega_parcial", etiqueta: "Entrega parcial" },
  { valor: "entregada", etiqueta: "Entregadas" },
  { valor: "cancelada", etiqueta: "Canceladas" },
]

// Reglas de desaprobar / cancelar (la base las vuelve a validar; esto solo
// decide si se muestra el botón).
type OrdenParaReglas = {
  estado: EstadoOrdenBase
  estadoEntrega: EstadoEntregaOrden
  enviada: boolean
}

// Aprobada, sin enviar al proveedor y sin material recibido.
export const sePuedeDesaprobar = (o: OrdenParaReglas) =>
  o.estado === "aprobada" && !o.enviada && o.estadoEntrega === "sin_entregar"

// Aprobada y sin material recibido (Entrega parcial y Entregada NO se cancelan).
export const sePuedeCancelar = (o: OrdenParaReglas) =>
  o.estado === "aprobada" && o.estadoEntrega === "sin_entregar"
