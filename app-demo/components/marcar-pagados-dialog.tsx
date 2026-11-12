"use client"

import { useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import { extensionArchivo, revisarArchivoTercero } from "@/lib/archivos-tercero"
import { formatoMoneda } from "@/lib/pagos"
import { formatearFechaSinHora, hoyColombia } from "@/lib/fechas"
import { marcarPagosPagados } from "@/app/(app)/ayf/realizar-pagos/actions"
import type { CuentaEmpresa } from "@/lib/dispersores/pagos-dispersor"

export type PagoPorMarcar = { id: string; valor: number; titulo: string }

// "Marcar como pagado": pagos por PSE (Consolidado › PSE) o por otro medio
// (Realizar Pagos). Se escoge la cuenta desde la que se pagó (las cuentas de
// empresa del dispersor); quedan pagados con la fecha de hoy y, si se adjunta,
// con el comprobante (bucket dispersores, carpeta pse/). 20270101000300/400.
export function MarcarPagadosDialog({
  pagos,
  cuentas,
  ayuda,
  onCerrar,
  onHecho,
}: {
  pagos: PagoPorMarcar[] | null // null = cerrada
  cuentas: CuentaEmpresa[]
  ayuda?: string
  onCerrar: () => void
  onHecho: (n: number) => void
}) {
  const [banco, setBanco] = useState("")
  const [cuentaId, setCuentaId] = useState("")
  const [archivo, setArchivo] = useState<File | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const archivoRef = useRef<HTMLInputElement>(null)

  const bancos = useMemo(() => [...new Set(cuentas.map((c) => c.banco))].sort(), [cuentas])
  const lista = pagos ?? []
  const total = lista.reduce((a, p) => a + p.valor, 0)

  function limpiar() {
    setBanco("")
    setCuentaId("")
    setArchivo(null)
    setError(null)
  }

  async function guardar() {
    if (lista.length === 0 || !cuentaId) return
    setOcupado(true)
    setError(null)
    const supabase = createClient()
    let ruta: string | null = null
    try {
      if (archivo) {
        const intento = `pse/${crypto.randomUUID()}/${crypto.randomUUID()}.${extensionArchivo(archivo)}`
        const { error: e } = await supabase.storage.from("dispersores").upload(intento, archivo, { contentType: archivo.type, upsert: false })
        if (e) throw new Error(`No se pudo subir el comprobante: ${e.message}`)
        ruta = intento
      }
      const n = await marcarPagosPagados(
        lista.map((p) => p.id),
        cuentaId,
        ruta && archivo ? { ruta, nombre: archivo.name, mime: archivo.type } : null
      )
      if (n === 0) throw new Error("Ningún pago quedó marcado: puede que ya estén pagados o que ya no estén por pagar.")
      limpiar()
      onHecho(n)
    } catch (e) {
      if (ruta) await supabase.storage.from("dispersores").remove([ruta])
      setError(e instanceof Error ? e.message : "No se pudieron marcar los pagos.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Dialog
      open={pagos !== null}
      onOpenChange={(a) => {
        if (a || ocupado) return
        limpiar()
        onCerrar()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lista.length === 1 ? "Marcar como pagado" : `Marcar ${lista.length} pagos como pagados`}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {lista.length === 1 ? `${lista[0].titulo} · ${formatoMoneda(total)}.` : `Total ${formatoMoneda(total)}.`} Quedan pagados con fecha de hoy (
          {formatearFechaSinHora(hoyColombia())}).{ayuda ? ` ${ayuda}` : ""}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Banco desde el que se pagó</Label>
            <Select
              value={banco}
              onValueChange={(v) => {
                setBanco(v ?? "")
                setCuentaId("")
              }}
            >
              <SelectTrigger className="w-full" aria-label="Banco desde el que se pagó">
                <SelectValue placeholder="Escoge" />
              </SelectTrigger>
              <SelectContent>
                {bancos.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Cuenta a debitar</Label>
            <Select value={cuentaId} onValueChange={(v) => setCuentaId(v ?? "")} disabled={!banco}>
              <SelectTrigger className="w-full" aria-label="Cuenta a debitar">
                <SelectValue placeholder="Escoge" />
              </SelectTrigger>
              <SelectContent>
                {cuentas
                  .filter((c) => c.banco === banco)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.apodo} · {c.tipoCuenta.toLowerCase()} {c.cuenta.slice(-4)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Comprobante (opcional)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={ocupado} onClick={() => archivoRef.current?.click()}>
              {archivo ? "Cambiar archivo" : "Adjuntar archivo"}
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{archivo ? archivo.name : "PDF, JPG o PNG de hasta 10 MB"}</span>
            {archivo && (
              <Button type="button" variant="ghost" size="sm" disabled={ocupado} onClick={() => setArchivo(null)}>
                Quitar
              </Button>
            )}
          </div>
          <input
            ref={archivoRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (!f) return
              const problema = revisarArchivoTercero(f, "El comprobante")
              setError(problema)
              if (!problema) setArchivo(f)
            }}
          />
        </div>
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={ocupado}
            onClick={() => {
              limpiar()
              onCerrar()
            }}
          >
            Cancelar
          </Button>
          <Button disabled={ocupado || !cuentaId || lista.length === 0} onClick={guardar}>
            {ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {ocupado ? "Guardando..." : "Marcar como pagado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
