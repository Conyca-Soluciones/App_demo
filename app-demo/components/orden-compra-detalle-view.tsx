"use client"

import { formatearFechaSinHora } from "@/lib/fechas"

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
import { ESTADO_VISIBLE_BADGE, muestraCancelar, sePuedeDesaprobar } from "@/lib/ordenes-compra-estado"
import { HistorialTimeline } from "@/components/historial-timeline"
import { RequisicionDetalleView } from "@/components/requisicion-detalle-view"
import { ETIQUETA_SOPORTE_ORDEN, type SoporteGuardado, type TipoSoporteOrden } from "@/lib/soportes"
import {
  obtenerOrdenCompraDetalle,
  obtenerPermisosOrdenCompra,
  enlaceSoporteOrden,
  listarSoportesOrden,
  desaprobarOrdenCompra,
  cancelarOrdenCompra,
  type OrdenCompraDetalle,
  type PermisosOrdenCompra,
  type RequisicionDeOrden,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

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
  // "desaprobar" | "cancelar": abre el diálogo de motivo de esa acción.
  const [accionAbierta, setAccionAbierta] = useState<"desaprobar" | "cancelar" | null>(null)
  const [motivoAccion, setMotivoAccion] = useState("")

  const [soportes, setSoportes] = useState<SoporteGuardado[]>([])
  // Requisición abierta en un diálogo encima de la orden.
  const [requisicionAbierta, setRequisicionAbierta] = useState<string | null>(null)

  function cargar() {
    Promise.all([obtenerOrdenCompraDetalle(ordenId), obtenerPermisosOrdenCompra(), listarSoportesOrden(ordenId)])
      .then(([o, p, s]) => {
        setOrden(o)
        setPermisos(p)
        setSoportes(s)
        setError(null)
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
      if (accionAbierta === "desaprobar") await desaprobarOrdenCompra(ordenId, motivoAccion.trim())
      else await cancelarOrdenCompra(ordenId, motivoAccion.trim())
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
  const puedeDesaprobar = permisos.puedeDesaprobar && sePuedeDesaprobar(orden)
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
          <h1 className="text-2xl font-semibold">Orden de Compra #{orden.numero}</h1>
          <Badge variant="outline" className={badge.clase}>{badge.label}</Badge>

          {orden.estado === "aprobada" && (
          <a href={`/almacen/ordenes-compra/${orden.id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="outline">Descargar PDF</Button>
          </a>
        )}
          {puedeDesaprobar && (
            <Button
              variant="outline"
              className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
              disabled={procesando}
              onClick={() => {
                setAccionAbierta("desaprobar")
                setMotivoAccion("")
              }}
            >
              Desaprobar
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
                <TableHead>Requisición</TableHead>
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
                    <TableCell className="whitespace-nowrap">
                      {linea.requisicion ? (
                        <button
                          type="button"
                          className="text-primary underline-offset-2 hover:underline"
                          onClick={() => setRequisicionAbierta(linea.requisicion!.id)}
                        >
                          N° {linea.requisicion.numero}
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
                <TableCell colSpan={5} className="text-right text-muted-foreground">
                  Subtotal
                </TableCell>
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  {formatoMoneda.format(orden.lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0))}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={5} className="text-right text-muted-foreground">
                  Descuento
                </TableCell>
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  −{formatoMoneda.format(totales.descuento)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={5} className="text-right text-muted-foreground">
                  IVA
                </TableCell>
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  {formatoMoneda.format(totales.iva)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={5} className="text-right font-medium">
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
                  N° {r.numero}
                  <span className="text-muted-foreground"> · solicitada por {r.solicitante ?? "—"}</span>
                </button>
              ))
            )}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Proveedor</p>
            <p>{orden.proveedorNombre}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Sitio de entrega</p>
            <p>{orden.sitioEntrega ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Fecha de entrega</p>
            <p>{formatearFechaSinHora(orden.fechaEntrega)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Contacto</p>
            <p>{orden.contactoNombre ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {orden.telefono ?? "—"} · {orden.email ?? "—"}
            </p>
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
              {accionAbierta === "desaprobar" ? "Desaprobar" : "Cancelar"} orden de compra #{orden.numero}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {accionAbierta === "desaprobar"
              ? "La orden vuelve a “Pendiente” y su pago vuelve a Aprobación de pagos (A&F) para aprobarlo o rechazarlo de nuevo."
              : "La orden queda cancelada y sus requisiciones vuelven a “Requisiciones por comprar” para poder comprarse de nuevo."}
          </p>
          {accionAbierta === "cancelar" && (
            <p className="text-sm font-medium">
              Esta orden ya fue creada: avísale al proveedor de la cancelación.
            </p>
          )}
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
              {procesando ? "Procesando..." : accionAbierta === "desaprobar" ? "Desaprobar orden" : "Cancelar orden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requisicionAbierta !== null} onOpenChange={(open) => !open && setRequisicionAbierta(null)}>
        <DialogContent className="flex h-[90vh] w-[90vw] max-w-none flex-col overflow-hidden sm:max-w-none">
          <DialogTitle className="sr-only">Detalle de la requisición</DialogTitle>
          {requisicionAbierta && (
            <RequisicionDetalleView requisicionId={requisicionAbierta} onCerrar={() => setRequisicionAbierta(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}