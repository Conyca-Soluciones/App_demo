"use client"

import { useEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { MAX_DIRECCION_ENTREGA } from "@/lib/direccion-entrega"
import { ultimaDireccionEntrega } from "@/app/(app)/almacen/actions"

// Dirección de entrega de una requisición (Paquete A: obligatoria). Si está
// vacía, propone la última que se usó en el proyecto (sin proyecto, el actual);
// quien la llena la puede cambiar.
export function CampoDireccionEntrega({
  id = "direccion-entrega",
  value,
  onChange,
  disabled,
  proyectoId,
  sugerir = true,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  proyectoId?: string | null
  /** false al modificar: se respeta la que ya tiene. */
  sugerir?: boolean
}) {
  // Lo último escrito y el último onChange, para la respuesta asíncrona.
  const valorRef = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    valorRef.current = value
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (!sugerir) return
    let activo = true
    ultimaDireccionEntrega(proyectoId ?? null)
      .then((d: string | null) => {
        if (activo && d && !valorRef.current.trim()) onChangeRef.current(d)
      })
      .catch(() => {})
    return () => {
      activo = false
    }
  }, [sugerir, proyectoId])

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
