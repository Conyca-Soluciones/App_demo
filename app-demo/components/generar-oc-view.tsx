"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ClipboardList, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { BuscadorAsync, type OpcionBuscador } from "./buscador-async"
import { TarjetaProveedorOC } from "./tarjeta-proveedor-oc"
import { calcularLinea, calcularTotalesOrden } from "@/lib/ordenes-compra-calculos"
import {
  obtenerPedidosPorId,
  buscarProveedores,
  obtenerProveedorDetalle,
  crearOrdenCompra,
  type PedidoParaComprar,
  type ProveedorDetalle,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

const CLAVE_SELECCION = "compras:seleccion"

type SeleccionGuardada = { proyectoId: string; pedidoIds: string[] }

type LineaForm = {
  cantidad: string
  precioUnitario: string
  porcentajeDescuento: string
  porcentajeIva: string
}

const formatoMoneda = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

async function buscarProveedoresAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const proveedores = await buscarProveedores(termino)
  return proveedores.map((p) => ({
    id: p.id,
    etiqueta: p.nombre,
    subetiqueta: p.idProv ? `ID ${p.idProv}` : null,
  }))
}

// puedeEditarProveedor: acción `editar_proveedores` (o Administrador); lo
// calcula la página en el servidor. La base vuelve a exigirlo (RLS).
export function GenerarOCView({ puedeEditarProveedor = false }: { puedeEditarProveedor?: boolean }) {
  const router = useRouter()

  const [seleccion, setSeleccion] = useState<SeleccionGuardada | null | undefined>(undefined)
  const [pedidos, setPedidos] = useState<PedidoParaComprar[]>([])
  const [lineas, setLineas] = useState<Record<string, LineaForm>>({})
  const [cargandoPedidos, setCargandoPedidos] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [proveedor, setProveedor] = useState<OpcionBuscador | null>(null)
  const [detalleProveedor, setDetalleProveedor] = useState<ProveedorDetalle | null>(null)
  const [cargandoProveedor, setCargandoProveedor] = useState(false)

  const [sitioEntrega, setSitioEntrega] = useState("")
  const [fechaEntrega, setFechaEntrega] = useState("")
  const [contactoProyecto, setContactoProyecto] = useState("")
  const [condicionesPago, setCondicionesPago] = useState("")
  const [observaciones, setObservaciones] = useState("")

  const [generando, setGenerando] = useState(false)
  const [ordenCreada, setOrdenCreada] = useState<string | null>(null)

  useEffect(() => {
    const raw = sessionStorage.getItem(CLAVE_SELECCION)
    if (!raw) {
      setSeleccion(null)
      return
    }
    try {
      const parsed = JSON.parse(raw) as SeleccionGuardada
      if (!parsed.proyectoId || !Array.isArray(parsed.pedidoIds) || parsed.pedidoIds.length === 0) {
        setSeleccion(null)
        return
      }
      setSeleccion(parsed)
    } catch {
      setSeleccion(null)
    }
  }, [])

  useEffect(() => {
    if (!seleccion) return
    setCargandoPedidos(true)
    setError(null)
    obtenerPedidosPorId(seleccion.pedidoIds)
      .then((data) => {
        setPedidos(data)
        setLineas(
          Object.fromEntries(
            data.map((p) => [
              p.id,
              {
                cantidad: String(p.cantidadPendiente),
                precioUnitario: "",
                porcentajeDescuento: "0",
                porcentajeIva: "0",
              },
            ])
          )
        )
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las requisiciones."))
      .finally(() => setCargandoPedidos(false))
  }, [seleccion])

  useEffect(() => {
    if (!proveedor) {
      setDetalleProveedor(null)
      return
    }
    setCargandoProveedor(true)
    obtenerProveedorDetalle(proveedor.id)
      .then(setDetalleProveedor)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el proveedor."))
      .finally(() => setCargandoProveedor(false))
  }, [proveedor])

  function actualizarLinea(pedidoId: string, campo: keyof LineaForm, valor: string) {
    setLineas((prev) => ({ ...prev, [pedidoId]: { ...prev[pedidoId], [campo]: valor } }))
  }

  // Devuelve los números parseados de una línea, o null si algo es inválido
  // (cantidad vacía/0/negativa/mayor a lo pendiente, o precio vacío/negativo).
  function lineaValida(pedido: PedidoParaComprar) {
    const l = lineas[pedido.id]
    if (!l) return null
    const cantidad = Number(l.cantidad)
    const precioUnitario = Number(l.precioUnitario)
    const porcentajeDescuento = Number(l.porcentajeDescuento || "0")
    const porcentajeIva = Number(l.porcentajeIva || "0")

    if (!l.cantidad.trim() || Number.isNaN(cantidad) || cantidad <= 0 || cantidad > pedido.cantidadPendiente)
      return null
    if (!l.precioUnitario.trim() || Number.isNaN(precioUnitario) || precioUnitario < 0) return null
    if (Number.isNaN(porcentajeDescuento) || porcentajeDescuento < 0 || porcentajeDescuento > 100) return null
    if (Number.isNaN(porcentajeIva) || porcentajeIva < 0 || porcentajeIva > 100) return null

    return { cantidad, precioUnitario, porcentajeDescuento, porcentajeIva }
  }

  const todasLasLineasValidas = pedidos.length > 0 && pedidos.every((p) => lineaValida(p) !== null)

  const totales = todasLasLineasValidas
    ? calcularTotalesOrden(pedidos.map((p) => lineaValida(p)!))
    : null

  const puedeGenerar =
    proveedor !== null && !cargandoProveedor && todasLasLineasValidas && !generando

  async function handleGenerar() {
    if (!seleccion || !proveedor || !todasLasLineasValidas) return
    setGenerando(true)
    setError(null)
    try {
      const ordenId = await crearOrdenCompra({
        proyectoId: seleccion.proyectoId,
        proveedorId: proveedor.id,
        sitioEntrega: sitioEntrega.trim() || null,
        fechaEntrega: fechaEntrega || null,
        contactoNombre: contactoProyecto.trim() || null,
        telefono: detalleProveedor?.telefono ?? null,
        ciudad: detalleProveedor?.ciudad ?? null,
        email: detalleProveedor?.correo ?? null,
        condicionesPago: condicionesPago.trim() || null,
        observaciones: observaciones.trim() || null,
        lineas: pedidos.map((p) => {
          const l = lineaValida(p)!
          return {
            pedidoId: p.id,
            cantidadComprar: l.cantidad,
            precioUnitario: l.precioUnitario,
            porcentajeDescuento: l.porcentajeDescuento,
            porcentajeIva: l.porcentajeIva,
          }
        }),
      })
      sessionStorage.removeItem(CLAVE_SELECCION)
      setOrdenCreada(ordenId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar la orden de compra.")
    } finally {
      setGenerando(false)
    }
  }

  if (seleccion === undefined) return null

  if (seleccion === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <p>No hay requisiciones seleccionadas para generar una orden de compra.</p>
        <Button variant="outline" onClick={() => router.push("/almacen/comprar-pedidos")}>
          Volver a Comprar pedidos
        </Button>
      </div>
    )
  }

  if (ordenCreada) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <ClipboardList className="h-10 w-10 text-primary" />
        <p className="text-lg font-medium">Orden de compra generada</p>
        <p className="text-sm text-muted-foreground">
          Se creó correctamente para el proveedor {detalleProveedor?.nombre}. Queda pendiente de
          aprobación.
        </p>
        <Button onClick={() => router.push("/almacen/comprar-pedidos")}>Volver a Comprar requisiciones</Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">Generar orden de compra</h1>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            {cargandoPedidos ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando requisiciones...
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cod</TableHead>
                    <TableHead>Insumo</TableHead>
                    <TableHead>UM</TableHead>
                    <TableHead className="text-right">Pendiente</TableHead>
                    <TableHead className="w-28 text-right">Cantidad</TableHead>
                    <TableHead className="w-28 text-right">Vr. Unitario</TableHead>
                    <TableHead className="w-20 text-right">% Dto.</TableHead>
                    <TableHead className="w-20 text-right">% IVA</TableHead>
                    <TableHead className="w-28 text-right">Total línea</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidos.map((pedido) => {
                    const l = lineas[pedido.id] ?? {
                      cantidad: "",
                      precioUnitario: "",
                      porcentajeDescuento: "0",
                      porcentajeIva: "0",
                    }
                    const valida = lineaValida(pedido)
                    const totalLinea = valida ? calcularLinea(valida).total : null
                    return (
                      <TableRow key={pedido.id}>
                        <TableCell className="text-muted-foreground">{pedido.insumoCodigo}</TableCell>
                        <TableCell className="max-w-[200px]">{pedido.insumoDescripcion}</TableCell>
                        <TableCell>{pedido.um ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {pedido.cantidadPendiente.toLocaleString("es-CO")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={pedido.cantidadPendiente}
                            step="any"
                            value={l.cantidad}
                            onChange={(e) => actualizarLinea(pedido.id, "cantidad", e.target.value)}
                            className={`text-right ${!valida ? "border-destructive" : ""}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={l.precioUnitario}
                            onChange={(e) => actualizarLinea(pedido.id, "precioUnitario", e.target.value)}
                            className={`text-right ${!valida ? "border-destructive" : ""}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            value={l.porcentajeDescuento}
                            onChange={(e) =>
                              actualizarLinea(pedido.id, "porcentajeDescuento", e.target.value)
                            }
                            className="text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            value={l.porcentajeIva}
                            onChange={(e) => actualizarLinea(pedido.id, "porcentajeIva", e.target.value)}
                            className="text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {totalLinea != null ? formatoMoneda(totalLinea) : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {totales && (
            <div className="flex justify-end">
              <div className="w-64 space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Descuento</span>
                  <span>{formatoMoneda(totales.descuento)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>IVA</span>
                  <span>{formatoMoneda(totales.iva)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 font-medium">
                  <span>Total</span>
                  <span>{formatoMoneda(totales.total)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-full max-w-sm shrink-0 space-y-4 overflow-auto rounded-lg border bg-card p-4">
          <div className="space-y-1.5">
            <Label>
              Proveedor <span className="text-destructive">*</span>
            </Label>
            <BuscadorAsync
              placeholder="Buscar proveedor"
              valorSeleccionado={proveedor}
              onSeleccionar={setProveedor}
              buscar={buscarProveedoresAdaptado}
            />
          </div>

          {cargandoProveedor && (
            <p className="text-sm text-muted-foreground">Cargando datos del proveedor...</p>
          )}

          {detalleProveedor && !cargandoProveedor && (
            <TarjetaProveedorOC
              key={detalleProveedor.id}
              detalle={detalleProveedor}
              puedeEditar={puedeEditarProveedor}
              onActualizado={setDetalleProveedor}
            />
          )}

          {detalleProveedor && !cargandoProveedor && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <div>
                {detalleProveedor.informacionBancaria ? (
                  <>
                    <p>
                      <span className="text-muted-foreground">Banco: </span>
                      {detalleProveedor.informacionBancaria.entidadBancaria ?? "—"}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Cuenta: </span>
                      {detalleProveedor.informacionBancaria.tipoCuenta ?? "—"}{" "}
                      {detalleProveedor.informacionBancaria.noCuenta ?? ""}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Titular: </span>
                      {detalleProveedor.informacionBancaria.titular ?? "—"}
                    </p>
                  </>
                ) : (
                  <p className="text-amber-600">
                    Este proveedor no tiene datos bancarios registrados. Se puede generar la orden
                    igual — tocará completarlos manualmente en la página de la orden de compra.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="contacto-proyecto">Contacto del proyecto (opcional)</Label>
            <Input
              id="contacto-proyecto"
              value={contactoProyecto}
              onChange={(e) => setContactoProyecto(e.target.value)}
              placeholder="Nombre de quien recibe en obra"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sitio-entrega">Sitio de entrega (opcional)</Label>
            <Input
              id="sitio-entrega"
              value={sitioEntrega}
              onChange={(e) => setSitioEntrega(e.target.value)}
              placeholder="Dirección o punto de entrega"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fecha-entrega">Fecha de entrega (opcional)</Label>
            <Input
              id="fecha-entrega"
              type="date"
              value={fechaEntrega}
              onChange={(e) => setFechaEntrega(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="condiciones-pago">Condiciones de pago (opcional)</Label>
            <Input
              id="condiciones-pago"
              value={condicionesPago}
              onChange={(e) => setCondicionesPago(e.target.value)}
              placeholder="Ej. Anticipado, 30 días..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="observaciones-oc">Observaciones (opcional)</Label>
            <Textarea
              id="observaciones-oc"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
            />
          </div>

          <Button className="w-full" disabled={!puedeGenerar} onClick={handleGenerar}>
            {generando ? "Generando..." : "Generar OC"}
          </Button>
          {!proveedor && (
            <p className="text-xs text-muted-foreground">Selecciona un proveedor para continuar.</p>
          )}
          {proveedor && !todasLasLineasValidas && (
            <p className="text-xs text-destructive">
              Revisa cantidad y precio de cada línea — ninguna cantidad puede superar lo pendiente.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}