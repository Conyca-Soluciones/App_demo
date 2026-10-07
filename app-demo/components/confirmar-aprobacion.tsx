"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Confirmación antes de aprobar una requisición o una orden de compra. Antes
// era un solo clic, y aprobar no se deshace fácil: notifica, libera la compra o
// genera los pagos. Rechazar ya pedía motivo en su propio diálogo.
export function ConfirmarAprobacion({
  abierta,
  titulo,
  detalle,
  procesando,
  onConfirmar,
  onCerrar,
}: {
  abierta: boolean
  titulo: string
  detalle: React.ReactNode
  procesando: boolean
  onConfirmar: () => void
  onCerrar: () => void
}) {
  return (
    <Dialog
      open={abierta}
      onOpenChange={(abierto) => {
        if (!abierto && !procesando) onCerrar()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{detalle}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={procesando}>
            Cancelar
          </Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={onConfirmar}
            disabled={procesando}
          >
            {procesando ? "Aprobando..." : "Aprobar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
