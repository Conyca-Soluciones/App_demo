"use client"

import { formatearFechaSinHora } from "@/lib/fechas"

// app/(app)/admin-tecnico/page.tsx
//
// Aprobación de REQUISICIONES, con el mismo formato que Aprobación de órdenes
// de compra: una lista (una fila por requisición) y el botón Ver abre su
// detalle encima. Se aprueba o rechaza la requisición ENTERA, no insumo por
// insumo. Quien aprueba ve todos los proyectos.

import { useEffect, useState } from "react"
import { Check, ClipboardCheck, Eye, Loader2, Undo2, X } from "lucide-react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { BadgeCompraRequisicion, BadgeEstadoRequisicion } from "@/components/badge-requisicion"
import { FiltrosRequisicionesPanel } from "@/components/filtros-requisiciones"
import { RequisicionDetalleView } from "@/components/requisicion-detalle-view"
import type { FiltrosRequisiciones } from "@/app/(app)/almacen/actions"
import {
  verRequisicionesAprobacion,
  resolverRequisicion,
  desaprobarRequisicion,
  obtenerPermisosPedidos,
  type RequisicionParaAprobar,
  type PermisosPedidos,
} from "./actions"

type TipoAccion = "rechazar" | "desaprobar"
const TEXTO_ACCION: Record<TipoAccion, { titulo: string; explicacion: string; boton: string }> = {
  rechazar: {
    titulo: "Rechazar requisición",
    explicacion:
      "Se rechaza la requisición completa y sus cantidades vuelven al presupuesto. Quien la pidió recibe una notificación con este motivo.",
    boton: "Rechazar requisición",
  },
  desaprobar: {
    titulo: "Desaprobar requisición",
    explicacion:
      "Vuelve a pendiente y se podrá aprobar o rechazar de nuevo. No se puede si algún insumo ya está en una orden de compra.",
    boton: "Desaprobar requisición",
  },
}

export default function AdminTecnico() {
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [requisiciones, setRequisiciones] = useState<RequisicionParaAprobar[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [idsEnProceso, setIdsEnProceso] = useState<Set<string>>(new Set())
  const [permisos, setPermisos] = useState<PermisosPedidos | null>(null)
  // Rechazar / desaprobar piden motivo; Ver abre el detalle encima de la lista.
  const [accion, setAccion] = useState<{ tipo: TipoAccion; req: RequisicionParaAprobar } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesandoAccion, setProcesandoAccion] = useState(false)
  const [abiertaId, setAbiertaId] = useState<string | null>(null)
  // Últimos filtros consultados (para repetir la consulta tras una acción).
  const [filtros, setFiltros] = useState<FiltrosRequisiciones>({})

  function cargar(f: FiltrosRequisiciones = filtros) {
    setCargando(true)
    setError(null)
    verRequisicionesAprobacion(f)
      .then((lista: RequisicionParaAprobar[]) => setRequisiciones(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las requisiciones."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    obtenerPermisosPedidos()
      .then(setPermisos)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los permisos."))
  }, [])

  async function confirmarAccion() {
    if (!accion || !motivo.trim()) return
    setProcesandoAccion(true)
    setError(null)
    try {
      if (accion.tipo === "rechazar") {
        await resolverRequisicion(accion.req.id, "rechazado", motivo.trim())
      } else {
        await desaprobarRequisicion(accion.req.id, motivo.trim())
      }
      setAccion(null)
      setMotivo("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.")
      setAccion(null)
    } finally {
      setProcesandoAccion(false)
    }
  }

  async function aprobar(id: string) {
    setIdsEnProceso((prev) => new Set(prev).add(id))
    setError(null)
    try {
      await resolverRequisicion(id, "aprobado")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la requisición.")
    } finally {
      setIdsEnProceso((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Aprobación de requisiciones</h1>
          <p className="text-sm text-muted-foreground">
            Requisiciones de insumos de todos los proyectos. Se aprueba o rechaza la requisición completa.
          </p>
        </div>
      </header>

      <main className="flex w-full flex-1 gap-4 p-6">
        <FiltrosRequisicionesPanel
          conSoloPorAprobar
          cargando={cargando}
          onError={setError}
          onConsultar={(f) => {
            setFiltros(f)
            cargar(f)
          }}
        />

        <div className="min-w-0 flex-1 space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {requisiciones === null && !cargando ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar. Con &quot;Solo por Aprobar&quot; ves
              únicamente las que están esperando aprobación.
            </div>
          ) : cargando && requisiciones === null ? (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando requisiciones...
            </div>
          ) : requisiciones !== null && requisiciones.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              <ClipboardCheck className="h-8 w-8" />
              Ninguna requisición coincide con los filtros.
            </div>
          ) : requisiciones !== null ? (
            <div className="overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N°</TableHead>
                    <TableHead>Proyecto</TableHead>
                    <TableHead>Solicitado por</TableHead>
                    <TableHead>Fecha requisición</TableHead>
                    <TableHead>Fecha requerida</TableHead>
                    <TableHead className="text-center">Insumos</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requisiciones.map((req) => {
                    const puedeGestionar = permisos?.aprobar && req.estado === "pendiente"
                    const puedeDesaprobar = permisos?.desaprobar && req.estado === "aprobada"
                    const procesando = idsEnProceso.has(req.id)
                    return (
                      <TableRow key={req.id} className={req.urgente && req.estado === "pendiente" ? "bg-amber-50/60" : undefined}>
                        <TableCell className="font-medium">{req.numero}</TableCell>
                        <TableCell>{req.proyectoCodigo ?? req.proyectoNombre ?? "—"}</TableCell>
                        <TableCell>{req.solicitanteNombre ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {new Date(req.createdAt).toLocaleDateString("es-CO")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {req.fechaRequerida ? formatearFechaSinHora(req.fechaRequerida) : "—"}
                        </TableCell>
                        <TableCell className="text-center">{req.nLineas}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <BadgeEstadoRequisicion estado={req.estado} />
                            {req.urgente && <Badge variant="destructive">Urgente</Badge>}
                            {req.estado === "aprobada" && req.estadoCompra && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                Compra: <BadgeCompraRequisicion estadoCompra={req.estadoCompra} />
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => setAbiertaId(req.id)}>
                              <Eye className="mr-1.5 h-4 w-4" />
                              Ver
                            </Button>
                            {puedeDesaprobar && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                                disabled={procesando}
                                onClick={() => {
                                  setAccion({ tipo: "desaprobar", req })
                                  setMotivo("")
                                }}
                                aria-label={`Desaprobar requisición ${req.numero}`}
                              >
                                <Undo2 className="mr-1.5 h-4 w-4" />
                                Desaprobar
                              </Button>
                            )}
                            {puedeGestionar && (
                              <>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                                  disabled={procesando}
                                  onClick={() => aprobar(req.id)}
                                  aria-label={`Aprobar requisición ${req.numero}`}
                                >
                                  {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                                  disabled={procesando}
                                  onClick={() => {
                                    setAccion({ tipo: "rechazar", req })
                                    setMotivo("")
                                  }}
                                  aria-label={`Rechazar requisición ${req.numero}`}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
      </main>

      <Dialog
        open={accion !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setAccion(null)
            setMotivo("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {accion ? `${TEXTO_ACCION[accion.tipo].titulo} #${accion.req.numero}` : ""}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {accion?.req.nLineas} {accion?.req.nLineas === 1 ? "insumo" : "insumos"} (
            {accion?.req.solicitanteNombre ?? "sin solicitante"}).{" "}
            {accion ? TEXTO_ACCION[accion.tipo].explicacion : ""}
          </p>
          <Textarea
            placeholder="Motivo (obligatorio)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccion(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || procesandoAccion}
              onClick={confirmarAccion}
            >
              {procesandoAccion ? "Procesando..." : accion ? TEXTO_ACCION[accion.tipo].boton : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle encima de la lista (igual que Aprobación de órdenes de compra). */}
      <Dialog
        open={abiertaId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAbiertaId(null)
            if (requisiciones !== null) cargar()
          }
        }}
      >
        <DialogContent className="flex h-[90vh] w-[90vw] max-w-none flex-col overflow-hidden sm:max-w-none">
          <DialogTitle className="sr-only">Detalle de la requisición</DialogTitle>
          {abiertaId && (
            <RequisicionDetalleView
              requisicionId={abiertaId}
              onCerrar={() => {
                setAbiertaId(null)
                if (requisiciones !== null) cargar()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
