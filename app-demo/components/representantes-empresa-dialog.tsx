"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  TIPOS_DOCUMENTO_REPRESENTANTE,
  datosDeRepresentante,
  validarRepresentantesEmpresa,
  type DatosRepresentante,
  type RepresentanteLegal,
  type TipoDocumentoRepresentante,
} from "@/lib/representantes"
import { guardarRepresentantesEmpresa } from "@/app/(app)/admin/actions"

// Admin › Empresas: representante legal y suplente de la empresa (nombre y
// documento). Dejar uno en blanco = la empresa queda sin él. Cambiar el
// documento = otra persona: la anterior queda inactiva (los contratos que firmó
// no cambian) y la nueva necesita su firma (Contratos › Firmas de
// representantes, Subgerencia).
export function RepresentantesEmpresaDialog({
  empresa,
  principal,
  suplente,
  onCerrar,
  onGuardado,
}: {
  empresa: { id: string; razonSocial: string }
  principal: RepresentanteLegal | null
  suplente: RepresentanteLegal | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [p, setP] = useState<DatosRepresentante>(datosDeRepresentante(principal))
  const [su, setSu] = useState<DatosRepresentante>(datosDeRepresentante(suplente))
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    const problema = validarRepresentantesEmpresa(p, su)
    if (problema) return setError(problema)
    setGuardando(true)
    setError(null)
    try {
      await guardarRepresentantesEmpresa(empresa.id, p, su)
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Representantes legales</DialogTitle>
          <DialogDescription>
            {empresa.razonSocial}. Salen en las minutas de sus contratos; la firma la pone Subgerencia en Contratos › Firmas de
            representantes.
          </DialogDescription>
        </DialogHeader>
        <Bloque titulo="Representante legal" datos={p} onCambio={setP} />
        <Bloque titulo="Suplente" datos={su} onCambio={setSu} />
        <p className="text-xs text-muted-foreground">Deja un bloque en blanco si la empresa no lo tiene.</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Bloque({ titulo, datos, onCambio }: { titulo: string; datos: DatosRepresentante; onCambio: (d: DatosRepresentante) => void }) {
  const cambiar = (c: Partial<DatosRepresentante>) => onCambio({ ...datos, ...c })
  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{titulo}</legend>
      <div className="grid gap-2 sm:grid-cols-[1fr_6rem_10rem]">
        <Input value={datos.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder="Nombre completo" />
        <Select value={datos.tipoDocumento} onValueChange={(v) => cambiar({ tipoDocumento: (v as TipoDocumentoRepresentante) ?? "CC" })}>
          <SelectTrigger className="h-9 w-full" aria-label={`Tipo de documento del ${titulo.toLowerCase()}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIPOS_DOCUMENTO_REPRESENTANTE.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input inputMode="numeric" value={datos.numeroDocumento} onChange={(e) => cambiar({ numeroDocumento: e.target.value })} placeholder="Número" />
      </div>
      <Input value={datos.expedidaEn} onChange={(e) => cambiar({ expedidaEn: e.target.value })} placeholder="Documento expedido en (ciudad)" />
    </fieldset>
  )
}
