"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { textoCuenta, type CuentaReqAdmin } from "@/lib/requisiciones-admin"
import type { EleccionPagoActa, TerceroPagoActa } from "@/lib/actas"
import {
  buscarTercerosRequisicionAdmin,
  cuentasTerceroRequisicionAdmin,
} from "@/app/(app)/ayf/requisiciones-administrativas/actions"

const SIN_CUENTA = "__automatica__"

// Tercero que factura y cuenta del pago del acta, como en las requisiciones
// administrativas por transferencia: el tercero se busca en Terceros (se
// propone el del documento del contratista) y, si la cuenta es de otra
// persona, se marca la casilla y se busca al titular. Sin cuenta elegida la
// base pone la única verificada del tercero o la elige A&F.
export function CuentaPagoActa({
  valor,
  onCambiar,
  deshabilitado,
}: {
  valor: EleccionPagoActa
  onCambiar: (v: EleccionPagoActa) => void
  deshabilitado?: boolean
}) {
  const titularId = valor.titularDistinto ? (valor.titular?.id ?? null) : (valor.tercero?.id ?? null)
  // Cuentas guardadas con el tercero al que pertenecen.
  const [cuentas, setCuentas] = useState<{ terceroId: string; lista: CuentaReqAdmin[] } | null>(null)
  const [errorCuentas, setErrorCuentas] = useState<{ terceroId: string; mensaje: string } | null>(null)
  const cuentasDelTitular = cuentas && cuentas.terceroId === titularId ? cuentas.lista : null
  const error = errorCuentas && errorCuentas.terceroId === titularId ? errorCuentas.mensaje : null
  const cargando = Boolean(titularId) && cuentasDelTitular === null && !error

  useEffect(() => {
    if (!titularId) return
    let vigente = true
    cuentasTerceroRequisicionAdmin(titularId)
      .then((lista: CuentaReqAdmin[]) => vigente && setCuentas({ terceroId: titularId, lista }))
      .catch((e) => vigente && setErrorCuentas({ terceroId: titularId, mensaje: e instanceof Error ? e.message : "No se pudieron cargar las cuentas." }))
    return () => {
      vigente = false
    }
  }, [titularId])

  const comoTercero = (o: OpcionBuscador | null): TerceroPagoActa | null =>
    o ? { id: o.id, etiqueta: o.etiqueta, subetiqueta: o.subetiqueta ?? "" } : null

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">Pago</p>
        <p className="text-xs text-muted-foreground">
          A quién se le paga el acta. Si el tercero no aparece, pídele a A&F que lo inscriba en Terceros.
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm">Tercero que factura</label>
        <BuscadorAsync
          placeholder="Nombre o documento del tercero"
          valorSeleccionado={valor.tercero}
          onSeleccionar={(o) => onCambiar({ ...valor, tercero: comoTercero(o), cuentaId: valor.titularDistinto ? valor.cuentaId : null })}
          buscar={buscarTercerosRequisicionAdmin}
          disabled={deshabilitado}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={valor.titularDistinto}
          disabled={deshabilitado || !valor.tercero}
          onCheckedChange={(v) => onCambiar({ ...valor, titularDistinto: Boolean(v), titular: null, cuentaId: null })}
        />
        El titular de la cuenta es otro tercero
      </label>
      {valor.titularDistinto && (
        <div className="space-y-1.5">
          <label className="text-sm">Titular de la cuenta</label>
          <BuscadorAsync
            placeholder="Nombre o documento del titular"
            valorSeleccionado={valor.titular}
            onSeleccionar={(o) => onCambiar({ ...valor, titular: comoTercero(o), cuentaId: null })}
            buscar={buscarTercerosRequisicionAdmin}
            disabled={deshabilitado}
          />
        </div>
      )}
      {titularId && (
        <div className="space-y-1.5">
          <label className="text-sm">
            Cuenta de {(valor.titularDistinto ? valor.titular?.etiqueta : valor.tercero?.etiqueta) ?? "el titular"}
          </label>
          {cargando ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando cuentas…
            </p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : cuentasDelTitular && cuentasDelTitular.length === 0 ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Este tercero no tiene cuentas registradas. Pídele a A&F que la registre en Terceros.
            </p>
          ) : (
            <Select
              value={valor.cuentaId ?? (valor.titularDistinto ? "" : SIN_CUENTA)}
              onValueChange={(v) => onCambiar({ ...valor, cuentaId: v && v !== SIN_CUENTA ? String(v) : null })}
              disabled={deshabilitado}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elige la cuenta" />
              </SelectTrigger>
              <SelectContent>
                {!valor.titularDistinto && (
                  <SelectItem value={SIN_CUENTA}>Automática (su cuenta verificada, o la elige A&F)</SelectItem>
                )}
                {(cuentasDelTitular ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {textoCuenta(c)}
                    {c.verificada ? "" : " (sin verificar)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {valor.cuentaId && cuentasDelTitular?.some((c) => c.id === valor.cuentaId && !c.verificada) && (
            <p className="text-xs text-amber-700">A&F todavía no ha verificado esta cuenta: lo revisará antes de pagar.</p>
          )}
        </div>
      )}
    </div>
  )
}
