"use client"

import { ArrowRightLeft, Globe } from "lucide-react"
import type { MetodoPagoContrato } from "@/lib/contratos"

const METODOS: { valor: MetodoPagoContrato; titulo: string; descripcion: string; icono: typeof Globe }[] = [
  { valor: "transferencia", titulo: "Transferencia", descripcion: "A la cuenta del contratista en Terceros.", icono: ArrowRightLeft },
  { valor: "pse", titulo: "PSE", descripcion: "Sin cuenta bancaria.", icono: Globe },
]

// Transferencia o PSE en "Forma de pago" de la solicitud de contrato (por
// grupos y general). Con PSE, la información para pagar va en observaciones.
// claseTexto: la clase del campo de texto de cada formulario (con su error).
export function MetodoPagoContrato({
  metodo,
  observaciones,
  error,
  disabled,
  claseTexto,
  onMetodo,
  onObservaciones,
}: {
  metodo: MetodoPagoContrato
  observaciones: string
  error?: string
  disabled?: boolean
  claseTexto: string
  onMetodo: (m: MetodoPagoContrato) => void
  onObservaciones: (texto: string) => void
}) {
  return (
    <div className="space-y-2" data-error={Boolean(error)}>
      <p className="text-xs font-medium text-muted-foreground">¿Cómo se paga? *</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {METODOS.map((m) => {
          const Icono = m.icono
          const activo = metodo === m.valor
          return (
            <button
              key={m.valor}
              type="button"
              disabled={disabled}
              onClick={() => onMetodo(m.valor)}
              className={`flex items-start gap-2 rounded-lg border p-2 text-left transition-colors ${
                activo ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
              }`}
            >
              <Icono className={`mt-0.5 size-4 shrink-0 ${activo ? "text-primary" : "text-muted-foreground"}`} />
              <span>
                <span className="block text-sm font-medium">{m.titulo}</span>
                <span className="block text-xs text-muted-foreground">{m.descripcion}</span>
              </span>
            </button>
          )
        })}
      </div>
      {metodo === "pse" && (
        <div className="space-y-1">
          <label htmlFor="contrato-pago-observaciones" className="text-xs font-medium text-muted-foreground">
            Observaciones: información para pagar por PSE *
          </label>
          <textarea
            id="contrato-pago-observaciones"
            rows={2}
            value={observaciones}
            onChange={(e) => onObservaciones(e.target.value)}
            placeholder="Ej. Pagar por el portal de la entidad, referencia de pago, titular y documento."
            disabled={disabled}
            className={claseTexto}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
