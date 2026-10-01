"use client"

import { formatearFechaSinHora } from "@/lib/fechas"

// app/(app)/admin-tecnico/page.tsx
//
// Panel de aprobación de REQUISICIONES. Cada requisición (con su número) trae
// sus insumos; se aprueba o rechaza la requisición ENTERA, no insumo por
// insumo. Agrupadas por proyecto (quien aprueba ve todos).

import Link from "next/link"
import { useEffect, useState } from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { BadgeCompraRequisicion, BadgeEstadoRequisicion } from "@/components/badge-requisicion"
import { HistorialDialog } from "@/components/historial-timeline"
import { FiltrosRequisicionesPanel } from "@/components/filtros-requisiciones"
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

const headClasses = "border-r bg-muted/50 px-3 py-2 text-left text-xs font-medium last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

export default function AdminTecnico() {
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [requisiciones, setRequisiciones] = useState<RequisicionParaAprobar[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [idsEnProceso, setIdsEnProceso] = useState<Set<string>>(new Set())
  const [permisos, setPermisos] = useState<PermisosPedidos | null>(null)
  // Rechazar / desaprobar piden motivo; el historial se abre por requisición.
  const [accion, setAccion] = useState<{ tipo: TipoAccion; req: RequisicionParaAprobar } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesandoAccion, setProcesandoAccion] = useState(false)
  const [historial, setHistorial] = useState<RequisicionParaAprobar | null>(null)
  // Últimos filtros consultados (para repetir la consulta tras desaprobar).
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
        // Optimista, igual que aprobar: sale de la cola de pendientes.
        const id = accion.req.id
        setRequisiciones((prev) => (prev ?? []).filter((r) => r.id !== id))
      } else {
        await desaprobarRequisicion(accion.req.id, motivo.trim())
        cargar()
      }
      setAccion(null)
      setMotivo("")
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
      // Optimista: se saca de la lista de pendientes al instante.
      // Se vuelve a consultar para que aparezca como aprobada.
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

  // Agrupar por proyecto -- barato porque ya es solo la cola de
  // pendientes (nunca todo el histórico).
  const porProyecto = new Map<string, { nombre: string; reqs: RequisicionParaAprobar[] }>()
  for (const r of requisiciones ?? []) {
    const clave = r.proyectoId ?? "sin-proyecto"
    if (!porProyecto.has(clave)) {
      porProyecto.set(clave, { nombre: r.proyectoNombre ?? "Sin proyecto", reqs: [] })
    }
    porProyecto.get(clave)!.reqs.push(r)
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
          cargando={cargando}
          onError={setError}
          onConsultar={(f) => {
            setFiltros(f)
            cargar(f)
          }}
        />

        <div className="min-w-0 flex-1 space-y-8">
        {cargando && <p className="text-sm text-muted-foreground">Cargando requisiciones…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {requisiciones === null && !cargando && (
          <div className="flex items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            Elige los filtros que quieras y presiona Consultar. Con &quot;Solo por Aprobar&quot; ves únicamente las
            que están esperando aprobación.
          </div>
        )}

        {requisiciones !== null && requisiciones.length === 0 && !cargando && !error && (
          <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            Ninguna requisición coincide con los filtros.
          </p>
        )}

        {[...porProyecto.entries()].map(([proyectoId, grupo]) => (
          <div key={proyectoId} className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">
              {grupo.nombre}{" "}
              <span className="font-normal text-muted-foreground">
                ({grupo.reqs.length} {grupo.reqs.length === 1 ? "requisición" : "requisiciones"})
              </span>
            </h2>

            {grupo.reqs.map((req) => {
              const procesando = idsEnProceso.has(req.id)
              return (
                <div
                  key={req.id}
                  className={`overflow-hidden rounded-md border ${req.urgente ? "border-amber-300" : ""}`}
                >
                  {/* Cabecera de la requisición */}
                  <div
                    className={`flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-3 ${
                      req.urgente ? "bg-amber-50/70" : "bg-muted/30"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        Requisición {req.numero}
                        {req.urgente && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                            Urgente
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {req.nLineas} {req.nLineas === 1 ? "insumo" : "insumos"}
                        <BadgeEstadoRequisicion estado={req.estado} />
                      </p>
                    </div>
                    <div className="text-xs">
                      <p className="text-muted-foreground">Solicitado por</p>
                      <p>{req.solicitanteNombre ?? "—"}</p>
                    </div>
                    <div className="text-xs">
                      <p className="text-muted-foreground">Fecha requisición</p>
                      <p>{new Date(req.createdAt).toLocaleDateString("es-CO")}</p>
                    </div>
                    <div className="text-xs">
                      <p className="text-muted-foreground">Fecha requerida</p>
                      <p>{req.fechaRequerida ? formatearFechaSinHora(req.fechaRequerida) : "—"}</p>
                    </div>
                    {req.estado === "aprobada" && (
                      <div className="text-xs">
                        <p className="text-muted-foreground">Compra</p>
                        <BadgeCompraRequisicion estadoCompra={req.estadoCompra} />
                      </div>
                    )}
                    {req.estado === "rechazada" && (
                      <div className="text-xs">
                        <p className="text-muted-foreground">Rechazada por</p>
                        <p>
                          {req.resueltoPorNombre ?? "—"}
                          {req.resueltoAt ? ` · ${new Date(req.resueltoAt).toLocaleDateString("es-CO")}` : ""}
                        </p>
                      </div>
                    )}
                    {req.soporteUrl && (
                      <a
                        href={req.soporteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary underline underline-offset-2"
                      >
                        Ver soporte
                      </a>
                    )}

                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      {req.estado === "pendiente" && permisos?.aprobar && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs text-emerald-700 hover:bg-emerald-50"
                            onClick={() => aprobar(req.id)}
                            disabled={procesando}
                          >
                            Aprobar requisición
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              setAccion({ tipo: "rechazar", req })
                              setMotivo("")
                            }}
                            disabled={procesando}
                          >
                            Rechazar requisición
                          </Button>
                        </>
                      )}
                      {req.estado === "aprobada" && permisos?.desaprobar && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-3 text-xs text-amber-700 hover:bg-amber-50"
                          onClick={() => {
                            setAccion({ tipo: "desaprobar", req })
                            setMotivo("")
                          }}
                          disabled={procesando}
                        >
                          Desaprobar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-3 text-xs text-muted-foreground"
                        onClick={() => setHistorial(req)}
                      >
                        Historial
                      </Button>
                    </div>
                  </div>

                  {req.observaciones && (
                    <p className="border-b bg-background px-4 py-2 text-xs">
                      <span className="text-muted-foreground">Observaciones: </span>
                      {req.observaciones}
                    </p>
                  )}
                  {req.estado === "rechazada" && (
                    <p className="border-b bg-red-50/60 px-4 py-2 text-xs text-red-900">
                      <span className="font-medium">Motivo del rechazo: </span>
                      {req.motivoRechazo ?? "(sin motivo)"}
                    </p>
                  )}

                  {/* Insumos de la requisición */}
                  <div className="overflow-x-auto">
                    <table className="w-full border-separate border-spacing-0">
                      <thead>
                        <tr>
                          <th className={`${headClasses} w-24`}>Código</th>
                          <th className={headClasses}>Insumo</th>
                          <th className={`${headClasses} w-16 text-center`}>UM</th>
                          <th className={`${headClasses} w-24 text-right`}>Cantidad</th>
                          <th className={`${headClasses} w-64`}>Ítem del presupuesto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {req.lineas.map((l) => (
                          <tr key={l.id} className="border-b hover:bg-muted/30">
                            <td className={`${celda} font-mono text-muted-foreground`}>{l.insumoCodigo}</td>
                            <td className={celda}>{l.insumoDescripcion}</td>
                            <td className={`${celda} text-center`}>{l.insumoUm ?? "—"}</td>
                            <td className={`${celda} text-right`}>{l.cantidad}</td>
                            <td className={celda}>
                              {l.presupuestoId ? (
                                <Link
                                  href={`/presupuestos?presupuestoId=${l.presupuestoId}`}
                                  className="text-primary underline underline-offset-2"
                                >
                                  {l.itemCodigo}
                                </Link>
                              ) : (
                                l.itemCodigo
                              )}{" "}
                              <span className="text-muted-foreground">{l.itemDescripcion}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
          </div>
        ))}

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
                {accion ? `${TEXTO_ACCION[accion.tipo].titulo} ${accion.req.numero}` : ""}
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
                Volver
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

        <HistorialDialog
          abierto={historial !== null}
          tipo="requisicion"
          id={historial?.id ?? null}
          titulo={`Historial — Requisición ${historial?.numero ?? ""}`}
          onCerrar={() => setHistorial(null)}
        />
        </div>
      </main>
    </>
  )
}
