"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
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
import { BadgeCompraRequisicion, BadgeEstadoRequisicion } from "@/components/badge-requisicion"
import { HistorialTimeline } from "@/components/historial-timeline"
import { SolicitudInsumoDialog } from "@/components/dialogue-nuevo-pedido"
import { createClient } from "@/lib/supabase/client"
import { formatearFechaSinHora } from "@/lib/fechas"
import {
  obtenerRequisicion,
  cancelarRequisicion,
  cargarRequisicionParaEditar,
  type EdicionRequisicion,
  type RequisicionDetalle,
} from "@/app/(app)/almacen/actions"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

// onCerrar: si se pasa, la vista va dentro de un diálogo (se cierra con su X) y no
// muestra el botón Volver; sin él es la página completa.
export function RequisicionDetalleView({
  requisicionId,
  onCerrar,
}: {
  requisicionId: string
  onCerrar?: () => void
}) {
  const router = useRouter()
  const [req, setReq] = useState<RequisicionDetalle | null>(null)
  const [usuarioId, setUsuarioId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [procesando, setProcesando] = useState(false)
  // Se cambia al recargar para que el historial vuelva a pedirse.
  const [version, setVersion] = useState(0)

  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [edicion, setEdicion] = useState<EdicionRequisicion | null>(null)
  const [editando, setEditando] = useState(false)

  function cargar() {
    setError(null)
    obtenerRequisicion(requisicionId)
      .then((r: RequisicionDetalle) => {
        setReq(r)
        setVersion((v) => v + 1)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la requisición."))
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requisicionId])

  useEffect(() => {
    // getClaims valida el token localmente; getUser hacía una llamada a Supabase Auth.
    createClient()
      .auth.getClaims()
      .then(({ data }) => setUsuarioId(data?.claims?.sub ?? null))
  }, [])

  async function confirmarCancelacion() {
    if (!motivo.trim()) return
    setProcesando(true)
    setError(null)
    try {
      await cancelarRequisicion(requisicionId, motivo.trim())
      setCancelando(false)
      setMotivo("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar la requisición.")
      setCancelando(false)
    } finally {
      setProcesando(false)
    }
  }

  async function abrirEdicion() {
    setProcesando(true)
    setError(null)
    try {
      setEdicion(await cargarRequisicionParaEditar(requisicionId))
      setEditando(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir la edición.")
    } finally {
      setProcesando(false)
    }
  }

  if (!req) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando requisición...
          </>
        )}
      </div>
    )
  }

  // Quien la hizo puede modificarla o cancelarla mientras esté pendiente.
  const esDueno = usuarioId !== null && req.solicitanteId === usuarioId
  const puedeEditar = esDueno && req.estado === "pendiente"
  const mostrarCompra = req.estado === "aprobada"

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Requisición #{req.numero}</h1>
          <BadgeEstadoRequisicion estado={req.estado} />
          {req.urgente && <Badge variant="destructive">Urgente</Badge>}
          {mostrarCompra && (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Compra: <BadgeCompraRequisicion estadoCompra={req.estadoCompra} />
            </span>
          )}
          {puedeEditar && (
            <>
              <Button variant="outline" disabled={procesando} onClick={abrirEdicion}>
                Modificar
              </Button>
              <Button
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                disabled={procesando}
                onClick={() => {
                  setCancelando(true)
                  setMotivo("")
                }}
              >
                Cancelar requisición
              </Button>
            </>
          )}
        </div>
        {!onCerrar && (
          <Button variant="outline" onClick={() => router.push("/almacen/registro-requisiciones")}>
            Volver
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {req.estado === "rechazada" && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <strong>Motivo del rechazo:</strong> {req.motivoRechazo ?? "(sin motivo)"}
        </div>
      )}
      {req.estado === "cancelada" && req.motivoCancelacion && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <strong>Motivo de la cancelación:</strong> {req.motivoCancelacion}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto lg:grid-cols-[2fr_1fr]">
        <div className="min-h-0 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cod</TableHead>
                <TableHead>Insumo</TableHead>
                <TableHead>UM</TableHead>
                <TableHead>Ítem del presupuesto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                {mostrarCompra && <TableHead className="text-right">En órdenes de compra</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {req.lineas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-muted-foreground">{l.insumoCodigo}</TableCell>
                  <TableCell className="whitespace-normal break-words">
                    {l.insumoDescripcion}
                    {l.rechazadaPorCompras && (
                      <span
                        className="ml-2 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800"
                        title={l.motivoRechazoCompras ?? undefined}
                      >
                        Rechazado por Compras
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{l.insumoUm ?? "—"}</TableCell>
                  <TableCell className="whitespace-normal break-words">
                    <span className="font-mono text-muted-foreground">{l.itemCodigo}</span>{" "}
                    {l.itemDescripcion}
                  </TableCell>
                  <TableCell className="text-right">{l.cantidad.toLocaleString("es-CO")}</TableCell>
                  {mostrarCompra && (
                    <TableCell className="text-right">
                      {l.rechazadaPorCompras ? (
                        "—"
                      ) : (
                        <span className={l.comprado >= l.cantidad ? "text-emerald-700" : undefined}>
                          {l.comprado.toLocaleString("es-CO")} / {l.cantidad.toLocaleString("es-CO")}
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-4 overflow-auto rounded-lg border bg-card p-4 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">Proyecto</p>
            <p>
              {req.proyectoCodigo ?? "—"} {req.proyectoNombre ? `· ${req.proyectoNombre}` : ""}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Solicitado por</p>
            <p>{req.solicitanteNombre ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Fecha de solicitud</p>
            <p>{formatoFecha(req.createdAt)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Fecha requerida</p>
            <p>{req.fechaRequerida ? formatearFechaSinHora(req.fechaRequerida) : "—"}</p>
          </div>
          {req.resueltoPorNombre && (
            <div className="space-y-1">
              <p className="text-muted-foreground">
                {req.estado === "rechazada" ? "Rechazada por" : "Aprobada por"}
              </p>
              <p>
                {req.resueltoPorNombre}
                {req.resueltoAt ? ` · ${formatoFecha(req.resueltoAt)}` : ""}
              </p>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-muted-foreground">Observaciones</p>
            <p className="whitespace-pre-wrap break-words">{req.observaciones ?? "—"}</p>
          </div>
          {req.soporteUrl && (
            <div className="space-y-1">
              <p className="text-muted-foreground">Soporte</p>
              <a href={req.soporteUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                Ver adjunto
              </a>
            </div>
          )}

          <div className="space-y-2 border-t pt-4">
            <p className="font-medium">Historial</p>
            <HistorialTimeline key={version} tipo="requisicion" id={requisicionId} />
          </div>
        </div>
      </div>

      <Dialog
        open={cancelando}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setCancelando(false)
            setMotivo("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar requisición #{req.numero}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se cancela la requisición completa ({req.nLineas}{" "}
            {req.nLineas === 1 ? "insumo" : "insumos"}). Queda registrada como cancelada y las
            cantidades vuelven a estar disponibles en el presupuesto.
          </p>
          <Textarea
            placeholder="Motivo de la cancelación (obligatorio)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(false)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || procesando}
              onClick={confirmarCancelacion}
            >
              {procesando ? "Cancelando..." : "Cancelar requisición"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {edicion && (
        <SolicitudInsumoDialog
          open={editando}
          onOpenChange={setEditando}
          versionId={edicion.versionId}
          edicion={edicion}
          onPedidoCreado={cargar}
        />
      )}
    </div>
  )
}
