"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ClipboardList, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { nombreUnidad, unidadesDeCompra } from "@/lib/unidades"
import {
  cantidadPorPresentacion,
  conversionValida,
  maximoPresentaciones,
  presentacionesPara,
} from "@/lib/presentacion-compra"

// Valor del desplegable "UM disponible" para la opción normal: la unidad de
// compra del insumo (la del maestro). Cualquier otra es una presentación.
const UM_PROPIA = "__propia__"

// Conversión escrita en pantalla ("1,44" o "50"): número mayor que cero, o null.
function numeroConversion(texto: string): number | null {
  const n = Number(texto.trim().replace(",", "."))
  return texto.trim() && Number.isFinite(n) && n > 0 ? n : null
}

const formatoCantidad = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

const CLAVE_SELECCION = "compras:seleccion"

type SeleccionGuardada = { proyectoId: string; pedidoIds: string[] }

type LineaForm = {
  // "UM disponible": "" = la unidad de compra del insumo; si no, la
  // presentación elegida (CAJA, ROLLO...) y entonces `conversion` es
  // 1 presentación = conversion unidades de la requisición.
  umCompra: string
  // conversión: 1 unidad de compra = conversion unidades de la requisición
  conversion: string
  cantidad: string
  precioUnitario: string
  porcentajeDescuento: string
  porcentajeIva: string
}

const formatoMoneda = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

// Precio muy lejos del de referencia del maestro (3 veces o más, por encima o
// por debajo). Un precio mal digitado en una orden aprobada entra al precio
// promedio con el que se valoran los APU (caso real: Amarre teja a $8.000 con
// referencia $325). Se compara contra vr_unitario del maestro y no contra el
// precio efectivo, porque ese puede estar ya contaminado por compras malas.
const FACTOR_ALERTA_PRECIO = 3
function alertaPrecio(precio: number, referencia: number | null): string | null {
  if (referencia == null || referencia <= 1 || !Number.isFinite(precio)) return null
  if (precio >= referencia * FACTOR_ALERTA_PRECIO) {
    return `${Math.round(precio / referencia)} veces el precio de referencia (${formatoMoneda(referencia)})`
  }
  if (precio <= referencia / FACTOR_ALERTA_PRECIO) {
    return `muy por debajo del precio de referencia (${formatoMoneda(referencia)})`
  }
  return null
}

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
  // Anticipo (A&F): % del total y cuándo se paga el saldo.
  const [conAnticipo, setConAnticipo] = useState(false)
  const [anticipoPct, setAnticipoPct] = useState("")
  const [saldoModo, setSaldoModo] = useState<"entrega" | "fecha">("entrega")
  const [saldoFecha, setSaldoFecha] = useState("")

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
                umCompra: "",
                conversion: String(p.factor),
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

  // Al cambiar la conversión, la cantidad sugerida pasa a las unidades
  // completas que cubren lo pendiente con esa conversión.
  function actualizarConversion(pedido: PedidoParaComprar, valor: string) {
    const conv = numeroConversion(valor)
    setLineas((prev) => {
      const actual = prev[pedido.id]
      let cantidad: string | null = null
      if (conv != null) {
        cantidad = actual?.umCompra
          ? conversionValida(conv)
            ? String(maximoPresentaciones(pedido.pendienteUso, conv, pedido.factor))
            : null
          : String(unidadesDeCompra(pedido.pendienteUso, conv))
      }
      return {
        ...prev,
        [pedido.id]: { ...actual, conversion: valor, ...(cantidad != null ? { cantidad } : {}) },
      }
    })
  }

  // "UM disponible": la opción normal vuelve a lo de siempre (unidad del
  // insumo, conversión del APU); una presentación (caja...) deja la conversión
  // y la cantidad en blanco hasta que Compras escriba cuánto trae cada una.
  function cambiarUm(pedido: PedidoParaComprar, valor: string) {
    const um = valor === UM_PROPIA ? "" : valor
    setLineas((prev) => ({
      ...prev,
      [pedido.id]: {
        ...prev[pedido.id],
        umCompra: um,
        conversion: um ? "" : String(pedido.factor),
        cantidad: um ? "" : String(pedido.cantidadPendiente),
      },
    }))
  }

  // Devuelve los números parseados de una línea, o null si algo es inválido
  // (cantidad vacía/0/negativa/mayor a lo pendiente, o precio vacío/negativo).
  function lineaValida(pedido: PedidoParaComprar) {
    const l = lineas[pedido.id]
    if (!l) return null
    const factor = numeroConversion(l.conversion)
    if (factor == null) return null
    const cantidad = Number(l.cantidad)
    const precioUnitario = Number(l.precioUnitario)
    const porcentajeDescuento = Number(l.porcentajeDescuento || "0")
    const porcentajeIva = Number(l.porcentajeIva || "0")

    // Otra presentación (cajas): la cantidad son unidades de esa presentación y
    // el precio es por una de ellas; la base deriva lo del insumo.
    if (l.umCompra) {
      if (!conversionValida(factor)) return null
      if (
        !l.cantidad.trim() ||
        !Number.isInteger(cantidad) ||
        cantidad <= 0 ||
        cantidad > maximoPresentaciones(pedido.pendienteUso, factor, pedido.factor)
      )
        return null
      if (!l.precioUnitario.trim() || Number.isNaN(precioUnitario) || precioUnitario < 0) return null
      if (Number.isNaN(porcentajeDescuento) || porcentajeDescuento < 0 || porcentajeDescuento > 100) return null
      if (Number.isNaN(porcentajeIva) || porcentajeIva < 0 || porcentajeIva > 100) return null
      return {
        cantidad,
        factor: pedido.factor,
        precioUnitario,
        porcentajeDescuento,
        porcentajeIva,
        presentacion: {
          umCompra: l.umCompra,
          conversionCompra: factor,
          cantidadCompra: cantidad,
          precioCompra: precioUnitario,
        },
      }
    }

    // Cantidad: solo enteros (Entradas solo recibe enteros; una línea de 2,5
    // dejaría 0,5 imposible de recibir). Precio y porcentajes sí decimales.
    // Hasta las unidades completas que cubren lo pendiente con esta conversión.
    if (
      !l.cantidad.trim() ||
      !Number.isInteger(cantidad) ||
      cantidad <= 0 ||
      cantidad > unidadesDeCompra(pedido.pendienteUso, factor)
    )
      return null
    if (!l.precioUnitario.trim() || Number.isNaN(precioUnitario) || precioUnitario < 0) return null
    if (Number.isNaN(porcentajeDescuento) || porcentajeDescuento < 0 || porcentajeDescuento > 100) return null
    if (Number.isNaN(porcentajeIva) || porcentajeIva < 0 || porcentajeIva > 100) return null

    return { cantidad, factor, precioUnitario, porcentajeDescuento, porcentajeIva, presentacion: undefined }
  }

  const todasLasLineasValidas = pedidos.length > 0 && pedidos.every((p) => lineaValida(p) !== null)

  const totales = todasLasLineasValidas
    ? calcularTotalesOrden(pedidos.map((p) => lineaValida(p)!))
    : null

  // Hoy en hora local (YYYY-MM-DD): la fecha del saldo no puede ser anterior.
  const hoy = new Date().toLocaleDateString("en-CA")
  const pctNumero = Number(anticipoPct)
  const anticipoValido =
    !conAnticipo ||
    (anticipoPct.trim() !== "" &&
      Number.isFinite(pctNumero) &&
      pctNumero > 0 &&
      pctNumero < 100 &&
      (saldoModo === "entrega" || (saldoFecha !== "" && saldoFecha >= hoy)))
  const montoAnticipo = conAnticipo && totales && anticipoValido ? Math.round((totales.total * pctNumero) / 100) : null

  const puedeGenerar =
    proveedor !== null && !cargandoProveedor && todasLasLineasValidas && anticipoValido && !generando

  async function handleGenerar() {
    if (!seleccion || !proveedor || !todasLasLineasValidas) return
    // Precios sospechosos: confirmar antes de crear la orden (ver alertaPrecio).
    const sospechosos = pedidos
      .map((p) => {
        const alerta = alertaPrecio(Number(lineas[p.id]?.precioUnitario), p.valorUnitarioProyectado)
        return alerta ? `• ${p.insumoDescripcion}: ${alerta}` : null
      })
      .filter((x): x is string => x !== null)
    if (
      sospechosos.length > 0 &&
      !window.confirm(
        `Revisa estos precios antes de crear la orden:\n\n${sospechosos.join("\n")}\n\nUn precio equivocado en una orden aprobada afecta el precio promedio con el que se valoran los APU. ¿Los precios son correctos?`
      )
    ) {
      return
    }
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
        ...(conAnticipo
          ? { anticipoPorcentaje: pctNumero, saldoModo, saldoFecha: saldoModo === "fecha" ? saldoFecha : null }
          : {}),
        lineas: pedidos.map((p) => {
          const l = lineaValida(p)!
          return {
            pedidoId: p.id,
            cantidadComprar: l.cantidad,
            factor: l.factor,
            precioUnitario: l.precioUnitario,
            porcentajeDescuento: l.porcentajeDescuento,
            porcentajeIva: l.porcentajeIva,
            ...(l.presentacion ? { presentacion: l.presentacion } : {}),
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
                    <TableHead className="text-right">Solicitado</TableHead>
                    <TableHead className="w-40">UM disponible</TableHead>
                    <TableHead className="w-44">Conversión</TableHead>
                    <TableHead className="w-28 text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Equivale a</TableHead>
                    <TableHead className="w-28 text-right">Vr. Unitario</TableHead>
                    <TableHead className="w-20 text-right">% Dto.</TableHead>
                    <TableHead className="w-20 text-right">% IVA</TableHead>
                    <TableHead className="w-28 text-right">Total línea</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidos.map((pedido) => {
                    const l = lineas[pedido.id] ?? {
                      umCompra: "",
                      conversion: "1",
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
                        {/* whitespace-normal: la celda de tabla trae nowrap por defecto y los
                            nombres largos se salían de su columna tapando las demás. Ahora
                            bajan a una segunda línea (máximo 2); el nombre completo queda
                            en el tooltip. */}
                        <TableCell className="min-w-56 max-w-72 whitespace-normal">
                          <span className="line-clamp-2 break-words" title={pedido.insumoDescripcion}>
                            {pedido.insumoDescripcion}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {formatoCantidad(pedido.pendienteUso)} {nombreUnidad(pedido.unidadUso)}
                          {pedido.pendienteUso < pedido.cantidadUso && (
                            <span className="block text-[11px] text-muted-foreground">
                              de {formatoCantidad(pedido.cantidadUso)} pedidos
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select value={l.umCompra || UM_PROPIA} onValueChange={(v) => cambiarUm(pedido, v ?? UM_PROPIA)}>
                            <SelectTrigger className="h-8 w-36 text-xs" aria-label="UM disponible">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UM_PROPIA}>
                                {nombreUnidad(pedido.um) || "und"} (del insumo)
                              </SelectItem>
                              {presentacionesPara(pedido.um).map((u) => (
                                <SelectItem key={u} value={u}>
                                  {u.charAt(0) + u.slice(1).toLowerCase()}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 whitespace-nowrap text-xs">
                            <span>1 {l.umCompra ? l.umCompra.toLowerCase() : nombreUnidad(pedido.um) || "und"} =</span>
                            <Input
                              inputMode="decimal"
                              value={l.conversion}
                              onChange={(e) => actualizarConversion(pedido, e.target.value)}
                              placeholder={l.umCompra ? "¿cuánto trae?" : undefined}
                              className={`h-8 w-16 text-right ${
                                numeroConversion(l.conversion) == null ||
                                (l.umCompra && !conversionValida(numeroConversion(l.conversion) ?? 0))
                                  ? "border-destructive"
                                  : ""
                              }`}
                              aria-label="Conversión"
                            />
                            <span>{nombreUnidad(pedido.unidadUso)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="1"
                            inputMode="numeric"
                            value={l.cantidad}
                            onChange={(e) => actualizarLinea(pedido.id, "cantidad", e.target.value)}
                            className={`text-right ${!valida ? "border-destructive" : ""}`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {(() => {
                            const conv = numeroConversion(l.conversion)
                            const cant = Number(l.cantidad)
                            if (conv == null || !(cant > 0)) return "—"
                            const equivale = cant * conv
                            const cubre = equivale >= pedido.pendienteUso - 1e-9
                            return (
                              <>
                                {formatoCantidad(equivale)} {nombreUnidad(pedido.unidadUso)}
                                <span className={`block text-[11px] ${cubre ? "text-emerald-700" : "text-amber-700"}`}>
                                  {cubre
                                    ? equivale > pedido.pendienteUso + 1e-9
                                      ? `cubre; ${formatoCantidad(equivale - pedido.pendienteUso)} de más`
                                      : "cubre lo solicitado"
                                    : `faltan ${formatoCantidad(pedido.pendienteUso - equivale)}`}
                                </span>
                              </>
                            )
                          })()}
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
                          {l.umCompra && (
                            <p className="mt-0.5 text-right text-[10px] leading-tight text-muted-foreground">
                              por {l.umCompra.toLowerCase()}
                            </p>
                          )}
                          {(() => {
                            // El precio de referencia del maestro es por unidad del
                            // insumo: con una presentación se compara el equivalente.
                            const conv = numeroConversion(l.conversion)
                            const precio = Number(l.precioUnitario)
                            const porUm = l.umCompra && conv != null ? cantidadPorPresentacion(conv, pedido.factor) : 1
                            const alerta =
                              l.precioUnitario.trim() && porUm > 0
                                ? alertaPrecio(precio / porUm, pedido.valorUnitarioProyectado)
                                : null
                            return alerta ? (
                              <p className="mt-0.5 text-right text-[10px] leading-tight text-amber-700">{alerta}</p>
                            ) : null
                          })()}
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

          <div className="space-y-2 rounded-lg border p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox checked={conAnticipo} onCheckedChange={(v) => setConAnticipo(v === true)} />
              Anticipo
            </label>
            {conAnticipo && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="anticipo-pct">Porcentaje del anticipo (%)</Label>
                  <Input
                    id="anticipo-pct"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max="99.99"
                    step="0.01"
                    value={anticipoPct}
                    onChange={(e) => setAnticipoPct(e.target.value)}
                    placeholder="Ej. 30"
                  />
                  {montoAnticipo !== null && totales && (
                    <p className="text-xs text-muted-foreground">
                      Anticipo {formatoMoneda(montoAnticipo)} · Saldo {formatoMoneda(Math.round(totales.total) - montoAnticipo)}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>¿Cuándo se paga el saldo?</Label>
                  <Select value={saldoModo} onValueChange={(v) => setSaldoModo((v ?? "entrega") as "entrega" | "fecha")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="entrega">Al ser entregado</SelectItem>
                      <SelectItem value="fecha">En una fecha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {saldoModo === "fecha" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="saldo-fecha">Fecha de pago del saldo</Label>
                    <Input
                      id="saldo-fecha"
                      type="date"
                      min={hoy}
                      value={saldoFecha}
                      onChange={(e) => setSaldoFecha(e.target.value)}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Al aprobar la orden se aprueba el pago del anticipo. El saldo llega a aprobación de Gerencia
                  {saldoModo === "entrega" ? " cuando la orden quede entregada por completo." : " en la fecha indicada."}
                </p>
              </div>
            )}
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