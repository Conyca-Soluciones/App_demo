"use client"

import { useEffect, useMemo, useState } from "react"
import { FileText, Loader2, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { CampoSoporte } from "@/components/campo-soporte"
import { pedirTexto } from "@/components/ui/confirmar"
import { createClient } from "@/lib/supabase/client"
import { leerNumero } from "@/lib/contratos"
import { formatearFechaSinHora, hoyColombia } from "@/lib/fechas"
import { rutaSoporte } from "@/lib/soportes"
import {
  cantidadMostrada,
  formFacturaVacio,
  modoFacturacion,
  pendientePorLinea,
  referenciaSeleccion,
  resumenFacturacion,
  validarFactura,
  type FacturaOrden,
  type FormFactura,
  type LineaParaFactura,
} from "@/lib/facturas-oc"
import { anularFacturaOrden, enlaceFacturaOrden, listarFacturasOrden, registrarFacturaOrden } from "@/app/(app)/almacen/ordenes-compra/facturas-actions"

// ---------------------------------------------------------------------------
// Facturas de la orden de compra (Paquete C, entrega 1). En el detalle de la
// OC: un resumen (facturado / pendiente) y la ventana con la lista y el
// formulario. Una factura total o, marcando "Factura parcial", varias con los
// insumos y cantidades que incluye cada una. Compras registra y anula; los
// demás que ven la orden (A&F desde el pago) solo consultan.
// ---------------------------------------------------------------------------

export type LineaFacturable = LineaParaFactura & {
  insumoCodigo: number
  insumoDescripcion: string
  // Unidad que muestra la orden (presentación o unidad del insumo).
  unidad: string | null
}

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 })
const cantidad = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })

export function FacturasOrden({
  ordenId,
  aprobada,
  puedeRegistrar,
  lineas,
  totalOrden,
}: {
  ordenId: string
  aprobada: boolean
  puedeRegistrar: boolean
  lineas: LineaFacturable[]
  totalOrden: number
}) {
  const [facturas, setFacturas] = useState<FacturaOrden[] | null | undefined>(undefined)
  const [abierta, setAbierta] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let vigente = true
    listarFacturasOrden(ordenId)
      .then((f: FacturaOrden[] | null) => vigente && setFacturas(f))
      .catch((e) => vigente && (setFacturas([]), setError(e instanceof Error ? e.message : "No se pudieron cargar las facturas.")))
    return () => {
      vigente = false
    }
  }, [ordenId, version])

  // Sin la migración (null) la sección no aparece; antes de aprobar tampoco hay nada que mostrar.
  if (facturas === null) return null
  const lista = facturas ?? []
  const vigentes = lista.filter((f) => !f.anulada)
  if (!aprobada && vigentes.length === 0) return null

  const { facturado, pendiente } = resumenFacturacion(totalOrden, lista)
  const modo = modoFacturacion(lista)

  return (
    <div className="space-y-1 border-t pt-3">
      <p className="text-muted-foreground">Facturas</p>
      {facturas === undefined ? (
        <p className="flex items-center text-xs text-muted-foreground">
          <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Cargando…
        </p>
      ) : (
        <>
          <p className="text-xs">
            {vigentes.length === 0
              ? "Sin facturas registradas."
              : `${vigentes.length} ${vigentes.length === 1 ? "factura" : "facturas"}${modo === "parciales" ? " parciales" : ""} · facturado ${pesos.format(facturado)}`}
          </p>
          {vigentes.length > 0 && pendiente > 0 && <p className="text-xs text-muted-foreground">Falta por facturar {pesos.format(pendiente)}</p>}
          <Button size="sm" variant="outline" className="h-7" onClick={() => setAbierta(true)}>
            <FileText className="mr-1.5 size-3.5" />
            {puedeRegistrar && aprobada && modo !== "total_hecha" ? "Ver y registrar facturas" : "Ver facturas"}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}
      <Dialog open={abierta} onOpenChange={(v) => !v && setAbierta(false)}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Facturas de la orden</DialogTitle>
          </DialogHeader>
          <VentanaFacturas
            ordenId={ordenId}
            facturas={lista}
            lineas={lineas}
            totalOrden={totalOrden}
            puedeRegistrar={puedeRegistrar && aprobada}
            onCambio={() => setVersion((v) => v + 1)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

function VentanaFacturas({
  ordenId,
  facturas,
  lineas,
  totalOrden,
  puedeRegistrar,
  onCambio,
}: {
  ordenId: string
  facturas: FacturaOrden[]
  lineas: LineaFacturable[]
  totalOrden: number
  puedeRegistrar: boolean
  onCambio: () => void
}) {
  const [formAbierto, setFormAbierto] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const porId = useMemo(() => new Map(lineas.map((l) => [l.id, l])), [lineas])
  const { facturado, pendiente } = resumenFacturacion(totalOrden, facturas)
  const modo = modoFacturacion(facturas)

  async function verArchivo(f: FacturaOrden) {
    // La pestaña se abre antes de pedir el enlace (si no, el navegador la bloquea).
    const ventana = window.open("", "_blank")
    try {
      const url = await enlaceFacturaOrden(f.id)
      if (ventana) ventana.location.href = url
      else window.location.assign(url)
    } catch (e) {
      ventana?.close()
      setError(e instanceof Error ? e.message : "No se pudo abrir la factura.")
    }
  }

  async function anular(f: FacturaOrden) {
    const motivo = await pedirTexto(`Factura del ${formatearFechaSinHora(f.fecha)} por ${pesos.format(f.total)}. Queda en el historial; el archivo se conserva.`, {
      titulo: "Anular factura",
      etiqueta: "Motivo",
      boton: "Anular",
      peligro: true,
      minimo: 3,
    })
    if (!motivo) return
    setOcupado(f.id)
    setError(null)
    setAviso(null)
    try {
      await anularFacturaOrden(f.id, motivo)
      setAviso("Factura anulada.")
      onCambio()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular la factura.")
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-muted/30 px-3 py-2">
        <span>
          Total de la orden <span className="font-medium tabular-nums">{pesos.format(Math.round(totalOrden))}</span>
        </span>
        <span>
          Facturado <span className="font-medium tabular-nums">{pesos.format(facturado)}</span>
        </span>
        <span>
          Falta por facturar <span className="font-medium tabular-nums">{pesos.format(pendiente)}</span>
        </span>
      </div>

      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive">{error}</div>}
      {aviso && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800">{aviso}</div>}

      {facturas.length === 0 ? (
        <p className="text-muted-foreground">Esta orden todavía no tiene facturas.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Fecha</th>
                <th className="px-3 py-2 font-medium">Tipo</th>
                <th className="px-3 py-2 font-medium">Insumos</th>
                <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                <th className="px-3 py-2 text-right font-medium">IVA</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {facturas.map((f) => (
                <tr key={f.id} className={f.anulada ? "text-muted-foreground" : ""}>
                  <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums">{formatearFechaSinHora(f.fecha)}</td>
                  <td className="px-3 py-2 align-top">
                    {f.parcial ? "Parcial" : "Total"}
                    {f.anulada && (
                      <Badge variant="outline" className="ml-1.5 border-red-300 text-red-700">
                        Anulada
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {f.parcial
                      ? f.items.map((i) => {
                          const l = porId.get(i.lineaId)
                          return (
                            <div key={i.lineaId}>
                              {l ? `${l.insumoDescripcion}` : "Insumo"} × {cantidad.format(i.cantidad)}
                              {l?.unidad ? ` ${l.unidad.toLowerCase()}` : ""}
                            </div>
                          )
                        })
                      : "Toda la orden"}
                    {f.observaciones && <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{f.observaciones}</p>}
                    {f.anulada && f.motivoAnulacion && <p className="mt-1 text-xs">Motivo: {f.motivoAnulacion}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {f.subidaPorNombre ?? "—"} · {f.nombreArchivo}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right align-top tabular-nums">{pesos.format(f.subtotal)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right align-top tabular-nums">{pesos.format(f.iva)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right align-top font-medium tabular-nums">{pesos.format(f.total)}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" className="h-7" onClick={() => verArchivo(f)}>
                        Ver
                      </Button>
                      {puedeRegistrar && !f.anulada && (
                        <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={ocupado !== null} onClick={() => anular(f)}>
                          {ocupado === f.id ? <Loader2 className="size-3.5 animate-spin" /> : "Anular"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {puedeRegistrar && modo !== "total_hecha" && (
        formAbierto ? (
          <FormularioFactura
            ordenId={ordenId}
            facturas={facturas}
            lineas={lineas}
            totalOrden={totalOrden}
            parcialFijo={modo === "parciales"}
            onCancelar={() => setFormAbierto(false)}
            onGuardada={() => {
              setFormAbierto(false)
              setAviso("Factura registrada.")
              setError(null)
              onCambio()
            }}
          />
        ) : (
          <Button size="sm" onClick={() => (setFormAbierto(true), setAviso(null))}>
            <Plus className="mr-1.5 size-4" /> {modo === "parciales" ? "Agregar factura parcial" : "Registrar factura"}
          </Button>
        )
      )}
    </div>
  )
}

function FormularioFactura({
  ordenId,
  facturas,
  lineas,
  totalOrden,
  parcialFijo,
  onCancelar,
  onGuardada,
}: {
  ordenId: string
  facturas: FacturaOrden[]
  lineas: LineaFacturable[]
  totalOrden: number
  parcialFijo: boolean
  onCancelar: () => void
  onGuardada: () => void
}) {
  const [parcial, setParcial] = useState(parcialFijo)
  const [form, setForm] = useState<FormFactura>(formFacturaVacio)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const pendientes = useMemo(() => pendientePorLinea(lineas, facturas), [lineas, facturas])

  const subtotal = leerNumero(form.subtotal)
  const iva = leerNumero(form.iva)
  const total = subtotal != null && iva != null ? Math.round((subtotal + iva) * 100) / 100 : null

  const elegidas = new Map<string, number>()
  for (const l of lineas) {
    const n = Number((form.cantidades[l.id] ?? "").replace(/[.,]/g, ""))
    if (Number.isFinite(n) && n > 0) elegidas.set(l.id, n)
  }
  const referencia = parcial ? referenciaSeleccion(lineas, elegidas) : null
  const noCuadra = referencia && subtotal != null && elegidas.size > 0 && Math.abs(referencia.subtotal - subtotal) > Math.max(1, referencia.subtotal * 0.01)

  const poner = (cambio: Partial<FormFactura>) => {
    setForm((f) => ({ ...f, ...cambio }))
    setError(null)
  }

  async function guardar() {
    const v = validarFactura(form, { parcial, hoy: hoyColombia(), lineas, facturas, totalOrden, conArchivo: archivo !== null })
    if (!v.ok) {
      setError(v.error)
      return
    }
    setGuardando(true)
    setError(null)
    // El archivo se sube primero; si la factura no se registra, se borra.
    const supabase = createClient()
    const ruta = rutaSoporte(`facturas/${ordenId}`, "factura", archivo!)
    let subido = false
    try {
      const { error: e } = await supabase.storage.from("ordenes_compra").upload(ruta, archivo!, { contentType: archivo!.type, upsert: false })
      if (e) throw new Error(`No se pudo subir la factura: ${e.message}`)
      subido = true
      await registrarFacturaOrden(ordenId, {
        parcial,
        fecha: v.datos.fecha,
        subtotal: v.datos.subtotal,
        iva: v.datos.iva,
        observaciones: v.datos.observaciones,
        items: v.datos.items,
        archivo: { ruta, nombreArchivo: archivo!.name, tamano: archivo!.size, mime: archivo!.type },
      })
      onGuardada()
    } catch (e) {
      if (subido) await supabase.storage.from("ordenes_compra").remove([ruta])
      setError(e instanceof Error ? e.message : "No se pudo registrar la factura.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <p className="font-medium">{parcialFijo ? "Nueva factura parcial" : "Nueva factura"}</p>

      {!parcialFijo && (
        <label className="flex w-fit cursor-pointer items-center gap-2">
          <input type="checkbox" className="size-4" checked={parcial} onChange={(e) => setParcial(e.target.checked)} disabled={guardando} />
          Factura parcial
          <span className="text-xs text-muted-foreground">(el proveedor factura la orden por partes)</span>
        </label>
      )}

      {parcial && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Escribe la cantidad de cada insumo que incluye esta factura. Solo se ofrece lo que falta por facturar.</p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Insumo</th>
                  <th className="px-3 py-2 text-right font-medium">En la orden</th>
                  <th className="px-3 py-2 text-right font-medium">Falta por facturar</th>
                  <th className="w-40 px-3 py-2 text-right font-medium">En esta factura</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lineas.map((l) => {
                  const falta = pendientes.get(l.id) ?? 0
                  return (
                    <tr key={l.id} className={falta === 0 ? "text-muted-foreground" : ""}>
                      <td className="px-3 py-2">
                        <span className="text-muted-foreground">{l.insumoCodigo}</span> {l.insumoDescripcion}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {cantidad.format(cantidadMostrada(l))} {l.unidad?.toLowerCase() ?? ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{cantidad.format(falta)}</td>
                      <td className="px-3 py-1.5">
                        {falta > 0 ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              inputMode="numeric"
                              aria-label={`Cantidad facturada de ${l.insumoDescripcion}`}
                              className="h-8 w-20 text-right"
                              placeholder="0"
                              value={form.cantidades[l.id] ?? ""}
                              disabled={guardando}
                              onChange={(e) => poner({ cantidades: { ...form.cantidades, [l.id]: e.target.value } })}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              disabled={guardando}
                              aria-label={`Facturar todo lo que falta de ${l.insumoDescripcion}`}
                              onClick={() => poner({ cantidades: { ...form.cantidades, [l.id]: String(falta) } })}
                            >
                              Todo
                            </Button>
                          </div>
                        ) : (
                          <p className="text-right text-xs">Facturado</p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {referencia && elegidas.size > 0 && (
            <p className="text-xs text-muted-foreground">
              Según los precios de la orden, estos insumos valen {pesos.format(referencia.subtotal)} + IVA {pesos.format(referencia.iva)} ={" "}
              {pesos.format(referencia.total)}.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <CampoSoporte etiqueta="Archivo de la factura" obligatorio archivo={archivo} onArchivo={setArchivo} onError={setError} disabled={guardando} />
        <div className="space-y-1.5">
          <Label htmlFor="factura-fecha">Fecha de la factura *</Label>
          <CampoFecha id="factura-fecha" value={form.fecha} max={hoyColombia()} onChange={(e) => poner({ fecha: e.target.value })} disabled={guardando} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="factura-subtotal">Subtotal *</Label>
          <Input id="factura-subtotal" inputMode="decimal" placeholder="0" value={form.subtotal} disabled={guardando} onChange={(e) => poner({ subtotal: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="factura-iva">IVA *</Label>
          <Input id="factura-iva" inputMode="decimal" placeholder="0" value={form.iva} disabled={guardando} onChange={(e) => poner({ iva: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="factura-total">Total</Label>
          <Input id="factura-total" readOnly tabIndex={-1} className="bg-muted/40 font-medium tabular-nums" value={total != null ? pesos.format(total) : ""} placeholder="Subtotal + IVA" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="factura-observaciones">Observaciones (opcional)</Label>
          <Textarea id="factura-observaciones" rows={2} value={form.observaciones} disabled={guardando} onChange={(e) => poner({ observaciones: e.target.value })} />
        </div>
      </div>

      {noCuadra && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          El subtotal no coincide con el valor de los insumos elegidos según la orden ({pesos.format(referencia!.subtotal)}). Revísalo; si la factura dice eso, puedes guardarla igual.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={guardando} onClick={onCancelar}>
          Cancelar
        </Button>
        <Button disabled={guardando} onClick={guardar}>
          {guardando && <Loader2 className="mr-1.5 size-4 animate-spin" />} Guardar factura
        </Button>
      </div>
    </div>
  )
}
