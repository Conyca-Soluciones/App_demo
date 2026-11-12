"use client"

import { ArrowRightLeft, Globe } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { CampoTitularCuenta } from "@/components/campo-titular-cuenta"
import type { MetodoPagoContrato } from "@/lib/contratos"
import type { TitularCuenta } from "@/lib/titular-cuenta"

// Misma casilla en Transferencia y PSE (decisión del usuario, 2026-11-12).
const ETIQUETA_OTRO_TERCERO = "Depositar a otro tercero"

const METODOS: { valor: MetodoPagoContrato; titulo: string; descripcion: string; icono: typeof Globe }[] = [
  { valor: "transferencia", titulo: "Transferencia", descripcion: "A la cuenta del contratista en Terceros.", icono: ArrowRightLeft },
  { valor: "pse", titulo: "PSE", descripcion: "Sin cuenta bancaria.", icono: Globe },
]

// Transferencia o PSE en "Forma de pago" de la solicitud de contrato (por
// grupos y general). Las dos tienen la casilla "Depositar a otro tercero":
// - Transferencia: se elige el tercero (inscrito en Terceros) y una de sus
//   cuentas (20270101000600); las actas del contrato la traen por omisión.
//   Sin ella, la cuenta del contratista.
// - PSE: la información para pagar va en observaciones y, con la casilla, el
//   nombre del titular (20261224000000; sin ella, el contratista).
// claseTexto / claseTitular: la clase de cada campo del formulario (con su error).
export function MetodoPagoContrato({
  metodo,
  observaciones,
  error,
  disabled,
  claseTexto,
  onMetodo,
  onObservaciones,
  titularDistinto,
  titularNombre,
  errorTitular,
  claseTitular,
  onTitularDistinto,
  onTitularNombre,
  titularCuenta,
  errorTitularCuenta,
  quienFactura,
  onTitularCuenta,
}: {
  metodo: MetodoPagoContrato
  observaciones: string
  error?: string
  disabled?: boolean
  claseTexto: string
  onMetodo: (m: MetodoPagoContrato) => void
  onObservaciones: (texto: string) => void
  titularDistinto: boolean
  titularNombre: string
  errorTitular?: string
  claseTitular: string
  onTitularDistinto: (v: boolean) => void
  onTitularNombre: (texto: string) => void
  titularCuenta: TitularCuenta | null
  errorTitularCuenta?: string
  quienFactura?: string | null
  onTitularCuenta: (v: TitularCuenta | null) => void
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
      {metodo === "transferencia" && (
        <div className="space-y-1 pt-1" data-error={Boolean(errorTitularCuenta)}>
          <CampoTitularCuenta
            valor={titularCuenta}
            onCambiar={onTitularCuenta}
            quienFactura={quienFactura}
            etiqueta={ETIQUETA_OTRO_TERCERO}
            disabled={disabled}
          />
          {errorTitularCuenta && <p className="text-xs text-destructive">{errorTitularCuenta}</p>}
        </div>
      )}
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
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm">
            <Checkbox checked={titularDistinto} onCheckedChange={(v) => onTitularDistinto(v === true)} disabled={disabled} />
            {ETIQUETA_OTRO_TERCERO}
          </label>
          {titularDistinto && (
            <div className="space-y-1">
              <label htmlFor="contrato-pse-titular" className="text-xs font-medium text-muted-foreground">
                Nombre del titular *
              </label>
              <input
                id="contrato-pse-titular"
                value={titularNombre}
                onChange={(e) => onTitularNombre(e.target.value)}
                disabled={disabled}
                className={claseTitular}
              />
              {errorTitular && <p className="text-xs text-destructive">{errorTitular}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
