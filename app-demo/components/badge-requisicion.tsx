import type { EstadoCompra, EstadoRequisicion } from "@/lib/requisiciones-lineas"

const ESTADO: Record<EstadoRequisicion, { etiqueta: string; clase: string }> = {
  pendiente: { etiqueta: "Pendiente", clase: "bg-amber-100 text-amber-800" },
  aprobada: { etiqueta: "Aprobada", clase: "bg-emerald-100 text-emerald-800" },
  rechazada: { etiqueta: "Rechazada", clase: "bg-red-100 text-red-800" },
  cancelada: { etiqueta: "Cancelada", clase: "bg-slate-200 text-slate-700" },
}

const COMPRA: Record<NonNullable<EstadoCompra>, { etiqueta: string; clase: string }> = {
  completa: { etiqueta: "Completa", clase: "bg-emerald-100 text-emerald-800" },
  pendiente: { etiqueta: "Pendiente", clase: "bg-amber-100 text-amber-800" },
  rechazada_compras: { etiqueta: "Rechazada por Compras", clase: "bg-red-100 text-red-800" },
}

const base = "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium"

// Estado de APROBACIÓN de la requisición.
export function BadgeEstadoRequisicion({ estado }: { estado: EstadoRequisicion }) {
  const e = ESTADO[estado]
  return <span className={`${base} ${e.clase}`}>{e.etiqueta}</span>
}

// Estado de COMPRA (solo requisiciones aprobadas): Completa = todos sus
// insumos ya están en órdenes de compra; Pendiente = falta alguno.
export function BadgeCompraRequisicion({ estadoCompra }: { estadoCompra: EstadoCompra }) {
  if (!estadoCompra) return <span className="text-muted-foreground">—</span>
  const e = COMPRA[estadoCompra]
  return <span className={`${base} ${e.clase}`}>{e.etiqueta}</span>
}

export const ETIQUETA_ESTADO_REQUISICION = Object.fromEntries(
  Object.entries(ESTADO).map(([k, v]) => [k, v.etiqueta])
) as Record<EstadoRequisicion, string>
