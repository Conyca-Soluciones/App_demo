"use client"

import { useState } from "react"
import { FileText, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CampoTitularCuenta } from "@/components/campo-titular-cuenta"
import { titularVacio, type TitularCuenta } from "@/lib/titular-cuenta"
import { MIME_SOPORTES, validarSoporte, pideAutorizacionTercero } from "@/lib/actas"

// "¿A qué cuenta se deposita?" en el acta (20270101000700):
// - Por defecto, la cuenta de otro tercero que estipula el contrato; si no
//   estipula ninguna, la del contratista. La lista deja cambiar entre ellas.
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
  // El último "alguien nuevo" elegido, para poder volver a él en la lista.
  const [nuevoElegido, setNuevoElegido] = useState<TitularCuenta | null>(esNuevo ? valor : null)
  const seleccion = valor === null ? "contratista" : esNuevo ? "nuevo" : "contrato"
  // Al corregir un acta, su tercero nuevo llega después de montar: sale de valor.
  const opcionNueva = esNuevo ? valor : nuevoElegido

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">¿A qué cuenta se deposita?</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={seleccion}
          onValueChange={(v) => {
            if (esNuevo) setNuevoElegido(valor) // para poder volver a él
            if (v === "contratista") {
              onCambiar(null)
              onArchivo(null)
            } else if (v === "contrato" && contratoTitular) {
              onCambiar(contratoTitular)
              onArchivo(null)
            } else if (v === "nuevo" && opcionNueva) {
              onCambiar(opcionNueva)
            }
          }}
        >
          <SelectTrigger className="w-full max-w-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {contratoTitular && (
              <SelectItem value="contrato">
                {contratoTitular.nombre} · {contratoTitular.cuentaTexto} (estipulada en el contrato)
              </SelectItem>
            )}
            <SelectItem value="contratista">Cuenta de {quienFactura} (contratista)</SelectItem>
            {opcionNueva?.terceroId && (
              <SelectItem value="nuevo">
                {opcionNueva.nombre} · {opcionNueva.cuentaTexto} (nuevo)
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" onClick={() => setDialogo(true)}>
          <UserPlus className="size-4" /> Pagar a alguien nuevo
        </Button>
      </div>
      {valor?.terceroId && valor.cuentaId && !valor.cuentaVerificada && (
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
      {dialogo && (
        <DialogoNuevoTercero
          contratoTitularId={contratoTitular?.terceroId ?? null}
          onCancelar={() => setDialogo(false)}
          onElegir={(t, f) => {
            setNuevoElegido(t)
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
