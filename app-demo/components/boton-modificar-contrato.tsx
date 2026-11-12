"use client"

import { useEffect, useState } from "react"
import { Loader2, PencilLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  contratoModificable,
  reabrirMinutaContrato,
  reabrirSolicitudContrato,
  type EstadoModificable,
} from "@/app/(app)/contratos/modificar/actions"

// "Modificar solicitud" (quien la pidió) o "Modificar minuta" (Jurídica) de un
// contrato cuya póliza todavía no está aprobada (20270101000400). Pide qué se
// va a modificar, reabre y vuelve a pasar por las aprobaciones. Solo aparece si
// la base dice que se puede.
export function BotonModificarContrato({
  contratoId,
  parte,
  onReabierto,
}: {
  contratoId: string
  parte: "solicitud" | "minuta"
  onReabierto: () => void
}) {
  const [estado, setEstado] = useState<{ id: string; valor: EstadoModificable } | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let activo = true
    contratoModificable(contratoId)
      .then((v: EstadoModificable) => activo && setEstado({ id: contratoId, valor: v }))
      .catch(() => {}) // sin respuesta no se muestra el botón
    return () => {
      activo = false
    }
  }, [contratoId])

  const v = estado?.id === contratoId ? estado.valor : null
  if (!v?.modificable || (parte === "solicitud" && !v.esSolicitante)) return null

  async function confirmar() {
    if (!motivo.trim()) {
      setError("Escribe qué vas a modificar.")
      return
    }
    setGuardando(true)
    setError(null)
    try {
      if (parte === "solicitud") await reabrirSolicitudContrato(contratoId, motivo.trim())
      else await reabrirMinutaContrato(contratoId, motivo.trim())
      setAbierto(false)
      onReabierto()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reabrir el contrato.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setAbierto(true)}>
        <PencilLine className="size-4" /> {parte === "solicitud" ? "Modificar solicitud" : "Modificar minuta"}
      </Button>
      <Dialog open={abierto} onOpenChange={(a) => !a && !guardando && setAbierto(false)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{parte === "solicitud" ? "Modificar la solicitud" : "Modificar la minuta"}</DialogTitle>
            <DialogDescription>
              {parte === "solicitud"
                ? "La solicitud vuelve a tus manos para corregirla. Al reenviarla pasa otra vez por Pre-aprobación (Jurídica) y por la aprobación del contrato."
                : "La minuta vuelve a Jurídica para editarla. Después se envía otra vez para su aprobación."}{" "}
              Se conserva el número del contrato; la firma del representante y la póliza se vuelven a pedir al aprobarlo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <label htmlFor="motivo-modificar" className="text-xs font-medium text-muted-foreground">
              ¿Qué se va a modificar? *
            </label>
            <Textarea id="motivo-modificar" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={confirmar} disabled={guardando}>
              {guardando && <Loader2 className="size-4 animate-spin" />} Reabrir para modificar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
