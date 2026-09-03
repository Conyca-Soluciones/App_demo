"use client"

// components/dialogue-nuevo-pedido.tsx
//
// Todo el flujo de crear un pedido en un solo componente: buscar
// insumo, elegir a qué ítem(s) del presupuesto aplica (respetando el
// tope de cantidadDisponible de cada uno), y los campos comunes del
// pedido (fecha, urgente, observaciones).

import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownFlotante } from "@/components/dropdown-flotante"
import { buscarInsumos, crearPedido } from "@/app/(app)/almacen/actions"
import type { InsumoAgrupado, ItemSeleccionable } from "@/app/(app)/almacen/types"

interface SolicitudInsumoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionId: string
  onPedidoCreado?: () => void
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
  const [seleccionado, setSeleccionado] = useState<InsumoAgrupado | null>(null)
  const [itemsSeleccionables, setItemsSeleccionables] = useState<ItemSeleccionable[]>([])
  const [urgente, setUrgente] = useState(false)
  const [observaciones, setObservaciones] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLDivElement>(null)

  // Reset al abrir
  useEffect(() => {
    if (!open) return
    const fecha = new Date().toISOString().split("T")[0]
    setFechaPedido(fecha)
    setFechaRequerida("")
    setBusqueda("")
    setSugerencias([])
    setSeleccionado(null)
    setItemsSeleccionables([])
    setUrgente(false)
    setObservaciones("")
    setError(null)
  }, [open])

  // Buscar insumos mientras escribe (código o descripción del insumo,
  // o código del ítem del presupuesto -- ver buscar_insumos_presupuesto)
  useEffect(() => {
    if (seleccionado) return
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
  }, [busqueda, seleccionado, versionId])

  function elegirInsumo(insumo: InsumoAgrupado) {
    setSeleccionado(insumo)
    setBusqueda(insumo.insumoDescripcion)
    setSugerencias([])

    // Si el insumo aparece en un solo ítem (y tiene disponible), se
    // preselecciona directo -- menos fricción para el caso común.
    setItemsSeleccionables(
      insumo.items.map((it) => ({
        ...it,
        marcado: insumo.items.length === 1 && it.cantidadDisponible > 0,
        cantidad: "",
      }))
    )
  }

  function limpiarSeleccion() {
    setSeleccionado(null)
    setBusqueda("")
    setItemsSeleccionables([])
  }

  function toggleItem(presupuestoItemId: string, marcado: boolean) {
    setItemsSeleccionables((prev) =>
      prev.map((it) => (it.presupuestoItemId === presupuestoItemId ? { ...it, marcado } : it))
    )
  }

  function actualizarCantidadItem(presupuestoItemId: string, cantidad: string) {
    setItemsSeleccionables((prev) =>
      prev.map((it) => (it.presupuestoItemId === presupuestoItemId ? { ...it, cantidad } : it))
    )
  }

  const itemsMarcados = itemsSeleccionables.filter((it) => it.marcado)

  // No se permite pedir más de lo que queda disponible en el
  // presupuesto: cantidad_apu × cantidad del ítem, menos lo ya
  // aprobado antes (calculado en SQL, ver cantidadDisponible). Si
  // cualquier fila marcada excede su tope, se bloquea el submit --
  // también se revalida en el servidor dentro de crearPedido.
  const hayExceso = itemsMarcados.some((it) => Number(it.cantidad) > it.cantidadDisponible)
  const todosConCantidad =
    itemsMarcados.length > 0 && itemsMarcados.every((it) => Number(it.cantidad) > 0)
  const puedeGuardar =
    !!fechaRequerida && !!seleccionado && todosConCantidad && !hayExceso && !guardando

  async function handleGuardar() {
    if (!seleccionado || !puedeGuardar) return

    setGuardando(true)
    setError(null)

    try {
      await crearPedido({
        insumoId: seleccionado.insumoId,
        items: itemsMarcados.map((it) => ({
          presupuestoItemId: it.presupuestoItemId,
          itemApuId: it.itemApuId,
          cantidad: Number(it.cantidad),
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
      <DialogContent className="w-[95vw] max-w-2xl p-0">
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

          {/* Buscar insumo -- por código o descripción */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Buscar insumo</label>

            <div ref={inputRef} className="relative">
              <Input
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value)
                  if (seleccionado) limpiarSeleccion()
                }}
                placeholder="Buscar por código o descripción..."
                className="h-11"
              />

              <DropdownFlotante
                anchorRef={inputRef}
                abierto={(sugerencias.length > 0 || buscando) && !seleccionado}
              >
                <div className="max-h-72 w-full overflow-auto rounded-lg border bg-background shadow-lg">
                  {buscando && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">Buscando…</div>
                  )}
                  {!buscando && sugerencias.length === 0 && busqueda.trim().length >= 2 && (
                    <div className="px-4 py-3 text-sm text-muted-foreground">
                      Ningún insumo de este presupuesto coincide con &ldquo;{busqueda}&rdquo;.
                    </div>
                  )}
                  {sugerencias.map((insumo) => (
                    <button
                      key={insumo.insumoId}
                      type="button"
                      onClick={() => elegirInsumo(insumo)}
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

          {/* Insumo seleccionado + multi-select de ítems con tope de cantidad */}
          {seleccionado && (
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{seleccionado.insumoDescripcion}</p>
                  <p className="text-xs text-muted-foreground">
                    {seleccionado.insumoCodigo} · {seleccionado.insumoUm ?? "sin unidad"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={limpiarSeleccion}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Cambiar
                </button>
              </div>

              <div className="space-y-1.5 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {itemsSeleccionables.length > 1
                    ? "Este insumo aparece en varios ítems del presupuesto — marca a cuáles aplica este pedido y la cantidad de cada uno:"
                    : "Ítem del presupuesto al que aplica este pedido:"}
                </p>

                {itemsSeleccionables.map((it) => {
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
                        onCheckedChange={(v) => toggleItem(it.presupuestoItemId, v === true)}
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
                          onChange={(e) => actualizarCantidadItem(it.presupuestoItemId, e.target.value)}
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
              </div>
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
              {guardando ? "Creando…" : "Crear pedido"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}