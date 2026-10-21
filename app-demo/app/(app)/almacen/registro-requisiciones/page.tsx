"use client"
// app/(app)/almacen/registro-requisiciones/page.tsx
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { useMemo, useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { RequisicionDetalleView } from "@/components/requisicion-detalle-view"
import { BadgeCompraRequisicion, BadgeEstadoRequisicion } from "@/components/badge-requisicion"
import { FiltrosRequisicionesPanel } from "@/components/filtros-requisiciones"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { formatearFechaSinHora } from "@/lib/fechas"
import type { RequisicionResumen } from "@/lib/requisiciones-lineas"
import { descargarExcelRequisiciones } from "@/lib/exportar-requisiciones"

import { exportarRequisiciones, listarRequisiciones, type FiltrosRequisiciones } from "../actions"
import { AYUDA_DOBLE_CLIC } from "@/components/ventana-detalle"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { Badge } from "@/components/ui/badge"



export default function RegistroRequisiciones() {
  const [error, setError] = useState<string | null>(null)

  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [requisiciones, setRequisiciones] = useState<RequisicionResumen[] | null>(null)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  // Última consulta (para refrescar la lista al cerrar el detalle) y la
  // requisición abierta en el diálogo de detalle.
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosRequisiciones>({})
  const [abiertaId, setAbiertaId] = useState<string | null>(null)
  const [descargando, setDescargando] = useState(false)

  const columnas: ColumnaExcel<RequisicionResumen>[] = useMemo(
    () => [
      {
        clave: "numero",
        titulo: "Requisición",
        ancho: 200,
        fija: true,
        texto: (r) => `Requisición ${r.numero}`,
        valorOrden: (r) => r.numero,
        celda: (r) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">Requisición {r.numero}</span>
            {r.urgente && <Badge variant="destructive">Urgente</Badge>}
          </span>
        ),
      },
      { clave: "proyecto", titulo: "Proyecto", ancho: 220, flexible: true, texto: (r) => [r.proyectoCodigo, r.proyectoNombre].filter(Boolean).join(" · ") },
      { clave: "solicitante", titulo: "Solicitado por", ancho: 170, texto: (r) => r.solicitanteNombre ?? "" },
      {
        clave: "creada",
        titulo: "Fecha requisición",
        ancho: 130,
        alinear: "center",
        texto: (r) => formatearFechaSinHora(r.createdAt),
        valorOrden: (r) => r.createdAt,
        claseCelda: "tabular-nums",
      },
      {
        clave: "requerida",
        titulo: "Fecha requerida",
        ancho: 130,
        alinear: "center",
        texto: (r) => (r.fechaRequerida ? formatearFechaSinHora(r.fechaRequerida) : ""),
        valorOrden: (r) => r.fechaRequerida,
        claseCelda: "tabular-nums",
      },
      { clave: "insumos", titulo: "Insumos", ancho: 90, alinear: "center", texto: (r) => String(r.nLineas), valorOrden: (r) => r.nLineas },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 120,
        alinear: "center",
        texto: (r) => r.estado,
        celda: (r) => <BadgeEstadoRequisicion estado={r.estado} />,
      },
      {
        clave: "compra",
        titulo: "Compra",
        ancho: 130,
        alinear: "center",
        texto: (r) => r.estadoCompra ?? "",
        celda: (r) => <BadgeCompraRequisicion estadoCompra={r.estadoCompra} />,
      },
    ],
    []
  )
  const { ordenadas, orden, ordenar } = useOrdenExcel(requisiciones ?? [], columnas)

  // Descarga TODO lo que cumple la última consulta (no solo esta página).
  async function descargar() {
    setDescargando(true)
    setError(null)
    try {
      const filas = await exportarRequisiciones(ultimosFiltros)
      if (filas.length === 0) {
        setError("No hay insumos para descargar con estos filtros.")
        return
      }
      await descargarExcelRequisiciones(filas)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descargar el Excel.")
    } finally {
      setDescargando(false)
    }
  }

  function consultar(filtros: FiltrosRequisiciones, pag = 0) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    listarRequisiciones(filtros, pag)
      .then((r) => {
        // Si la página quedó vacía (p. ej. se canceló la última de la página), se retrocede.
        if (r.filas.length === 0 && pag > 0) return consultar(filtros, pag - 1)
        setRequisiciones(r.filas)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudo cargar el registro de requisiciones.")
      )
      .finally(() => setCargando(false))
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Registro de requisiciones"
        subtitulo="Requisiciones de todos los proyectos a los que tienes acceso."
      />

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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {requisiciones.length} {requisiciones.length === 1 ? "requisición" : "requisiciones"} en
                  esta página. Doble clic en una para ver su detalle.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={descargar}
                  disabled={descargando}
                  title="Descarga todas las requisiciones de la consulta (todas las páginas), una fila por insumo."
                >
                  {descargando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  Descargar Excel
                </Button>
              </div>
              <TablaExcel
                filas={ordenadas}
                columnas={columnas}
                claveFila={(r) => r.id}
                orden={orden}
                onOrdenar={ordenar}
                onDobleClickFila={(r) => setAbiertaId(r.id)}
                tituloFila={AYUDA_DOBLE_CLIC}
                fondoFila={(r) => (r.urgente && r.estado === "pendiente" ? "bg-amber-50" : undefined)}
                tarjeta={{
                  titulo: (r) => `Requisición ${r.numero}`,
                  subtitulo: (r) => `${r.proyectoCodigo ?? "—"} · ${r.proyectoNombre ?? ""}`,
                  esquina: (r) => <BadgeEstadoRequisicion estado={r.estado} />,
                  campos: ["solicitante", "creada", "requerida", "insumos", "compra"],
                }}
              />
              <PaginacionSimple
                pagina={pagina}
                hayMas={hayMas}
                cargando={cargando}
                onCambiar={(n) => consultar(ultimosFiltros, n)}
              />
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
            if (requisiciones !== null) consultar(ultimosFiltros, pagina)
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
                if (requisiciones !== null) consultar(ultimosFiltros, pagina)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
