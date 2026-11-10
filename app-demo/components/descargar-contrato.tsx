"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { descargarPdfMinuta } from "@/components/minuta-comun"
import type { EstadoContrato, EstadoMinuta } from "@/lib/contratos"

// Descarga del contrato (la minuta firmada, o la hoja si es general) desde
// Contratos por grupos y Contratos generales. Solo cuando lo aprobaron todas
// las partes: Jurídica pre-aprobó la solicitud y Gerencia aprobó la minuta
// (decisión del usuario, 2026-11-10). La ruta y la base exigen lo mismo
// (contrato_para_ver_otrosi), así que el botón no es la única barrera.
export const contratoDescargable = (c: { estado: EstadoContrato; minutaEstado: EstadoMinuta | null }) =>
  c.estado === "aprobada" && c.minutaEstado === "aprobada"

export function BotonDescargarContrato({
  contrato,
  compacto,
}: {
  contrato: { id: string; codigo: string; estado: EstadoContrato; minutaEstado: EstadoMinuta | null }
  // compacto: solo el ícono (columna de la tabla)
  compacto?: boolean
}) {
  const [descargando, setDescargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!contratoDescargable(contrato)) return null

  async function descargar() {
    setDescargando(true)
    setError(null)
    try {
      await descargarPdfMinuta(contrato.id, {}, `${contrato.codigo}.pdf`, `/contratos/otrosi-pdf/contrato/${contrato.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descargar el contrato.")
    } finally {
      setDescargando(false)
    }
  }

  const icono = descargando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {compacto ? (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={descargar}
          disabled={descargando}
          title={error ?? "Descargar el contrato firmado (PDF)"}
          aria-label={`Descargar contrato ${contrato.codigo}`}
          className={error ? "text-destructive" : undefined}
        >
          {icono}
        </Button>
      ) : (
        <Button variant="outline" onClick={descargar} disabled={descargando}>
          {icono} Descargar contrato
        </Button>
      )}
      {error && !compacto && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}
