"use client"

import { useRef, useState } from "react"
import { FileText, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { enlaceRutTercero, guardarRutTercero } from "@/app/(app)/ayf/rut-actions"
import { extensionArchivo, revisarArchivoTercero } from "@/lib/archivos-tercero"

// RUT de un tercero que ya existe: "Ver RUT" y, con permiso, subirlo o
// cambiarlo (ficha del tercero y Preparación del Consolidado).
export function RutTercero({
  terceroId,
  nombreArchivo,
  puedeSubir,
  onCambio,
}: {
  terceroId: string
  nombreArchivo: string | null
  puedeSubir: boolean
  onCambio?: (nombre: string) => void
}) {
  const [nombre, setNombre] = useState(nombreArchivo)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const archivoRef = useRef<HTMLInputElement>(null)

  async function ver() {
    setError(null)
    try {
      window.open(await enlaceRutTercero(terceroId), "_blank", "noopener")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el RUT.")
    }
  }

  async function subir(f: File) {
    const problema = revisarArchivoTercero(f, "El RUT")
    if (problema) {
      setError(problema)
      return
    }
    setOcupado(true)
    setError(null)
    const supabase = createClient()
    const ruta = `rut/${terceroId}/${crypto.randomUUID()}.${extensionArchivo(f)}`
    let subido = false
    try {
      const { error: e } = await supabase.storage.from("terceros").upload(ruta, f, { contentType: f.type, upsert: false })
      if (e) throw new Error(`No se pudo subir el RUT: ${e.message}`)
      subido = true
      await guardarRutTercero(terceroId, { ruta, nombre: f.name, mime: f.type })
      setNombre(f.name)
      onCambio?.(f.name)
    } catch (e) {
      if (subido) await supabase.storage.from("terceros").remove([ruta])
      setError(e instanceof Error ? e.message : "No se pudo guardar el RUT.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {nombre ? (
          <Button type="button" size="sm" variant="outline" onClick={ver} title={nombre}>
            <FileText className="mr-1.5 h-4 w-4" /> Ver RUT
          </Button>
        ) : (
          <span className="text-sm text-amber-700">Sin RUT</span>
        )}
        {puedeSubir && (
          <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={() => archivoRef.current?.click()}>
            {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
            {nombre ? "Cambiar RUT" : "Subir RUT"}
          </Button>
        )}
        <input
          ref={archivoRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) subir(f)
          }}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
