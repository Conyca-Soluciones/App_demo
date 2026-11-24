"use client"

import { Input } from "@/components/ui/input"
import { MAX_DIRECCION_ENTREGA } from "@/lib/direccion-entrega"

// Dirección de entrega de una requisición (Paquete A: obligatoria). Arranca
// vacía y la escribe quien hace la requisición (decisión del usuario,
// 2026-11-24: antes proponía la última del proyecto y había que borrarla).
export function CampoDireccionEntrega({
  id = "direccion-entrega",
  value,
  onChange,
  disabled,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        Dirección de entrega <span className="text-destructive">*</span>
      </label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        maxLength={MAX_DIRECCION_ENTREGA}
        placeholder="Dónde se entrega el material (obra, bodega, oficina...)"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
