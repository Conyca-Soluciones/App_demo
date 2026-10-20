"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PanelVistaPrevia, useVistaPreviaMinuta } from "@/components/minuta-comun"

// ---------------------------------------------------------------------------
// El contrato aprobado en PDF (su minuta, o la hoja si es general), para
// consultarlo mientras se pide o se revisa un otrosí. Ruta:
// app/(app)/contratos/otrosi-pdf/contrato/[id]/route.tsx.
// ---------------------------------------------------------------------------

export function VerContratoOtrosi({ contrato, onCerrar }: { contrato: { id: string; numeroContrato: string } | null; onCerrar: () => void }) {
  return (
    <Dialog open={contrato !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="flex h-[96svh] max-h-[96svh] w-[calc(100vw-1rem)] max-w-5xl flex-col gap-3 overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Contrato {contrato?.numeroContrato}</DialogTitle>
        </DialogHeader>
        {contrato && <PdfContrato id={contrato.id} />}
      </DialogContent>
    </Dialog>
  )
}

const SIN_CAMBIOS = {}
function PdfContrato({ id }: { id: string }) {
  const vista = useVistaPreviaMinuta(id, SIN_CAMBIOS, null, `/contratos/otrosi-pdf/contrato/${id}`)
  return (
    <div className="min-h-0 flex-1">
      <PanelVistaPrevia {...vista} />
    </div>
  )
}
