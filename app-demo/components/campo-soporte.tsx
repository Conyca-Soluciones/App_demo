"use client"

import { useId } from "react"
import { Paperclip, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MIME_SOPORTE_DOCUMENTO, validarArchivoSoporte } from "@/lib/soportes"

// ---------------------------------------------------------------------------
// Un soporte por adjuntar: tipo (si hay varios) + archivo. Solo elige el
// archivo; quien lo usa lo sube al guardar. Si es obligatorio, la etiqueta lo
// dice y quien lo usa no deja guardar sin él.
// ---------------------------------------------------------------------------

export function CampoSoporte<T extends string>({
  etiqueta,
  obligatorio = false,
  tipos,
  tipo,
  onTipo,
  archivo,
  onArchivo,
  onError,
  disabled,
  actual,
}: {
  etiqueta: string
  obligatorio?: boolean
  // Tipos a elegir (ej. Cotización / Cuenta de cobro / Factura). Sin tipos, no sale el selector.
  tipos?: Record<T, string>
  tipo?: T
  onTipo?: (t: T) => void
  archivo: File | null
  onArchivo: (f: File | null) => void
  onError: (mensaje: string | null) => void
  disabled?: boolean
  // Archivo ya guardado (al editar): se muestra si no se eligió otro.
  actual?: { nombreArchivo: string; onVer?: () => void } | null
}) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {etiqueta}
        {obligatorio ? " *" : " (opcional)"}
      </Label>
      {tipos && onTipo && (
        <Select value={tipo} onValueChange={(v) => v && onTipo(v as T)} disabled={disabled}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Tipo de soporte" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(tipos) as T[]).map((t) => (
              <SelectItem key={t} value={t}>
                {tipos[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {archivo ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <Paperclip className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate" title={archivo.name}>
            {archivo.name}
          </span>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={disabled} onClick={() => onArchivo(null)} aria-label="Quitar el archivo">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        actual && (
          <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Paperclip className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={actual.nombreArchivo}>
              {actual.nombreArchivo}
            </span>
            {actual.onVer && (
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={actual.onVer}>
                Ver
              </Button>
            )}
          </div>
        )
      )}
      <label
        htmlFor={id}
        className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer hover:bg-accent"}`}
      >
        <Upload className="h-4 w-4" /> {archivo || actual ? "Cambiar archivo" : "Adjuntar archivo"}
      </label>
      <input
        id={id}
        type="file"
        className="hidden"
        accept={MIME_SOPORTE_DOCUMENTO.join(",")}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          e.target.value = ""
          if (!f) return
          const problema = validarArchivoSoporte(f)
          if (problema) {
            onError(`${f.name}: ${problema}`)
            return
          }
          onError(null)
          onArchivo(f)
        }}
      />
      <p className="text-xs text-muted-foreground">PDF, JPG o PNG de hasta 10 MB.</p>
    </div>
  )
}
