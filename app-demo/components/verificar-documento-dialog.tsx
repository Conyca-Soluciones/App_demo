"use client"

import { useState } from "react"
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatearFechaHora } from "@/lib/fechas"
import { ETIQUETA_PAPEL, formatearCodigo } from "@/lib/firmas"
import { verificarDocumento, type ResultadoVerificacion } from "@/app/(app)/firma/actions"

// Verificar un documento firmado: subir el PDF (se calcula su SHA-256 en el
// navegador y se compara con el congelado al aprobarlo) o escribir el código
// impreso bajo una firma.

async function sha256DeArchivo(archivo: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await archivo.arrayBuffer())
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")
}

export function VerificarDocumentoDialog({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const [codigo, setCodigo] = useState("")
  const [resultado, setResultado] = useState<{ por: "archivo" | "codigo"; r: ResultadoVerificacion } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  function cerrar() {
    setCodigo("")
    setResultado(null)
    setError(null)
    onCerrar()
  }

  async function verificar(por: "archivo" | "codigo", entrada: () => Promise<{ sha256?: string; codigo?: string }>) {
    setOcupado(true)
    setError(null)
    setResultado(null)
    try {
      setResultado({ por, r: await verificarDocumento(await entrada()) })
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo verificar.")
    } finally {
      setOcupado(false)
    }
  }

  const r = resultado?.r

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && cerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Verificar documento</DialogTitle>
          <DialogDescription>
            Sube el PDF para saber si es el original aprobado (sin cambios), o escribe el código que aparece bajo una firma.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">PDF del documento</p>
            <input
              type="file"
              accept="application/pdf"
              disabled={ocupado}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) verificar("archivo", async () => ({ sha256: await sha256DeArchivo(f) }))
                e.target.value = ""
              }}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              verificar("codigo", async () => ({ codigo }))
            }}
          >
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código: XXXX-XXXX-XXXX" maxLength={20} />
            <Button type="submit" variant="outline" disabled={ocupado || !codigo.trim()}>
              Verificar
            </Button>
          </form>

          {ocupado && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Verificando…
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {resultado && !r && (
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <ShieldAlert className="size-5 shrink-0" />
              {resultado.por === "archivo"
                ? "Este archivo NO es un documento aprobado de la plataforma, o fue modificado después de aprobarse."
                : "No hay ninguna firma con ese código."}
            </div>
          )}
          {r && (
            <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
              <p className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="size-5 shrink-0" />
                {resultado.por === "archivo" ? "Documento original, sin cambios desde que se aprobó." : "La firma existe."}
              </p>
              <p>{r.titulo}</p>
              {r.congeladoAt && <p className="text-xs">PDF congelado el {formatearFechaHora(r.congeladoAt)}</p>}
              <ul className="space-y-1 text-xs">
                {r.firmas.map((f) => (
                  <li key={f.codigo}>
                    <span className="font-medium">{ETIQUETA_PAPEL[f.papel]}:</span> {f.nombre}
                    {f.cargo ? ` (${f.cargo})` : ""} · {formatearFechaHora(f.firmadoAt)} · {formatearCodigo(f.codigo)}
                    {!f.conImagen && " · sin firma registrada (solo nombre)"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={cerrar}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
