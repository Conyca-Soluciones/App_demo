"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatearFechaHora } from "@/lib/fechas"
import { marcarRevisadoTercero, revisionTercero, type RevisionTercero } from "@/app/(app)/revision-tercero-actions"

// Revisión por cambio del tercero (20270101006100): Financiera cambió el tercero de este
// proveedor o contratista. Muestra qué cambió (antes -> después) y "Revisado". Mientras
// esté abierta no se le hacen órdenes ni contratos nuevos (lo exige la base).

const ETIQUETA: Record<string, string> = {
  tipo_documento: "Tipo de documento",
  numero_documento: "Número de documento",
  dv: "DV",
  razon_social: "Nombre",
  correo: "Correo",
  telefono: "Teléfono",
  direccion: "Dirección",
  ciudad: "Ciudad",
}

const texto = (v: unknown) => (v == null || v === "" ? "—" : String(v))

export function AvisoRevisionTercero({
  entidad,
  id,
  puedeMarcar,
  onRevisado,
}: {
  entidad: "proveedor" | "contratista"
  id: string
  puedeMarcar: boolean
  onRevisado?: () => void
}) {
  const [revision, setRevision] = useState<RevisionTercero | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    revisionTercero(entidad, id)
      .then((r: RevisionTercero | null) => vigente && setRevision(r))
      .catch(() => vigente && setRevision(null))
    return () => {
      vigente = false
    }
  }, [entidad, id])

  if (!revision) return null

  async function marcar() {
    setOcupado(true)
    setError(null)
    try {
      await marcarRevisadoTercero(entidad, id)
      setRevision(null)
      onRevisado?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo marcar como revisado.")
    } finally {
      setOcupado(false)
    }
  }

  const nombre = entidad === "proveedor" ? "proveedor" : "contratista"
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="flex items-start gap-2 font-medium">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        En revisión: Financiera cambió su tercero{revision.pedidaPor ? ` (${revision.pedidaPor})` : ""} el{" "}
        {formatearFechaHora(revision.desde)}.
      </p>
      <p className="text-xs">
        Verifica los datos del {nombre}. Mientras no se marque como revisado no se le hacen{" "}
        {entidad === "proveedor" ? "órdenes de compra" : "contratos"} nuevos.
      </p>
      <ul className="space-y-0.5 text-xs">
        {Object.entries(revision.cambios).map(([campo, c]) => (
          <li key={campo}>
            <span className="font-medium">{ETIQUETA[campo] ?? campo}:</span> {texto(c.de)} → {texto(c.a)}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {puedeMarcar && (
        <div className="flex justify-end">
          <Button size="sm" onClick={marcar} disabled={ocupado}>
            {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
            Revisado
          </Button>
        </div>
      )}
    </div>
  )
}
