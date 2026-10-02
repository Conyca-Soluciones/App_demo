"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// Muestra un documento (PDF o imagen) dentro de la misma página, en lugar de
// abrir otra pestaña. Los buckets son privados: `cargarUrl` pide un enlace
// firmado temporal (2 minutos), que solo se usa para cargar el archivo.
// Se usa dentro de los diálogos de detalle (Contratistas, Solicitudes).
// ---------------------------------------------------------------------------

export function VisorDocumento({
  titulo,
  nombreArchivo,
  mime,
  cargarUrl,
  onVolver,
}: {
  titulo: string
  nombreArchivo: string
  mime: string
  cargarUrl: () => Promise<string>
  onVolver: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    cargarUrl()
      .then((u) => !cancelado && setUrl(u))
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudo abrir el documento."))
    return () => {
      cancelado = true
    }
    // cargarUrl cambia en cada render del padre; el documento no.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nombreArchivo])

  const esImagen = mime.startsWith("image/")

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onVolver}>
          <ArrowLeft className="size-4" /> Volver
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{titulo}</p>
          <p className="truncate text-xs text-muted-foreground" title={nombreArchivo}>
            {nombreArchivo}
          </p>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"
          >
            <ExternalLink className="size-4" /> Abrir aparte
          </a>
        )}
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      ) : !url ? (
        <div className="flex h-[65svh] items-center justify-center rounded-md border text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Cargando documento...
        </div>
      ) : esImagen ? (
        <div className="flex h-[65svh] items-center justify-center overflow-auto rounded-md border bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado temporal de Storage */}
          <img src={url} alt={titulo} className="max-h-full max-w-full object-contain" />
        </div>
      ) : (
        <iframe src={url} title={titulo} className="h-[65svh] w-full rounded-md border bg-muted/30" />
      )}
    </div>
  )
}
