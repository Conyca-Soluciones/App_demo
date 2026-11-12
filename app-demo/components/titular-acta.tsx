"use client"

import { useState } from "react"
import { FileText, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CampoTitularCuenta } from "@/components/campo-titular-cuenta"
import { titularVacio, type TitularCuenta } from "@/lib/titular-cuenta"
import { MIME_SOPORTES, validarSoporte, pideAutorizacionTercero } from "@/lib/actas"

// "Depositar a otro tercero" en el acta (20270101000300):
// - La lista trae el tercero que estipula el contrato (ya marcado al crear).
// - "Pagar a alguien nuevo" abre un diálogo: se busca el tercero en Terceros,
//   se elige su cuenta y se sube la autorización firmada (obligatoria). Ese
//   pago espera a que Jurídica lo autorice antes de pasar a A&F.
export function TitularActa({
  valor,
  onCambiar,
  contratoTitular,
  quienFactura,
  archivo,
  onArchivo,
  autorizacionGuardada,
}: {
  valor: TitularCuenta | null
  onCambiar: (v: TitularCuenta | null) => void
  contratoTitular: TitularCuenta | null
  quienFactura: string
  archivo: File | null
  onArchivo: (f: File | null) => void
  // El acta ya tiene la autorización de ESTE tercero y cuenta (al corregirla).
  autorizacionGuardada: boolean
}) {
  const [dialogo, setDialogo] = useState(false)
  const esNuevo = pideAutorizacionTercero(valor?.terceroId, contratoTitular?.terceroId)
  const seleccion = !valor?.terceroId ? "" : esNuevo ? "nuevo" : "contrato"

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={valor !== null}
          onCheckedChange={(v) => {
            if (!v) {
              onCambiar(null)
              onArchivo(null)
            } else onCambiar(contratoTitular ?? titularVacio())
          }}
        />
        Depositar a otro tercero
      </label>
      {valor === null ? (
        <p className="text-xs text-muted-foreground">Se paga en la cuenta de {quienFactura}.</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={seleccion}
              onValueChange={(v) => {
                if (v === "contrato" && contratoTitular) {
                  onCambiar(contratoTitular)
                  onArchivo(null)
                }
              }}
            >
              <SelectTrigger className="w-full max-w-xl">
                <SelectValue placeholder={contratoTitular ? "Elige a quién se deposita" : "El contrato no estipula otro tercero"} />
              </SelectTrigger>
              <SelectContent>
                {contratoTitular && (
                  <SelectItem value="contrato">
                    {contratoTitular.nombre} · {contratoTitular.cuentaTexto} (estipulado en el contrato)
                  </SelectItem>
                )}
                {esNuevo && valor.terceroId && (
                  <SelectItem value="nuevo">
                    {valor.nombre} · {valor.cuentaTexto} (nuevo)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={() => setDialogo(true)}>
              <UserPlus className="size-4" /> Pagar a alguien nuevo
            </Button>
          </div>
          {!contratoTitular && !valor.terceroId && (
            <p className="text-xs text-muted-foreground">
              El contrato no estipula otro tercero: usa «Pagar a alguien nuevo».
            </p>
          )}
          {valor.terceroId && valor.cuentaId && !valor.cuentaVerificada && (
            <p className="text-xs text-amber-700">A&F todavía no ha verificado esta cuenta: lo revisará antes de pagar.</p>
          )}
          {esNuevo && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="flex items-center gap-1.5">
                <FileText className="size-3.5" />
                {archivo
                  ? `Autorización: ${archivo.name}`
                  : autorizacionGuardada
                    ? "Autorización ya adjunta en el acta."
                    : "Falta la autorización firmada (usa «Pagar a alguien nuevo»)."}
              </p>
              <p className="mt-1">Jurídica debe autorizarlo: hasta entonces el pago no pasa a Aprobación de pagos.</p>
            </div>
          )}
        </div>
      )}
      {dialogo && (
        <DialogoNuevoTercero
          contratoTitularId={contratoTitular?.terceroId ?? null}
          onCancelar={() => setDialogo(false)}
          onElegir={(t, f) => {
            onCambiar(t)
            onArchivo(f)
            setDialogo(false)
          }}
          onEsElDelContrato={() => {
            if (contratoTitular) onCambiar(contratoTitular)
            onArchivo(null)
            setDialogo(false)
          }}
        />
      )}
    </div>
  )
}

function DialogoNuevoTercero({
  contratoTitularId,
  onCancelar,
  onElegir,
  onEsElDelContrato,
}: {
  contratoTitularId: string | null
  onCancelar: () => void
  onElegir: (t: TitularCuenta, archivo: File) => void
  onEsElDelContrato: () => void
}) {
  const [borrador, setBorrador] = useState<TitularCuenta>(titularVacio())
  const [archivo, setArchivo] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esElDelContrato = Boolean(borrador.terceroId) && borrador.terceroId === contratoTitularId

  function confirmar() {
    if (!borrador.terceroId) return setError("Busca y elige el tercero (inscrito en Terceros).")
    if (!borrador.cuentaId) return setError("Elige la cuenta del tercero.")
    if (!archivo) return setError("Adjunta la autorización firmada para depositar a este tercero.")
    onElegir(borrador, archivo)
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCancelar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pagar a alguien nuevo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <CampoTitularCuenta
            valor={borrador}
            onCambiar={(v) => {
              setBorrador(v ?? titularVacio())
              setError(null)
            }}
            sinCasilla
          />
          {esElDelContrato ? (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              Este es el tercero que ya estipula el contrato: no necesita autorización.{" "}
              <button type="button" className="font-medium text-primary underline" onClick={onEsElDelContrato}>
                Usar el del contrato
              </button>
            </p>
          ) : (
            <div className="space-y-1">
              <label htmlFor="autorizacion-tercero" className="text-sm font-medium">
                Autorización firmada para depositar a este tercero *
              </label>
              <input
                id="autorizacion-tercero"
                type="file"
                accept={MIME_SOPORTES.join(",")}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  const problema = f ? validarSoporte(f) : null
                  if (problema) {
                    setError(`${f!.name}: ${problema}`)
                    setArchivo(null)
                    e.target.value = ""
                    return
                  }
                  setError(null)
                  setArchivo(f)
                }}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Se avisa a Jurídica; el pago pasa a Aprobación de pagos cuando lo autorice.
              </p>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          {!esElDelContrato && <Button onClick={confirmar}>Usar este tercero</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
