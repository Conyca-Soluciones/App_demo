import type { Pago } from "@/lib/pagos"

// Etiquetas que A&F tiene que ver de un vistazo en un pago (Aprobación de
// pagos y Consolidado): pago inmediato (rojo, urgente) y fiducia (20270101000000).
export function EtiquetasPago({ pago }: { pago: Pick<Pago, "pagoInmediato" | "ordenTipoPago"> }) {
  if (!pago.pagoInmediato && pago.ordenTipoPago !== "fiducia") return null
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {pago.pagoInmediato && (
        <span className="rounded border border-red-400 bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white">
          Pago inmediato
        </span>
      )}
      {pago.ordenTipoPago === "fiducia" && (
        <span className="rounded border border-violet-400 bg-violet-100 px-1.5 text-[11px] font-semibold leading-5 text-violet-900">
          Fiducia
        </span>
      )}
    </span>
  )
}

// Texto de las mismas etiquetas (búsqueda, Excel, ventana de detalle).
export const textoEtiquetasPago = (pago: Pick<Pago, "pagoInmediato" | "ordenTipoPago">) =>
  [pago.pagoInmediato ? "PAGO INMEDIATO" : null, pago.ordenTipoPago === "fiducia" ? "FIDUCIA" : null].filter(Boolean).join(" · ")
