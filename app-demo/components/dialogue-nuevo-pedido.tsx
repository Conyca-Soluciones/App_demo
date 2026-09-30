"use client"

// components/dialogue-nuevo-pedido.tsx
//
// Todo el flujo de crear un pedido en un solo componente: buscar insumos y
// agregarlos al pedido (hasta MAX_INSUMOS_POR_PEDIDO), elegir para cada uno
// a qué ítem(s) del presupuesto aplica (respetando el tope de
// cantidadDisponible de cada uno), y los campos comunes del pedido (fecha,
// urgente, observaciones).

import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownFlotante } from "@/components/dropdown-flotante"
import { buscarInsumos, crearPedido } from "@/app/(app)/almacen/actions"
import {
  MAX_INSUMOS_POR_PEDIDO,
  type InsumoAgrupado,
  type LineaPedido,
} from "@/app/(app)/almacen/types"

interface SolicitudInsumoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionId: string
  onPedidoCreado?: () => void
}

// Una línea (insumo) está lista cuando tiene al menos un ítem marcado, y
// todos los marcados traen cantidad > 0 sin pasar de su tope.
function estadoLinea(linea: LineaPedido) {
  const marcados = linea.items.filter((it) => it.marcado)
  const hayExceso = marcados.some((it) => Number(it.cantidad) > it.cantidadDisponible)
  const completa = marcados.length > 0 && marcados.every((it) => Number(it.cantidad) > 0)
  return { marcados, hayExceso, lista: completa && !hayExceso }
}

export function SolicitudInsumoDialog({
  open,
  onOpenChange,
  versionId,
  onPedidoCreado,
}: SolicitudInsumoDialogProps) {
  const [fechaPedido, setFechaPedido] = useState("")
  const [fechaRequerida, setFechaRequerida] = useState("")
  const [busqueda, setBusqueda] = useState("")
  const [sugerencias, setSugerencias] = useState<InsumoAgrupado[]>([])
  const [buscando, setBuscando] = useState(false)
  const [lineas, setLineas] = useState<LineaPedido[]>([])
  const [urgente, setUrgente] = useState(false)
  const [observaciones, setObservaciones] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLDivElement>(null)

  const limiteAlcanzado = lineas.length >= MAX_INSUMOS_POR_PEDIDO

  // Reset al abrir
  useEffect(() => {
    if (!open) return
    const fecha = new Date().toISOString().split("T")[0]
    setFechaPedido(fecha)
    setFechaRequerida("")
    setBusqueda("")
    setSugerencias([])
    setLineas([])
    setUrgente(false)
    setObservaciones("")
    setError(null)
  }, [open])

  // Buscar insumos mientras escribe (código o descripción del insumo,
  // o código del ítem del presupuesto -- ver buscar_insumos_presupuesto)
  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setSugerencias([])
      return
    }

    setBuscando(true)
    const timeout = setTimeout(() => {
      buscarInsumos(versionId, busqueda)
        .then(setSugerencias)
        .catch((e) => setError(e instanceof Error ? e.message : "No se pudo buscar el insumo."))
        .finally(() => setBuscando(false))
    }, 300)

    return () => clearTimeout(timeout)
  }, [busqueda, versionId])

  function agregarInsumo(insumo: InsumoAgrupado) {
    if (limiteAlcanzado) {
      setError(`Un pedido puede tener máximo ${MAX_INSUMOS_POR_PEDIDO} insumos.`)
      return
    }
    setError(null)

    // Si el insumo aparece en un solo ítem (y tiene disponible), se
    // preselecciona directo -- menos fricción para el caso común.
    setLineas((prev) => [
      ...prev,
      {
        insumo,
        items: insumo.items.map((it) => ({
          ...it,
          marcado: insumo.items.length === 1 && it.cantidadDisponible > 0,
          cantidad: "",
        })),
      },
    ])
    setBusqueda("")
    setSugerencias([])
  }

  function quitarInsumo(insumoId: string) {
    setLineas((prev) => prev.filter((l) => l.insumo.insumoId !== insumoId))
  }

  function actualizarItem(
    insumoId: string,
    presupuestoItemId: string,
    cambios: { marcado?: boolean; cantidad?: string }
  ) {
    setLineas((prev) =>
      prev.map((l) =>
        l.insumo.insumoId !== insumoId
          ? l
          : {
              ...l,
              items: l.items.map((it) =>
                it.presupuestoItemId === presupuestoItemId ? { ...it, ...cambios } : it
              ),
            }
      )
    )
  }

  // Ya agregados no se vuelven a ofrecer en las sugerencias.
  const idsAgregados = new Set(lineas.map((l) => l.insumo.insumoId))
  const sugerenciasNuevas = sugerencias.filter((s) => !idsAgregados.has(s.insumoId))

  // No se permite pedir más de lo que queda disponible en el
  // presupuesto: cantidad_apu × cantidad del ítem, menos lo ya pendiente o
  // aprobado (calculado en SQL, ver cantidadDisponible). Si cualquier línea
  // no está lista, se bloquea el submit -- también se revalida en el
  // servidor dentro de crearPedido.
  const lineasListas = lineas.length > 0 && lineas.every((l) => estadoLinea(l).lista)
  const puedeGuardar = !!fechaRequerida && lineasListas && !guardando

  async function handleGuardar() {
    if (!puedeGuardar) return

    setGuardando(true)
    setError(null)

    try {
      await crearPedido({
        insumos: lineas.map((l) => ({
          insumoId: l.insumo.insumoId,
          items: estadoLinea(l).marcados.map((it) => ({
            presupuestoItemId: it.presupuestoItemId,
            itemApuId: it.itemApuId,
            cantidad: Number(it.cantidad),
          })),
        })),
        fechaRequerida,
        urgente,
        observaciones: observaciones.trim() || null,
        soporteUrl: null, // subida de archivo a Storage: pendiente de implementar
      })

      onPedidoCreado?.()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el pedido.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl p-0">
        <DialogHeader className="border-b px-8 py-5">
          <DialogTitle className="text-xl">Nuevo pedido</DialogTitle>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-6 overflow-y-auto px-8 py-6">
          {/* Fechas */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Fecha pedido</label>
              <Input type="date" value={fechaPedido} readOnly className="h-10 bg-muted/40" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Fecha requerida</label>
              <Input
                type="date"
                value={fechaRequerida}
                min={fechaPedido}
                onChange={(e) => setFechaRequerida(e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          {/* Buscar insumos -- por código o descripción */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Agregar insumos al pedido</label>
              <span
                className={`text-xs ${limiteAlcanzado ? "font-medium text-destructive" : "text-muted-foreground"}`}
              >
                {lineas.length} / {MAX_INSUMOS_POR_PEDIDO} insumos
              </span>
            </div>

            <div ref={inputRef} className="relative">
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={
                  limiteAlcanzado
                    ? "Llegaste al máximo de insumos por pedido"
                    : "Buscar por código o descripción..."
                }
                disabled={limiteAlcanzado}
                className="h-11"
              />

              <DropdownFlotante
                anchorRef={inputRef}
                abierto={(sugerencias.length > 0 || buscando) && !limiteAlcanzado}
              >
                <div className="max-h-72 w-full overflow-auto rounded-lg border bg-background shadow-lg">
                  {buscando && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">Buscando…</div>
                  )}
                  {!buscando && sugerenciasNuevas.length === 0 && busqueda.trim().length >= 2 && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      {sugerencias.length > 0
                        ? "Todos los insumos que coinciden ya están en el pedido."
                        : `Ningún insumo de este presupuesto coincide con “${busqueda}”.`}
                    </div>
                  )}
                  {sugerenciasNuevas.map((insumo) => (
                    <button
                      key={insumo.insumoId}
                      type="button"
                      onClick={() => agregarInsumo(insumo)}
                      className="flex w-full flex-col items-start gap-0.5 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted"
                    >
                      <span className="font-medium">{insumo.insumoDescripcion}</span>
                      <span className="text-xs text-muted-foreground">
                        {insumo.insumoCodigo} · {insumo.insumoUm ?? "sin unidad"} ·{" "}
                        {insumo.items.length} {insumo.items.length === 1 ? "ítem" : "ítems"} del
                        presupuesto
                      </span>
                    </button>
                  ))}
                </div>
              </DropdownFlotante>
            </div>
          </div>

          {/* Insumos agregados, cada uno con sus ítems y tope de cantidad */}
          {lineas.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Busca y agrega los insumos que necesitas. Puedes pedir hasta {MAX_INSUMOS_POR_PEDIDO}{" "}
              en un mismo pedido.
            </p>
          ) : (
            <div className="space-y-3">
              {lineas.map((linea) => {
                const { lista } = estadoLinea(linea)
                const { insumo } = linea

                return (
                  <div
                    key={insumo.insumoId}
                    className={`space-y-3 rounded-lg border p-4 ${lista ? "bg-muted/20" : "border-amber-300 bg-amber-50/40"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{insumo.insumoDescripcion}</p>
                        <p className="text-xs text-muted-foreground">
                          {insumo.insumoCodigo} · {insumo.insumoUm ?? "sin unidad"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => quitarInsumo(insumo.insumoId)}
                        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
                      >
                        Quitar
                      </button>
                    </div>

                    <div className="space-y-1.5 border-t pt-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        {linea.items.length > 1
                          ? "Este insumo aparece en varios ítems del presupuesto — marca a cuáles aplica y la cantidad de cada uno:"
                          : "Ítem del presupuesto al que aplica:"}
                      </p>

                      {linea.items.map((it) => {
                        const excedido = Number(it.cantidad) > it.cantidadDisponible
                        const sinDisponible = it.cantidadDisponible <= 0

                        return (
                          <div
                            key={it.presupuestoItemId}
                            className="flex items-center gap-3 rounded-md border bg-background px-3 py-2"
                          >
                            <Checkbox
                              checked={it.marcado}
                              disabled={sinDisponible}
                              onCheckedChange={(v) =>
                                actualizarItem(insumo.insumoId, it.presupuestoItemId, {
                                  marcado: v === true,
                                })
                              }
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium">
                                <span className="font-mono text-muted-foreground">{it.itemCodigo}</span>{" "}
                                {it.itemDescripcion}
                              </p>
                              <p
                                className={`text-[11px] ${
                                  sinDisponible ? "text-destructive" : "text-muted-foreground"
                                }`}
                              >
                                {sinDisponible
                                  ? "Sin cantidad disponible en el presupuesto"
                                  : `Disponible: ${it.cantidadDisponible}`}
                              </p>
                            </div>
                            <div className="w-28 space-y-0.5">
                              <Input
                                type="number"
                                min="0"
                                max={it.cantidadDisponible}
                                step="any"
                                value={it.cantidad}
                                onChange={(e) =>
                                  actualizarItem(insumo.insumoId, it.presupuestoItemId, {
                                    cantidad: e.target.value,
                                  })
                                }
                                disabled={!it.marcado || sinDisponible}
                                placeholder="Cantidad"
                                className={`h-8 text-right text-xs ${
                                  excedido ? "border-destructive focus-visible:ring-destructive" : ""
                                }`}
                              />
                              {excedido && (
                                <p className="text-right text-[10px] text-destructive">
                                  Supera lo disponible
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}

                      {!lista && (
                        <p className="pt-1 text-[11px] text-amber-800">
                          Marca al menos un ítem y escribe su cantidad para poder crear el pedido.
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Urgente + observaciones */}
          <div className="space-y-4 border-t pt-5">
            <div className="flex items-center gap-2">
              <Checkbox checked={urgente} onCheckedChange={(v) => setUrgente(v === true)} />
              <label className="text-sm font-medium">Marcar como urgente</label>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Observaciones (opcional)</label>
              <Textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Detalles adicionales para este pedido…"
                className="min-h-[80px] resize-none"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Acciones */}
          <div className="flex justify-end gap-3 border-t pt-5">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={handleGuardar} disabled={!puedeGuardar}>
              {guardando
                ? "Creando…"
                : lineas.length > 1
                  ? `Crear pedido (${lineas.length} insumos)`
                  : "Crear pedido"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
