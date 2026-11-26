"use client"

import { useRef, useState } from "react"
import { FileText, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { confirmar } from "@/components/ui/confirmar"
import { createClient } from "@/lib/supabase/client"
import { extensionArchivo, revisarArchivoTercero } from "@/lib/archivos-tercero"
import { guardarCertificacionCuenta, urlCertificacionCuenta } from "@/app/(app)/ayf/terceros/actions"
import type { CuentaTercero } from "@/lib/terceros"

// Certificación bancaria de UNA cuenta, en la ficha del tercero (20270101007200):
// "Ver" y, con la acción Cambiar RUT y certificación bancaria (o A&F), subirla o
// cambiarla. Si la cuenta estaba verificada y no la cambia quien verifica, vuelve
// a pendiente para que Financiera la revise.
export function CertificacionCuenta({
  cuenta,
  puedeCambiar,
  verifica,
  onGuardada,
}: {
  cuenta: CuentaTercero
  puedeCambiar: boolean
  verifica: boolean
  onGuardada: (mensaje: string) => void
}) {
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const archivoRef = useRef<HTMLInputElement>(null)
  const tiene = Boolean(cuenta.certificacionNombre)
  const vuelvePendiente = cuenta.estado === "ACTIVO" && !verifica

  async function ver() {
    setError(null)
    try {
      const r = await urlCertificacionCuenta(cuenta.id)
      if (!r) throw new Error("La cuenta no tiene certificación.")
      window.open(r.url, "_blank", "noopener")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir la certificación.")
    }
  }

  async function elegir() {
    if (
      vuelvePendiente &&
      !(await confirmar(
        "La cuenta está verificada. Con la certificación nueva vuelve a pendiente hasta que Financiera la verifique otra vez, y sus pagos quedan con novedad mientras tanto.",
        { titulo: "Cambiar certificación bancaria", boton: "Continuar" }
      ))
    ) {
      return
    }
    archivoRef.current?.click()
  }

  async function subir(f: File) {
    const problema = revisarArchivoTercero(f, "La certificación")
    if (problema) {
      setError(problema)
      return
    }
    setOcupado(true)
    setError(null)
    const supabase = createClient()
    const ruta = `${cuenta.id}/${Date.now()}.${extensionArchivo(f)}`
    let subido = false
    try {
      const { error: e } = await supabase.storage.from("terceros").upload(ruta, f, { contentType: f.type, upsert: false })
      if (e) throw new Error(`No se pudo subir la certificación: ${e.message}`)
      subido = true
      await guardarCertificacionCuenta(cuenta.id, ruta, f.name, f.type)
      onGuardada(
        vuelvePendiente
          ? "Certificación guardada. La cuenta quedó pendiente de verificar en Financiera."
          : "Certificación guardada."
      )
    } catch (e) {
      if (subido) await supabase.storage.from("terceros").remove([ruta])
      setError(e instanceof Error ? e.message : "No se pudo guardar la certificación.")
    } finally {
      setOcupado(false)
    }
  }

  if (!tiene && !puedeCambiar) return <span className="text-xs text-amber-700">Sin certificación</span>

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {tiene ? (
          <Button type="button" size="sm" variant="outline" onClick={ver} title={cuenta.certificacionNombre ?? undefined}>
            <FileText className="mr-1.5 h-4 w-4" /> Certificación
          </Button>
        ) : (
          <span className="text-xs text-amber-700">Sin certificación</span>
        )}
        {puedeCambiar && (
          <Button type="button" size="sm" variant="outline" disabled={ocupado} onClick={elegir}>
            {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
            {tiene ? "Cambiar certificación" : "Subir certificación"}
          </Button>
        )}
        <input
          ref={archivoRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) void subir(f)
          }}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
