"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { textoCuenta, type CuentaReqAdmin } from "@/lib/requisiciones-admin"
import { titularVacio, type TitularCuenta } from "@/lib/titular-cuenta"
import {
  buscarTercerosRequisicionAdmin,
  cuentasTerceroRequisicionAdmin,
} from "@/app/(app)/ayf/requisiciones-administrativas/actions"

// Casilla "El titular de la cuenta es otro tercero" (como en la requisición
// administrativa): sin marcar, el pago va a la cuenta de quien factura; marcada,
// se elige el titular (de Terceros) y una de sus cuentas.
export function CampoTitularCuenta({
  valor,
  onCambiar,
  quienFactura,
}: {
  valor: TitularCuenta | null
  onCambiar: (v: TitularCuenta | null) => void
  quienFactura?: string | null
}) {
  const [cuentas, setCuentas] = useState<{ terceroId: string; lista: CuentaReqAdmin[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const terceroId = valor?.terceroId ?? null
  const lista = cuentas && cuentas.terceroId === terceroId ? cuentas.lista : null
  const cargando = Boolean(terceroId) && lista === null && !error

  useEffect(() => {
    if (!terceroId) return
    let vigente = true
    cuentasTerceroRequisicionAdmin(terceroId)
      .then((l: CuentaReqAdmin[]) => {
        if (!vigente) return
        setError(null)
        setCuentas({ terceroId, lista: l })
      })
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar las cuentas."))
    return () => {
      vigente = false
    }
  }, [terceroId])

  // Una sola cuenta: se elige sola.
  useEffect(() => {
    if (valor && !valor.cuentaId && lista && lista.length === 1) {
      onCambiar({ ...valor, cuentaId: lista[0].id, cuentaTexto: textoCuenta(lista[0]), cuentaVerificada: lista[0].verificada })
    }
  }, [lista, valor, onCambiar])

  const seleccionado: OpcionBuscador | null = valor?.terceroId
    ? { id: valor.terceroId, etiqueta: valor.nombre, subetiqueta: valor.documento || null }
    : null

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={valor !== null} onCheckedChange={(v) => onCambiar(v ? titularVacio() : null)} />
        El titular de la cuenta es otro tercero
      </label>
      {valor === null ? (
        quienFactura ? (
          <p className="text-xs text-muted-foreground">Se paga en la cuenta de {quienFactura}.</p>
        ) : null
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label>Titular de la cuenta</Label>
            <BuscadorAsync
              placeholder="Nombre o documento del titular"
              valorSeleccionado={seleccionado}
              onSeleccionar={(o) =>
                onCambiar({
                  ...titularVacio(),
                  terceroId: o?.id ?? null,
                  nombre: o?.etiqueta ?? "",
                  documento: o?.subetiqueta ?? "",
                })
              }
              buscar={buscarTercerosRequisicionAdmin}
            />
            <p className="text-xs text-muted-foreground">Si no aparece, pídele a A&F que lo inscriba en Terceros.</p>
          </div>
          {valor.terceroId && (
            <div className="min-w-0 space-y-1.5">
              <Label>Cuenta de {valor.nombre || "el titular"}</Label>
              {cargando ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Cargando cuentas…
                </p>
              ) : error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : lista && lista.length === 0 ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Este tercero no tiene cuentas registradas. Pídele a A&F que la registre en Terceros.
                </p>
              ) : (
                <Select
                  value={valor.cuentaId ?? ""}
                  onValueChange={(v) => {
                    const c = lista?.find((x) => x.id === v)
                    if (c) onCambiar({ ...valor, cuentaId: c.id, cuentaTexto: textoCuenta(c), cuentaVerificada: c.verificada })
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Elige la cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {(lista ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {textoCuenta(c)}
                        {c.verificada ? "" : " (sin verificar)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {valor.cuentaId && !valor.cuentaVerificada && (
                <p className="text-xs text-amber-700">A&F todavía no ha verificado esta cuenta: lo revisará antes de pagar.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
