"use client"

import { ArrowRightLeft, Globe, Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TIPOS_DOCUMENTO_PSE } from "@/lib/requisiciones-admin"
import {
  cuentaProveedorElegida,
  textoCuentaProveedor,
  type CuentasProveedorOC,
  type MetodoPagoOC,
  type PagoOCForm,
} from "@/lib/metodo-pago-oc"

const METODOS: { valor: MetodoPagoOC; titulo: string; descripcion: string; icono: typeof Globe }[] = [
  { valor: "transferencia", titulo: "Transferencia", descripcion: "A la cuenta registrada en Terceros.", icono: ArrowRightLeft },
  { valor: "pse", titulo: "PSE", descripcion: "Sin cuenta bancaria.", icono: Globe },
]

// Método de pago en Generar OC (lib/metodo-pago-oc.ts). Las cuentas del
// proveedor (de Terceros) las carga la pantalla: info null = cargando.
// `children` va debajo en transferencia (la casilla del titular aparte).
export function MetodoPagoOC({
  valor,
  onCambiar,
  info,
  errorCuentas,
  proveedorNombre,
  conTitularAparte,
  children,
}: {
  valor: PagoOCForm
  onCambiar: (v: PagoOCForm) => void
  info: CuentasProveedorOC | null
  errorCuentas: string | null
  proveedorNombre: string
  conTitularAparte: boolean
  children?: React.ReactNode
}) {
  const cambiar = (c: Partial<PagoOCForm>) => onCambiar({ ...valor, ...c })
  const elegida = cuentaProveedorElegida(valor, info)

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">¿Cómo se paga?</p>
      <div className="grid grid-cols-2 gap-2">
        {METODOS.map((m) => {
          const Icono = m.icono
          const activo = valor.metodo === m.valor
          return (
            <button
              key={m.valor}
              type="button"
              onClick={() => cambiar({ metodo: m.valor })}
              className={`flex items-start gap-2 rounded-lg border p-2 text-left transition-colors ${
                activo ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
              }`}
            >
              <Icono className={`mt-0.5 size-4 shrink-0 ${activo ? "text-primary" : "text-muted-foreground"}`} />
              <span>
                <span className="block text-sm font-medium">{m.titulo}</span>
                <span className="block text-xs text-muted-foreground">{m.descripcion}</span>
              </span>
            </button>
          )
        })}
      </div>

      {valor.metodo === "transferencia" ? (
        <div className="space-y-3">
          {!conTitularAparte && (
            <div className="space-y-1.5 text-sm">
              <Label>Cuenta de {proveedorNombre}</Label>
              {errorCuentas ? (
                <p className="text-destructive">{errorCuentas}</p>
              ) : !info ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Buscando la cuenta en Terceros…
                </p>
              ) : !info.terceroId ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
                  Falta la información bancaria: el proveedor no está inscrito en Terceros. La orden se puede generar;
                  A&amp;F lo inscribe con su cuenta antes de pagar.
                </p>
              ) : info.cuentas.length === 0 ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
                  Falta la información bancaria: el proveedor no tiene cuenta registrada en Terceros. La orden se
                  puede generar; A&amp;F registra la cuenta antes de pagar.
                </p>
              ) : info.cuentas.length === 1 ? (
                <p className="rounded-md border bg-muted/40 px-3 py-2">{textoCuentaProveedor(info.cuentas[0])}</p>
              ) : (
                <Select value={valor.cuentaId ?? ""} onValueChange={(v) => cambiar({ cuentaId: String(v ?? "") || null })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Elige la cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {info.cuentas.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {textoCuentaProveedor(c)}
                        {c.verificada ? "" : " (sin verificar)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {elegida && !elegida.verificada && (
                <p className="text-xs text-amber-700">A&amp;F todavía no ha verificado esta cuenta: lo revisará antes de pagar.</p>
              )}
            </div>
          )}
          {children}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pse-observaciones">Observaciones del pago (opcional)</Label>
            <Textarea
              id="pse-observaciones"
              rows={2}
              value={valor.observaciones}
              onChange={(e) => cambiar({ observaciones: e.target.value })}
              placeholder="Lo que A&F necesita saber para pagar por PSE"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={valor.titularDistinto}
              onCheckedChange={(v) =>
                cambiar({ titularDistinto: Boolean(v), titularNombre: "", titularTipoDocumento: "", titularDocumento: "" })
              }
            />
            El titular no es {proveedorNombre}
          </label>
          {valor.titularDistinto ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pse-titular">Titular</Label>
                <Input id="pse-titular" value={valor.titularNombre} onChange={(e) => cambiar({ titularNombre: e.target.value })} />
              </div>
              <div className="grid grid-cols-[6.5rem_1fr] gap-2">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={valor.titularTipoDocumento} onValueChange={(v) => cambiar({ titularTipoDocumento: String(v ?? "") })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_DOCUMENTO_PSE.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pse-documento">NIT o CC del titular</Label>
                  <Input
                    id="pse-documento"
                    inputMode="numeric"
                    value={valor.titularDocumento}
                    onChange={(e) => cambiar({ titularDocumento: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">El titular del pago es {proveedorNombre}.</p>
          )}
        </div>
      )}
    </div>
  )
}
