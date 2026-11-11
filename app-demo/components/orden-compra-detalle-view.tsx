"use client"

import { formatearFechaSinHora } from "@/lib/fechas"
import { TituloPestana } from "@/components/titulo-pestana"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { calcularLinea, calcularTotalesOrden } from "@/lib/ordenes-compra-calculos"
import { nombreUnidad } from "@/lib/unidades"
import { ESTADO_VISIBLE_BADGE, muestraCancelar } from "@/lib/ordenes-compra-estado"
import { HistorialTimeline } from "@/components/historial-timeline"
import { ETIQUETA_METODO_PAGO_OC, textoTitularPse } from "@/lib/metodo-pago-oc"
import { lunesDeLaSemana, textoTipoPagoOC } from "@/lib/tipo-pago-oc"
import { hoyColombia } from "@/lib/fechas"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { RequisicionDetalleView } from "@/components/requisicion-detalle-view"
import { FacturasOrden } from "@/components/facturas-orden"
import { ETIQUETA_SOPORTE_ORDEN, type SoporteGuardado, type TipoSoporteOrden } from "@/lib/soportes"
import {
  obtenerOrdenCompraDetalle,
  obtenerPermisosOrdenCompra,
  enlaceSoporteOrden,
  listarSoportesOrden,
  cancelarOrdenCompra,
  cambiarFechaCreditoOC,
  ordenCompraModificable,
  type OrdenCompraDetalle,
  type PermisosOrdenCompra,
  type RequisicionDeOrden,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

// Fecha sin hora o marca de tiempo: dd/mm/aaaa en hora de Colombia (lib/fechas).
const formatoFecha = (iso: string) => formatearFechaSinHora(iso)

const formatoMoneda = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})

// onCerrar es opcional: si se pasa (uso dentro de un Dialog), el botón de
// arriba cierra el diálogo en vez de navegar -- la página standalone
// (/almacen/ordenes-compra/[id]) sigue funcionando igual, sin pasarlo.
type OrdenCompraDetalleViewProps = { ordenId: string; onCerrar?: () => void }

export function OrdenCompraDetalleView({ ordenId, onCerrar }: OrdenCompraDetalleViewProps) {
  const router = useRouter()
  const [orden, setOrden] = useState<OrdenCompraDetalle | null>(null)
  const [permisos, setPermisos] = useState<PermisosOrdenCompra | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [procesando, setProcesando] = useState(false)
  // Abre el diálogo del motivo para cancelar (o retirar) la orden. Las OC no
  // se aprueban ni se desaprueban: las aprueba A&F con su pago.
  const [accionAbierta, setAccionAbierta] = useState<"cancelar" | null>(null)
  const [motivoAccion, setMotivoAccion] = useState("")
  // Fecha de pago del crédito en edición (null = no se está cambiando).
  const [fechaCreditoNueva, setFechaCreditoNueva] = useState<string | null>(null)

  const [soportes, setSoportes] = useState<SoporteGuardado[]>([])
  // Modificar (Compras): null = se puede; si no, por qué no (lo dice la base:
  // ya se envió el pago a liquidar, tiene entradas...). undefined = sin permiso.
  const [noModificable, setNoModificable] = useState<string | null | undefined>(undefined)
  // Requisición abierta en un diálogo encima de la orden.
  const [requisicionAbierta, setRequisicionAbierta] = useState<string | null>(null)

  function cargar() {
    // "Modificar" se consulta junto con lo demás: los botones salen a la vez.
    Promise.all([
      obtenerOrdenCompraDetalle(ordenId),
      obtenerPermisosOrdenCompra(),
      listarSoportesOrden(ordenId),
      ordenCompraModificable(ordenId).catch(() => undefined),
    ])
      .then(([o, p, s, modificable]) => {
        setOrden(o)
        setPermisos(p)
        setSoportes(s)
        setError(null)
        setNoModificable(
          p.rolCompras && (o.estado === "pendiente_aprobacion" || o.estado === "aprobada") ? modificable : undefined
        )
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la orden."))
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenId])

  async function confirmarAccion() {
    if (!accionAbierta || !motivoAccion.trim()) return
    setProcesando(true)
    setError(null)
    try {
      await cancelarOrdenCompra(ordenId, motivoAccion.trim())
      setAccionAbierta(null)
      setMotivoAccion("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.")
      setAccionAbierta(null)
    } finally {
      setProcesando(false)
    }
  }

  async function guardarFechaCredito() {
    if (!fechaCreditoNueva) return
    setProcesando(true)
    setError(null)
    try {
      await cambiarFechaCreditoOC(ordenId, fechaCreditoNueva)
      setFechaCreditoNueva(null)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar la fecha.")
    } finally {
      setProcesando(false)
    }
  }

  if (!orden || !permisos) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando orden...
          </>
        )}
      </div>
    )
  }

  const badge = ESTADO_VISIBLE_BADGE[orden.estadoVisible]
  // Aprobada: con cancelar_oc. Pendiente: también quien la creó ("Retirar").
  const puedeCancelar = muestraCancelar(orden, permisos)
  const esRetiro = orden.estado === "pendiente_aprobacion"
  // Misma fórmula que usan orden-compra-pdf.tsx y generar-oc-view.tsx, para
  // que el total mostrado acá, en el PDF y en la pantalla de creación sean
  // siempre el mismo número.
  const totales = calcularTotalesOrden(orden.lineas)
  const totalOrden = totales.total

  // Requisiciones de la orden, sin repetir, en orden de número.
  const porId = new Map<string, RequisicionDeOrden>()
  for (const l of orden.lineas) if (l.requisicion) porId.set(l.requisicion.id, l.requisicion)
  const requisiciones = [...porId.values()].sort((a, b) => a.numero - b.numero)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TituloPestana titulo={`Orden de compra ${orden.codigo}`} />
          <h1 className="text-2xl font-semibold">Orden de compra {orden.codigo}</h1>
          <Badge variant="outline" className={badge.clase}>{badge.label}</Badge>

          {orden.estado === "aprobada" && (
          <a href={`/almacen/ordenes-compra/${orden.id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="outline">Descargar PDF</Button>
          </a>
        )}
          {noModificable !== undefined && (
            <Button
              variant="outline"
              disabled={procesando || noModificable !== null}
              title={noModificable ?? "Cambiar insumos, precios o proveedor. La orden vuelve a quedar por aprobar."}
              onClick={() => router.push(`/almacen/generar-oc?modificar=${orden.id}`)}
            >
              Modificar
            </Button>
          )}
          {puedeCancelar && (
            <Button
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
              disabled={procesando}
              onClick={() => {
                setAccionAbierta("cancelar")
                setMotivoAccion("")
              }}
            >
              {esRetiro ? "Retirar orden" : "Cancelar orden"}
            </Button>
          )}
        </div>
        {/* Dentro de un diálogo (onCerrar) se cierra con la X del propio diálogo. */}
        {!onCerrar && (
          <Button variant="outline" onClick={() => router.push("/almacen/comprar-pedidos")}>
            Volver
          </Button>
        )}
      </div>
      {noModificable && (
        <p className="-mt-2 text-xs text-muted-foreground">No se puede modificar: {noModificable}</p>
      )}

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {orden.estado === "cancelada" && orden.motivoCancelacion && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <strong>Motivo de la cancelación:</strong> {orden.motivoCancelacion}
          {orden.canceladaAt ? ` — ${formatoFecha(orden.canceladaAt)}` : ""}
          <span className="mt-1 block">
            Esta orden ya había sido creada: recuerda avisarle al proveedor de la cancelación.
          </span>
        </div>
      )}

      {orden.estado === "pendiente_aprobacion" && orden.motivoDesaprobacion && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <strong>Desaprobada:</strong> {orden.motivoDesaprobacion}
        </div>
      )}

      {orden.estado === "rechazada" && orden.motivoRechazo && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <strong>Motivo del rechazo:</strong> {orden.motivoRechazo}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto lg:grid-cols-[2fr_1fr]">
        <div className="min-h-0 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cod</TableHead>
                <TableHead>Insumo</TableHead>
                <TableHead>Ítem</TableHead>
                <TableHead>REF</TableHead>
                <TableHead>UM</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio unit.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orden.lineas.map((linea) => {
                const c = calcularLinea(linea)
                return (
                  <TableRow key={linea.id}>
                    <TableCell className="text-muted-foreground">{linea.insumoCodigo}</TableCell>
                    <TableCell>{linea.insumoDescripcion}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{linea.itemCodigo ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {linea.requisicion ? (
                        <button
                          type="button"
                          className="text-primary underline-offset-2 hover:underline"
                          onClick={() => setRequisicionAbierta(linea.requisicion!.id)}
                        >
                          {linea.requisicion.codigo}
                        </button>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{linea.presentacion ? linea.presentacion.umCompra : (linea.um ?? "—")}</TableCell>
                    <TableCell className="text-right">
                      {(linea.presentacion ? linea.presentacion.cantidadCompra : linea.cantidad).toLocaleString("es-CO")}
                      {linea.presentacion && (
                        <span className="block text-[11px] text-muted-foreground">
                          1 {linea.presentacion.umCompra.toLowerCase()} ={" "}
                          {linea.presentacion.conversionCompra.toLocaleString("es-CO", { maximumFractionDigits: 4 })}{" "}
                          {nombreUnidad(linea.presentacion.unidadConversion)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatoMoneda.format(linea.presentacion ? linea.presentacion.precioCompra : linea.precioUnitario)}
                      {linea.presentacion && (
                        <span className="block text-[11px] text-muted-foreground">
                          por {linea.presentacion.umCompra.toLowerCase()}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatoMoneda.format(c.total)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6} className="text-right text-muted-foreground">
                  Subtotal
                </TableCell>
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  {formatoMoneda.format(orden.lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0))}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={6} className="text-right text-muted-foreground">
                  Descuento
                </TableCell>
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  −{formatoMoneda.format(totales.descuento)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={6} className="text-right text-muted-foreground">
                  IVA
                </TableCell>
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  {formatoMoneda.format(totales.iva)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={6} className="text-right font-medium">
                  Total orden
                </TableCell>
                <TableCell colSpan={2} className="text-right font-semibold">
                  {formatoMoneda.format(totalOrden)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        <div className="space-y-4 overflow-auto rounded-lg border bg-card p-4 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">Proyecto</p>
            <p>
              {orden.proyectoCodigo ?? "—"} {orden.proyectoNombre ? `· ${orden.proyectoNombre}` : ""}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">{requisiciones.length === 1 ? "Requisición" : "Requisiciones"}</p>
            {requisiciones.length === 0 ? (
              <p>—</p>
            ) : (
              requisiciones.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="block text-left text-primary underline-offset-2 hover:underline"
                  onClick={() => setRequisicionAbierta(r.id)}
                >
                  {r.codigo}
                  <span className="text-muted-foreground"> · solicitada por {r.solicitante ?? "—"}</span>
                </button>
              ))
            )}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Proveedor</p>
            <p>{orden.proveedorNombre}</p>
            {/* El teléfono y el correo de la orden son los del proveedor (Generar OC). */}
            {(orden.telefono || orden.email) && (
              <p className="text-xs text-muted-foreground">
                {[orden.telefono, orden.email].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Forma de pago</p>
            <p>{ETIQUETA_METODO_PAGO_OC[orden.metodoPago]}</p>
            {orden.metodoPago === "pse" && (
              <p className="text-xs text-muted-foreground">
                Titular: {textoTitularPse(orden.pseTitular, orden.proveedorNombre)}
              </p>
            )}
            {orden.pagoObservaciones && (
              <p className="whitespace-pre-line text-xs text-muted-foreground">{orden.pagoObservaciones}</p>
            )}
          </div>
          {textoTipoPagoOC(orden.tipoPago, orden.fechaPagoCredito) && (
            <div className="space-y-1">
              <p className="text-muted-foreground">Tipo de pago</p>
              <p>{textoTipoPagoOC(orden.tipoPago, orden.fechaPagoCredito)}</p>
              {orden.tipoPago === "credito" && orden.fechaPagoCredito && (
                <p className="text-xs text-muted-foreground">
                  {orden.creditoPagado
                    ? "El pago ya pasó a pago: la fecha ya no se cambia."
                    : lunesDeLaSemana(orden.fechaPagoCredito) <= hoyColombia()
                      ? `La fecha de pago ya llegó (semana del ${formatearFechaSinHora(lunesDeLaSemana(orden.fechaPagoCredito))}): el pago pasa a pago apenas Gerencia lo apruebe.`
                      : `Aprobado por Gerencia, el pago espera hasta el ${formatearFechaSinHora(lunesDeLaSemana(orden.fechaPagoCredito))} (lunes de esa semana) para pasar a pago.`}
                </p>
              )}
              {orden.tipoPago === "credito" &&
                !orden.creditoPagado &&
                permisos.puedeCambiarFechaCredito &&
                orden.estado !== "cancelada" &&
                orden.estado !== "rechazada" &&
                (fechaCreditoNueva === null ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={procesando}
                    onClick={() => setFechaCreditoNueva(orden.fechaPagoCredito ?? "")}
                  >
                    Cambiar fecha de pago
                  </Button>
                ) : (
                  <div className="space-y-1.5 rounded-md border p-2">
                    <CampoFecha id="fecha-credito-nueva" value={fechaCreditoNueva} onChange={(e) => setFechaCreditoNueva(e.target.value)} />
                    {fechaCreditoNueva && fechaCreditoNueva < hoyColombia() && (
                      <p className="text-xs text-destructive">No puede ser anterior a hoy.</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={procesando || !fechaCreditoNueva || fechaCreditoNueva < hoyColombia()}
                        onClick={guardarFechaCredito}
                      >
                        Guardar
                      </Button>
                      <Button size="sm" variant="outline" disabled={procesando} onClick={() => setFechaCreditoNueva(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
          <div className="space-y-1">
            <p className="text-muted-foreground">Sitio de entrega</p>
            <p>{orden.sitioEntrega ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Fecha estimada de entrega</p>
            <p>{formatearFechaSinHora(orden.fechaEntrega)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Contacto del proyecto</p>
            <p>{orden.contactoNombre ?? "—"}</p>
          </div>
          <div className="space-y-1 border-t pt-3">
            <p className="text-muted-foreground">Total de la orden</p>
            {totales.descuento > 0 && (
              <p className="text-xs text-muted-foreground">Descuento: −{formatoMoneda.format(totales.descuento)}</p>
            )}
            {totales.iva > 0 && (
              <p className="text-xs text-muted-foreground">IVA: {formatoMoneda.format(totales.iva)}</p>
            )}
            <p className="text-lg font-semibold">{formatoMoneda.format(totalOrden)}</p>
          </div>
          <div className="space-y-1 border-t pt-3">
            <p className="text-muted-foreground">Soporte</p>
            {soportes.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin soporte (orden de antes de que fuera obligatorio).</p>
            ) : (
              soportes.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={s.nombreArchivo}>
                    {ETIQUETA_SOPORTE_ORDEN[s.tipo as TipoSoporteOrden] ?? s.tipo} · {s.nombreArchivo}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0"
                    onClick={async () => {
                      // La pestaña se abre antes de pedir el enlace (si no, el navegador la bloquea).
                      const ventana = window.open("", "_blank")
                      try {
                        const url = await enlaceSoporteOrden(s.id)
                        if (ventana) ventana.location.href = url
                        else window.location.href = url
                      } catch (e) {
                        ventana?.close()
                        setError(e instanceof Error ? e.message : "No se pudo abrir el soporte.")
                      }
                    }}
                  >
                    Ver
                  </Button>
                </div>
              ))
            )}
          </div>
          <FacturasOrden
            ordenId={orden.id}
            aprobada={orden.estado === "aprobada"}
            puedeRegistrar={Boolean(permisos?.rolCompras)}
            totalOrden={totalOrden}
            lineas={orden.lineas.map((l) => ({
              id: l.id,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              porcentajeDescuento: l.porcentajeDescuento,
              porcentajeIva: l.porcentajeIva,
              presentacion: l.presentacion,
              insumoCodigo: l.insumoCodigo,
              insumoDescripcion: l.insumoDescripcion,
              unidad: l.presentacion?.umCompra ?? l.um,
            }))}
          />
          {orden.anticipoPorcentaje != null && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="font-medium text-amber-800">
                Orden con anticipo ({orden.anticipoPorcentaje.toLocaleString("es-CO")}%)
              </p>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Valor total de la orden</span>
                <span className="font-medium tabular-nums">{formatoMoneda.format(Math.round(totalOrden))}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground">
                  {orden.estado === "pendiente_aprobacion" ? "A pagar hoy (anticipo)" : "Anticipo"}
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {formatoMoneda.format(Math.round((Math.round(totalOrden) * orden.anticipoPorcentaje) / 100))}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">Saldo</span>
                <span className="font-medium tabular-nums">
                  {formatoMoneda.format(
                    Math.round(totalOrden) - Math.round((Math.round(totalOrden) * orden.anticipoPorcentaje) / 100)
                  )}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                El saldo se paga{" "}
                {orden.saldoModo === "fecha" && orden.saldoFecha
                  ? `el ${formatearFechaSinHora(orden.saldoFecha)}.`
                  : "al ser entregada la orden por completo."}
                {orden.estado === "pendiente_aprobacion" &&
                  " La orden se aprueba en A&F › Aprobación de pagos al aprobar el anticipo; el saldo llega después."}
              </p>
            </div>
          )}
          <div className="space-y-1 border-t pt-3">
            <p className="text-muted-foreground">Creada por</p>
            <p>
              {orden.creadaPorNombre ?? "—"} — {formatoFecha(orden.createdAt)}
            </p>
          </div>
          {orden.aprobadaPorNombre && (
            <div className="space-y-1">
              <p className="text-muted-foreground">
                {orden.estado === "rechazada" ? "Rechazada por" : "Aprobada por"}
              </p>
              <p>
                {orden.aprobadaPorNombre}
                {orden.aprobadaAt ? ` — ${formatoFecha(orden.aprobadaAt)}` : ""}
              </p>
            </div>
          )}

          <div className="space-y-2 border-t pt-3">
            <p className="font-medium">Historial</p>
            {/* key: se recarga cuando cambia el estado de la orden */}
            <HistorialTimeline
              key={`${orden.estado}-${orden.estadoEntrega}`}
              tipo="orden_compra"
              id={orden.id}
            />
          </div>

        </div>
      </div>

      <Dialog
        open={accionAbierta !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setAccionAbierta(null)
            setMotivoAccion("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cancelar orden de compra {orden.codigo}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            La orden queda cancelada y sus requisiciones vuelven a “Requisiciones por comprar” para poder comprarse de nuevo.
          </p>
          <p className="text-sm font-medium">Esta orden ya fue creada: avísale al proveedor de la cancelación.</p>
          <Textarea
            placeholder="Motivo (obligatorio)"
            value={motivoAccion}
            onChange={(e) => setMotivoAccion(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccionAbierta(null)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={!motivoAccion.trim() || procesando}
              onClick={confirmarAccion}
            >
              {procesando ? "Procesando..." : "Cancelar orden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requisicionAbierta !== null} onOpenChange={(open) => !open && setRequisicionAbierta(null)}>
        <DialogContent className="top-[5vh] left-[5vw] flex h-[90vh] w-[90vw] max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden sm:max-w-none">
          <DialogTitle className="sr-only">Detalle de la requisición</DialogTitle>
          {requisicionAbierta && (
            <RequisicionDetalleView requisicionId={requisicionAbierta} onCerrar={() => setRequisicionAbierta(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}