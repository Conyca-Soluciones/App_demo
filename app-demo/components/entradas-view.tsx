"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  anularEntrada,
  editarEntrada,
  listarOrdenesParaEntrada,
  obtenerDetalleOrdenParaEntrada,
  registrarEntrada,
  type DetalleOrdenEntrada,
  type EntradaRegistrada,
  type EstadoEntrega,
  type OrdenParaEntrada,
} from "@/app/(app)/almacen/entradas/actions"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

const formatoNumero = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 })

const ESTADO_BADGE: Record<
  EstadoEntrega,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  sin_entregar: { label: "Aprobada", variant: "default" },
  entrega_parcial: { label: "Entrega parcial", variant: "secondary" },
  entregada: { label: "Entregada", variant: "default" },
}

// "1.5" y "1,5" son la misma cantidad -- se acepta coma decimal (Colombia).
function parsearCantidad(texto: string): number {
  const n = Number(texto.trim().replace(",", "."))
  return Number.isFinite(n) ? n : NaN
}

export function EntradasView() {
  const [ordenes, setOrdenes] = useState<OrdenParaEntrada[] | null>(null)
  const [ordenId, setOrdenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [mostrarEntregadas, setMostrarEntregadas] = useState(false)

  function cargarOrdenes() {
    listarOrdenesParaEntrada(mostrarEntregadas)
      .then((lista: OrdenParaEntrada[]) => setOrdenes(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las órdenes."))
  }

  useEffect(() => {
    setOrdenes(null)
    cargarOrdenes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarEntregadas])

  if (ordenId) {
    return (
      <DetalleEntrada
        ordenId={ordenId}
        onVolver={() => {
          setOrdenId(null)
          cargarOrdenes()
        }}
        onRegistrada={(estado) =>
          setAviso(
            estado === "entregada"
              ? "Entrada registrada. La orden quedó Entregada y ya no aparece en la lista."
              : "Entrada registrada. La orden quedó en Entrega parcial."
          )
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Entradas</h1>
        <p className="text-sm text-muted-foreground">
          Selecciona una orden de compra aprobada para registrar el material recibido en bodega.
        </p>
      </div>

      <div>
        <Button
          size="sm"
          variant={mostrarEntregadas ? "default" : "outline"}
          onClick={() => setMostrarEntregadas((v) => !v)}
        >
          {mostrarEntregadas ? "Ocultar órdenes entregadas" : "Mostrar órdenes entregadas (para corregir)"}
        </Button>
      </div>

      {aviso && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {aviso}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {ordenes === null ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando órdenes...
        </div>
      ) : ordenes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          No hay órdenes de compra pendientes de entrada.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>OC N°</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Entrega esperada</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Líneas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenes.map((o) => {
                const badge = ESTADO_BADGE[o.estadoEntrega]
                return (
                  <TableRow
                    key={o.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => {
                      setAviso(null)
                      setOrdenId(o.id)
                    }}
                  >
                    <TableCell>{o.numero}</TableCell>
                    <TableCell>{o.proyectoCodigo ?? o.proyectoNombre ?? "—"}</TableCell>
                    <TableCell>{o.proveedorNombre}</TableCell>
                    <TableCell>{o.fechaEntrega ? formatoFecha(o.fechaEntrega) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{o.totalLineas}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function DetalleEntrada({
  ordenId,
  onVolver,
  onRegistrada,
}: {
  ordenId: string
  onVolver: () => void
  onRegistrada: (estado: EstadoEntrega) => void
}) {
  const [detalle, setDetalle] = useState<DetalleOrdenEntrada | null>(null)
  const [cantidades, setCantidades] = useState<Record<string, string>>({})
  const [remision, setRemision] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const [editando, setEditando] = useState<EntradaRegistrada | null>(null)
  const [edCantidades, setEdCantidades] = useState<Record<string, string>>({})
  const [edRemision, setEdRemision] = useState("")
  const [edObservaciones, setEdObservaciones] = useState("")
  const [procesandoEdicion, setProcesandoEdicion] = useState(false)

  const [anulando, setAnulando] = useState<EntradaRegistrada | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesandoAnulacion, setProcesandoAnulacion] = useState(false)

  function abrirEdicion(e: EntradaRegistrada) {
    setError(null)
    setAviso(null)
    setEditando(e)
    setEdCantidades(Object.fromEntries(e.lineas.map((l) => [l.id, String(l.cantidad)])))
    setEdRemision(e.remision ?? "")
    setEdObservaciones(e.observaciones ?? "")
  }

  async function confirmarEdicion() {
    if (!editando || !detalle) return
    setError(null)

    const lineas: { id: string; cantidad: number }[] = []
    for (const l of editando.lineas) {
      const cantidad = parsearCantidad(edCantidades[l.id] ?? "")
      if (Number.isNaN(cantidad) || cantidad <= 0) {
        setError(`"${l.insumoDescripcion}": la cantidad debe ser mayor que cero.`)
        return
      }
      // Máximo = ordenado - lo recibido en OTRAS entradas vigentes.
      const linea = detalle.lineas.find((x) => x.id === l.ordenCompraItemId)
      if (linea) {
        const maximo = linea.cantidadOrdenada - (linea.cantidadRecibida - l.cantidad)
        if (cantidad > maximo) {
          setError(
            `"${l.insumoDescripcion}": no puede superar lo ordenado (máximo ${formatoNumero.format(maximo)}).`
          )
          return
        }
      }
      lineas.push({ id: l.id, cantidad })
    }

    setProcesandoEdicion(true)
    try {
      const estado = await editarEntrada({
        entradaId: editando.id,
        remision: edRemision,
        observaciones: edObservaciones,
        lineas,
      })
      setEditando(null)
      setAviso(
        `Entrada #${editando.numero} corregida. La orden quedó en ${ESTADO_BADGE[estado].label}.`
      )
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo editar la entrada.")
      setEditando(null)
    } finally {
      setProcesandoEdicion(false)
    }
  }

  async function confirmarAnulacion() {
    if (!anulando) return
    setProcesandoAnulacion(true)
    try {
      const estado = await anularEntrada(anulando.id, motivo)
      setAviso(
        `Entrada #${anulando.numero} anulada. La orden quedó en ${ESTADO_BADGE[estado].label}.`
      )
      setAnulando(null)
      setMotivo("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular la entrada.")
      setAnulando(null)
    } finally {
      setProcesandoAnulacion(false)
    }
  }

  function cargar() {
    obtenerDetalleOrdenParaEntrada(ordenId)
      .then((d: DetalleOrdenEntrada) => setDetalle(d))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la orden."))
  }

  useEffect(cargar, [ordenId])

  if (!detalle) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {error ? error : (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando orden...</>)}
      </div>
    )
  }

  const badge = ESTADO_BADGE[detalle.estadoEntrega]
  const completa = detalle.estadoEntrega === "entregada"

  async function handleGuardar() {
    if (!detalle) return
    setError(null)

    const lineas: { ordenCompraItemId: string; cantidad: number }[] = []
    for (const l of detalle.lineas) {
      const texto = cantidades[l.id]
      if (!texto || !texto.trim()) continue
      const cantidad = parsearCantidad(texto)
      if (Number.isNaN(cantidad) || cantidad < 0) {
        setError(`Cantidad inválida en "${l.insumoDescripcion}".`)
        return
      }
      if (cantidad > l.cantidadPendiente) {
        setError(
          `"${l.insumoDescripcion}": no puedes recibir más de lo pendiente (${formatoNumero.format(l.cantidadPendiente)}).`
        )
        return
      }
      if (cantidad > 0) lineas.push({ ordenCompraItemId: l.id, cantidad })
    }
    if (lineas.length === 0) {
      setError("Ingresa la cantidad recibida de al menos un insumo.")
      return
    }

    setGuardando(true)
    try {
      const estado = await registrarEntrada({
        ordenId: detalle.id,
        remision,
        observaciones,
        lineas,
      })
      onRegistrada(estado)
      if (estado === "entregada") {
        onVolver()
        return
      }
      setCantidades({})
      setRemision("")
      setObservaciones("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la entrada.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onVolver}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Volver
        </Button>
        <h1 className="text-2xl font-semibold">Entrada — OC {detalle.numero}</h1>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      <div className="text-sm text-muted-foreground">
        {detalle.proyectoCodigo ?? detalle.proyectoNombre} · {detalle.proveedorNombre}
      </div>

      {aviso && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {aviso}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Insumo</TableHead>
              <TableHead>UM</TableHead>
              <TableHead className="text-right">Ordenado</TableHead>
              <TableHead className="text-right">Ya recibido</TableHead>
              <TableHead className="text-right">Pendiente</TableHead>
              <TableHead className="w-40 text-right">Recibir ahora</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detalle.lineas.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.insumoCodigo}</TableCell>
                <TableCell>{l.insumoDescripcion}</TableCell>
                <TableCell>{l.um ?? "—"}</TableCell>
                <TableCell className="text-right">{formatoNumero.format(l.cantidadOrdenada)}</TableCell>
                <TableCell className="text-right">{formatoNumero.format(l.cantidadRecibida)}</TableCell>
                <TableCell className="text-right">{formatoNumero.format(l.cantidadPendiente)}</TableCell>
                <TableCell className="text-right">
                  {l.cantidadPendiente > 0 ? (
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        inputMode="decimal"
                        className="h-8 w-24 text-right"
                        placeholder="0"
                        value={cantidades[l.id] ?? ""}
                        onChange={(e) =>
                          setCantidades((prev) => ({ ...prev, [l.id]: e.target.value }))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Recibir todo lo pendiente"
                        onClick={() =>
                          setCantidades((prev) => ({
                            ...prev,
                            [l.id]: String(l.cantidadPendiente),
                          }))
                        }
                      >
                        Todo
                      </Button>
                    </div>
                  ) : (
                    <span className="text-emerald-700">Completo</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!completa && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="N° de remisión / factura del proveedor (opcional)"
            value={remision}
            onChange={(e) => setRemision(e.target.value)}
          />
          <Textarea
            placeholder="Observaciones (opcional)"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
          />
        </div>
      )}

      {!completa && (
        <div>
          <Button onClick={handleGuardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar entrada
          </Button>
        </div>
      )}

      {detalle.entradas.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-lg font-medium">Entradas registradas</h2>
          {detalle.entradas.map((e) => (
            <div
              key={e.id}
              className={`rounded-lg border p-3 text-sm ${e.anuladaAt ? "bg-muted/40 text-muted-foreground" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-medium">
                <span className={e.anuladaAt ? "line-through" : ""}>Entrada #{e.numero}</span>
                {e.anuladaAt && <Badge variant="destructive">Anulada</Badge>}
                {!e.anuladaAt && e.editadaAt && <Badge variant="outline">Editada</Badge>}
                <span className="font-normal text-muted-foreground">
                  {formatoFecha(e.createdAt)} · {e.recibidoPor ?? "—"}
                  {e.remision ? ` · Remisión ${e.remision}` : ""}
                </span>
                {!e.anuladaAt && (
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => abrirEdicion(e)}>
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setError(null)
                        setAviso(null)
                        setAnulando(e)
                      }}
                    >
                      Anular
                    </Button>
                  </span>
                )}
              </div>
              <ul className="mt-1 list-disc pl-5">
                {e.lineas.map((l) => (
                  <li key={l.id}>
                    {l.insumoDescripcion}: {formatoNumero.format(l.cantidad)} {l.um ?? ""}
                    {l.cantidadOriginal !== null && (
                      <span className="text-muted-foreground">
                        {" "}(antes {formatoNumero.format(l.cantidadOriginal)})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {e.observaciones && <p className="mt-1 text-muted-foreground">{e.observaciones}</p>}
              {e.anuladaAt && e.motivoAnulacion && (
                <p className="mt-1">Motivo de anulación: {e.motivoAnulacion}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setEditando(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar entrada #{editando?.numero}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {editando?.lineas.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {l.insumoDescripcion} {l.um ? `(${l.um})` : ""}
                </span>
                <Input
                  inputMode="decimal"
                  className="h-8 w-28 text-right"
                  value={edCantidades[l.id] ?? ""}
                  onChange={(ev) => setEdCantidades((prev) => ({ ...prev, [l.id]: ev.target.value }))}
                />
              </div>
            ))}
          </div>
          <Input
            placeholder="N° de remisión / factura del proveedor"
            value={edRemision}
            onChange={(ev) => setEdRemision(ev.target.value)}
          />
          <Textarea
            placeholder="Observaciones"
            value={edObservaciones}
            onChange={(ev) => setEdObservaciones(ev.target.value)}
            rows={2}
          />
          <p className="text-xs text-muted-foreground">
            Para quitar un insumo o pasar la entrada a otra orden, anúlala y regístrala de nuevo.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarEdicion} disabled={procesandoEdicion}>
              {procesandoEdicion ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={anulando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setAnulando(null)
            setMotivo("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular entrada #{anulando?.numero}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            El material de esta entrada sale del inventario y la orden vuelve a mostrarlo como
            pendiente. La entrada queda registrada como anulada.
          </p>
          <Textarea
            placeholder="Motivo de la anulación (obligatorio)"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnulando(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || procesandoAnulacion}
              onClick={confirmarAnulacion}
            >
              {procesandoAnulacion ? "Anulando..." : "Anular entrada"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
