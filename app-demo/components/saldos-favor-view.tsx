"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Loader2, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { pedirTexto } from "@/components/ui/confirmar"
import { formatearFechaHora } from "@/lib/fechas"
import { ETIQUETA_ESTADO_SALDO, estadoSaldo, type SaldoFavor } from "@/lib/saldo-favor"
import { cerrarSaldoFavor, listarSaldosFavor } from "@/app/(app)/almacen/ordenes-compra/saldos-actions"

// ---------------------------------------------------------------------------
// Saldos a favor de proveedores (Paquete C). Cada saldo sale de una OC cerrada
// con faltante; se usa al crear otra OC al mismo proveedor en la misma empresa
// ("Usar saldo a favor" en Generar OC) o Compras lo cierra con motivo
// (diferencias de redondeo, el proveedor devolvió el dinero...).
// ---------------------------------------------------------------------------

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const CLASE_ESTADO = {
  disponible: "border-emerald-300 bg-emerald-50 text-emerald-800",
  parcial: "border-amber-300 bg-amber-50 text-amber-800",
  usado: "border-gray-300 bg-gray-50 text-gray-600",
  cerrado: "border-gray-300 bg-gray-50 text-gray-600",
} as const
const ESTADO_OC: Record<string, string> = { cancelada: " (cancelada: no cuenta)", rechazada: " (rechazada: no cuenta)" }

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

export function SaldosFavorView({ puedeCerrar }: { puedeCerrar: boolean }) {
  const [soloDisponibles, setSoloDisponibles] = useState(true)
  const [carga, setCarga] = useState<{ clave: string; saldos: SaldoFavor[] | null; error: string | null } | null>(null)
  const [version, setVersion] = useState(0)
  const [busqueda, setBusqueda] = useState("")
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const clave = `${soloDisponibles}-${version}`

  useEffect(() => {
    let vigente = true
    listarSaldosFavor(soloDisponibles)
      .then((s: SaldoFavor[]) => vigente && setCarga({ clave, saldos: s, error: null }))
      .catch((e) => vigente && setCarga({ clave, saldos: null, error: e instanceof Error ? e.message : "No se pudieron cargar los saldos." }))
    return () => {
      vigente = false
    }
  }, [soloDisponibles, clave])

  const actual = carga?.clave === clave ? carga : null
  const q = sinTildes(busqueda.trim())
  const lista = useMemo(() => {
    const s = actual?.saldos ?? []
    return q ? s.filter((x) => sinTildes(`${x.proveedor} ${x.empresa ?? ""} ${x.ordenOrigen}`).includes(q)) : s
  }, [actual, q])
  const totalDisponible = lista.reduce((a, s) => a + s.disponible, 0)

  async function cerrar(s: SaldoFavor) {
    const motivo = await pedirTexto(
      `Saldo de ${s.proveedor} (${s.ordenOrigen}): quedan ${pesos.format(s.disponible)}. Al cerrarlo ya no se puede usar; queda en el historial de la orden.`,
      { titulo: "Cerrar saldo a favor", etiqueta: "Motivo (por ejemplo: el proveedor devolvió el dinero)", boton: "Cerrar saldo", peligro: true, minimo: 3 }
    )
    if (!motivo) return
    setOcupado(s.id)
    setAviso(null)
    try {
      await cerrarSaldoFavor(s.id, motivo)
      setAviso(`Saldo de ${s.proveedor} cerrado.`)
      setVersion((v) => v + 1)
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo cerrar el saldo.")
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          aria-label="Buscar proveedor, empresa u orden"
          placeholder="Buscar proveedor, empresa u orden"
          className="h-9 w-72"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="size-4" checked={soloDisponibles} onChange={(e) => setSoloDisponibles(e.target.checked)} />
          Solo con saldo disponible
        </label>
        <span className="text-muted-foreground">
          {actual?.saldos ? `${lista.length} ${lista.length === 1 ? "saldo" : "saldos"} · disponible ${pesos.format(totalDisponible)}` : ""}
        </span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setVersion((v) => v + 1)} disabled={!actual}>
          {!actual ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <RefreshCw className="mr-1.5 size-4" />} Actualizar
        </Button>
      </div>

      {aviso && <div className="rounded-md border bg-muted/40 px-3 py-2">{aviso}</div>}
      {actual?.error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive">{actual.error}</div>}

      {!actual ? (
        <p className="flex items-center text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Cargando…
        </p>
      ) : actual.saldos && lista.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          {q ? "Ningún saldo coincide con la búsqueda." : soloDisponibles ? "No hay saldos a favor disponibles." : "No hay saldos a favor."}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full min-w-[880px]">
            <thead className="sticky top-0 bg-primary text-left text-xs text-primary-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Proveedor</th>
                <th className="px-3 py-2 font-medium">Empresa</th>
                <th className="px-3 py-2 font-medium">Sale de</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="px-3 py-2 text-right font-medium">Disponible</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Usado en</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {lista.map((s) => {
                const estado = estadoSaldo(s)
                return (
                  <tr key={s.id} className="align-top">
                    <td className="px-3 py-2 font-medium">{s.proveedor}</td>
                    <td className="px-3 py-2">{s.empresa ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Link className="text-primary underline-offset-2 hover:underline" href={`/almacen/ordenes-compra/${s.ordenOrigenId}`}>
                        {s.ordenOrigen}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {formatearFechaHora(s.creadoAt)}
                        {s.creadoPor ? ` · ${s.creadoPor}` : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{pesos.format(s.valor)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{pesos.format(s.disponible)}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={CLASE_ESTADO[estado]}>
                        {ETIQUETA_ESTADO_SALDO[estado]}
                      </Badge>
                      {s.cerradoAt && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {formatearFechaHora(s.cerradoAt)}
                          {s.cerradoPor ? ` · ${s.cerradoPor}` : ""}
                          {s.motivoCierre ? `: ${s.motivoCierre}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {s.aplicaciones.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        s.aplicaciones.map((a, i) => (
                          <div key={i} className="whitespace-nowrap">
                            <Link className="text-primary underline-offset-2 hover:underline" href={`/almacen/ordenes-compra/${a.ordenId}`}>
                              {a.orden}
                            </Link>{" "}
                            {pesos.format(a.valor)}
                            <span className="text-xs text-muted-foreground">{ESTADO_OC[a.estado] ?? ""}</span>
                          </div>
                        ))
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {puedeCerrar && !s.cerradoAt && s.disponible > 0 && (
                        <Button size="sm" variant="outline" className="h-7 text-destructive" disabled={ocupado !== null} onClick={() => cerrar(s)}>
                          {ocupado === s.id ? <Loader2 className="size-3.5 animate-spin" /> : "Cerrar saldo"}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
