"use client"
// app/(app)/almacen/registro-requisiciones/page.tsx
import { useState } from "react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { RequisicionDetalleView } from "@/components/requisicion-detalle-view"
import { BadgeCompraRequisicion, BadgeEstadoRequisicion } from "@/components/badge-requisicion"
import { FiltrosRequisicionesPanel } from "@/components/filtros-requisiciones"
import { formatearFechaSinHora } from "@/lib/fechas"
import type { RequisicionResumen } from "@/lib/requisiciones-lineas"

import { listarRequisiciones, type FiltrosRequisiciones } from "../actions"

const headClasses =
  "border-r bg-primary px-3 py-2.5 text-left text-xs font-medium text-primary-foreground last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

export default function RegistroRequisiciones() {
  const [error, setError] = useState<string | null>(null)

  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [requisiciones, setRequisiciones] = useState<RequisicionResumen[] | null>(null)
  const [truncado, setTruncado] = useState(false)
  const [cargando, setCargando] = useState(false)
  // Última consulta (para refrescar la lista al cerrar el detalle) y la
  // requisición abierta en el diálogo de detalle.
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosRequisiciones>({})
  const [abiertaId, setAbiertaId] = useState<string | null>(null)

  function consultar(filtros: FiltrosRequisiciones) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    listarRequisiciones(filtros)
      .then((r) => {
        setRequisiciones(r.filas)
        setTruncado(r.truncado)
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudo cargar el registro de requisiciones.")
      )
      .finally(() => setCargando(false))
  }

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Registro de requisiciones</h1>
          <p className="text-sm text-muted-foreground">
            Requisiciones de todos los proyectos a los que tienes acceso.
          </p>
        </div>
      </header>

      <main className="flex w-full flex-1 gap-4 p-6">
        <FiltrosRequisicionesPanel onConsultar={consultar} cargando={cargando} onError={setError} />

        <div className="min-w-0 flex-1 space-y-3">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {requisiciones === null ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar para ver las requisiciones.
            </div>
          ) : requisiciones.length === 0 ? (
            <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              Ninguna requisición coincide con los filtros.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {requisiciones.length} {requisiciones.length === 1 ? "requisición" : "requisiciones"}
                {truncado && " — se muestran las más recientes; afina los filtros para ver otras."}
                {" "}Haz clic en una para ver su detalle.
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className={`${headClasses} w-28`}>Requisición</th>
                      <th className={`${headClasses} w-48`}>Proyecto</th>
                      <th className={`${headClasses} w-40`}>Solicitado por</th>
                      <th className={`${headClasses} w-28 text-center`}>Fecha requisición</th>
                      <th className={`${headClasses} w-28 text-center`}>Fecha requerida</th>
                      <th className={`${headClasses} w-20 text-center`}>Insumos</th>
                      <th className={`${headClasses} w-28 text-center`}>Estado</th>
                      <th className={`${headClasses} w-32 text-center`}>Compra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requisiciones.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => setAbiertaId(r.id)}
                        className={`cursor-pointer border-b hover:bg-accent/40 ${
                          r.urgente && r.estado === "pendiente" ? "bg-amber-50/60" : ""
                        }`}
                      >
                        <td className={`${celda} font-medium text-primary`}>
                          Requisición {r.numero}
                          {r.urgente && (
                            <span className="ml-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800">
                              Urgente
                            </span>
                          )}
                        </td>
                        <td className={celda}>
                          <p className="font-medium">{r.proyectoCodigo ?? "—"}</p>
                          <p className="text-muted-foreground">{r.proyectoNombre}</p>
                        </td>
                        <td className={celda}>{r.solicitanteNombre ?? "—"}</td>
                        <td className={`${celda} text-center`}>
                          {new Date(r.createdAt).toLocaleDateString("es-CO")}
                        </td>
                        <td className={`${celda} text-center`}>
                          {r.fechaRequerida ? formatearFechaSinHora(r.fechaRequerida) : "—"}
                        </td>
                        <td className={`${celda} text-center`}>{r.nLineas}</td>
                        <td className={`${celda} text-center`}>
                          <BadgeEstadoRequisicion estado={r.estado} />
                        </td>
                        <td className={`${celda} text-center`}>
                          <BadgeCompraRequisicion estadoCompra={r.estadoCompra} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Detalle encima de la lista, sin salir de la página. */}
      <Dialog
        open={abiertaId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAbiertaId(null)
            // Pudo modificarse o cancelarse: se refresca la lista.
            if (requisiciones !== null) consultar(ultimosFiltros)
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
                if (requisiciones !== null) consultar(ultimosFiltros)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
