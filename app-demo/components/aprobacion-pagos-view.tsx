"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Check, History, Loader2, RotateCcw, X } from "lucide-react"
import { HistorialDialog } from "@/components/historial-timeline"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PanelFiltros } from "@/components/panel-filtros"
import { ConfirmarAprobacion } from "@/components/confirmar-aprobacion"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { OrdenCompraDetalleView } from "@/components/orden-compra-detalle-view"
import { DetalleActa } from "@/components/detalle-acta"
import { AYUDA_DOBLE_CLIC, VentanaDetalle, accionesDeFila, camposDesdeColumnas } from "@/components/ventana-detalle"
import {
  aprobarPago,
  aprobarRequisicionAdminPago,
  listarPagosAprobacion,
  obtenerRequisicionAdminAprobacion,
  rechazarPago,
  rechazarRequisicionAdminPago,
  resolicitarPago,
} from "@/app/(app)/ayf/aprobacion-pagos/actions"
import {
  CLASE_ESTADO_PAGO,
  ETIQUETA_ESTADO_PAGO,
  ETIQUETA_TIPO_PAGO,
  formatoFechaHora,
  formatoMoneda,
  type EstadoPago,
  type FiltrosAprobacionPagos,
  type Pago,
} from "@/lib/pagos"
import { formatearFechaSinHora } from "@/lib/fechas"
import { DetalleRequisicionAdmin } from "@/components/detalle-requisicion-admin"
import type { RequisicionAdminDetalle } from "@/lib/requisiciones-admin"

const ESTADOS_FILTRO: { valor: EstadoPago; etiqueta: string }[] = [
  { valor: "solicitado", etiqueta: "Por aprobar" },
  { valor: "programado", etiqueta: "Programados (esperan entrega o fecha)" },
  { valor: "aprobado", etiqueta: "Aprobados" },
  { valor: "rechazado", etiqueta: "Rechazados" },
]

// Una requisición administrativa sale en una fila con el total de su cuadro y
// se aprueba o rechaza completa, como una orden de compra.
const valorFila = (p: Pago) => p.requisicionAdminLote?.total ?? p.valor
const tipoFila = (p: Pago) =>
  p.requisicionAdminLote
    ? `Requisición · ${p.requisicionAdminLote.items} ${p.requisicionAdminLote.items === 1 ? "ítem" : "ítems"}`
    : ETIQUETA_TIPO_PAGO[p.tipo]
const terceroFila = (p: Pago) =>
  p.requisicionAdminLote && p.requisicionAdminLote.items > 1
    ? `${p.terceroNombre ?? "Sin tercero"} y ${p.requisicionAdminLote.items - 1} más`
    : p.terceroNombre

function EtiquetaEstado({ estado }: { estado: EstadoPago }) {
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_PAGO[estado]}`}>
      {ETIQUETA_ESTADO_PAGO[estado]}
    </Badge>
  )
}

// Debajo del documento (orden o acta): el pago que se está aprobando y los
// mismos botones de la fila. Un botón abre su propio paso (confirmar,
// motivo...) y el detalle se cierra.
function BarraPago({ pago, acciones, onCerrar }: { pago: Pago; acciones: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="flex w-full shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-sm">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">{tipoFila(pago)}</span>
        <span className="tabular-nums">
          {formatoMoneda(valorFila(pago))}
          {pago.actaBruto != null && pago.actaBruto !== pago.valor && (
            <span className="text-muted-foreground"> (bruto del acta {formatoMoneda(pago.actaBruto)})</span>
          )}
        </span>
        <EtiquetaEstado estado={pago.estado} />
        <span className="min-w-0 truncate text-muted-foreground" title={pago.cuentaTexto ?? undefined}>
          {terceroFila(pago) ?? "Sin tercero"}
          {!pago.requisicionAdminLote && pago.cuentaTexto
            ? ` · ${pago.cuentaTitular ? `cuenta de ${pago.cuentaTitular}: ` : ""}${pago.cuentaTexto}${pago.cuentaVerificada ? "" : " (sin verificar)"}`
            : ""}
        </span>
        {pago.novedad && (
          <span className="flex items-center gap-1 text-amber-700">
            <AlertTriangle className="h-4 w-4" /> {pago.novedad}
          </span>
        )}
      </div>
      <div
        className="flex flex-wrap items-center justify-end gap-2"
        // Después del onClick del botón (que abre su paso). Se frena el clic
        // para que no llegue al documento: si llega, la confirmación recién
        // abierta lo toma como un clic afuera y se cierra sola.
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button, a")) return
          e.stopPropagation()
          onCerrar()
        }}
      >
        {acciones}
      </div>
    </div>
  )
}

export function AprobacionPagosView({
  puedeAprobar,
  puedeResolicitar,
}: {
  puedeAprobar: boolean
  puedeResolicitar: boolean
}) {
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [pagos, setPagos] = useState<Pago[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosAprobacionPagos>({})

  // "Por aprobar" viene marcado, como en las demás pantallas de aprobación.
  const [estado, setEstado] = useState<EstadoPago | "todos">("solicitado")
  const [tercero, setTercero] = useState("")

  const [procesandoId, setProcesandoId] = useState<string | null>(null)
  const [rechazando, setRechazando] = useState<Pago | null>(null)
  // Aprobar un pago pide confirmación (ver ConfirmarAprobacion): es dinero.
  const [porAprobar, setPorAprobar] = useState<Pago | null>(null)
  const [historialDe, setHistorialDe] = useState<Pago | null>(null)
  // Fila de una requisición administrativa abierta (su detalle con los botones).
  const [requisicionDe, setRequisicionDe] = useState<Pago | null>(null)
  const [viendo, setViendo] = useState<Pago | null>(null)
  const [motivo, setMotivo] = useState("")
  // Rechazados que ya se volvieron a solicitar en esta pantalla (se oculta el botón).
  const [resolicitados, setResolicitados] = useState<Set<string>>(() => new Set())

  function cargar(filtros: FiltrosAprobacionPagos = ultimosFiltros, pag: number = pagina) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    listarPagosAprobacion(filtros, pag)
      .then((r: { pagos: Pago[]; hayMas: boolean }) => {
        // Si la página quedó vacía (se resolvió el último de la página), se retrocede.
        if (r.pagos.length === 0 && pag > 0) return cargar(filtros, pag - 1)
        setPagos(r.pagos)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los pagos."))
      .finally(() => setCargando(false))
  }

  function handleConsultar(): boolean {
    cargar({ estado: estado === "todos" ? undefined : estado, tercero: tercero.trim() || undefined }, 0)
    return true
  }

  function limpiar() {
    setEstado("solicitado")
    setTercero("")
  }

  // Actualización optimista: el pago resuelto sale de la lista si ya no
  // coincide con el filtro de estado; si no, se actualiza en su sitio.
  function reflejar(p: Pago) {
    setPagos((actuales) => {
      if (!actuales) return actuales
      const sigue = !ultimosFiltros.estado || ultimosFiltros.estado === p.estado
      return sigue ? actuales.map((x) => (x.id === p.id ? p : x)) : actuales.filter((x) => x.id !== p.id)
    })
  }

  async function handleAprobar(p: Pago) {
    setProcesandoId(p.id)
    setError(null)
    try {
      reflejar(
        p.requisicionAdminLote && p.requisicionAdminId
          ? await aprobarRequisicionAdminPago(p.id, p.requisicionAdminId)
          : await aprobarPago(p.id)
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar el pago.")
    } finally {
      setProcesandoId(null)
      setPorAprobar(null)
    }
  }

  // El pago rechazado se queda como registro; el nuevo entra "por aprobar".
  async function handleResolicitar(p: Pago) {
    setProcesandoId(p.id)
    setError(null)
    try {
      const nuevo = await resolicitarPago(p.id)
      setResolicitados((prev) => new Set(prev).add(p.id))
      setPagos((actuales) => {
        if (!actuales) return actuales
        const sigue = !ultimosFiltros.estado || ultimosFiltros.estado === nuevo.estado
        return sigue ? [nuevo, ...actuales] : actuales
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo volver a solicitar el pago.")
    } finally {
      setProcesandoId(null)
    }
  }

  async function handleRechazar() {
    if (!rechazando || !motivo.trim()) return
    setProcesandoId(rechazando.id)
    setError(null)
    try {
      reflejar(
        rechazando.requisicionAdminLote && rechazando.requisicionAdminId
          ? await rechazarRequisicionAdminPago(rechazando.id, rechazando.requisicionAdminId, motivo.trim())
          : await rechazarPago(rechazando.id, motivo.trim())
      )
      setRechazando(null)
      setMotivo("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar el pago.")
      setRechazando(null)
    } finally {
      setProcesandoId(null)
    }
  }

  const columnas: ColumnaExcel<Pago>[] = [
    {
      clave: "orden",
      titulo: "Origen",
      ancho: 150,
      fija: true,
      texto: (p) => p.origen,
      // Requisición administrativa: abre su detalle (todos sus ítems, cuentas y pagos).
      celda: (p) =>
        p.requisicionAdminId ? (
          <button
            type="button"
            className="truncate text-left text-primary underline-offset-2 hover:underline"
            title="Ver la requisición administrativa"
            onClick={() => setRequisicionDe(p)}
          >
            {p.origen}
          </button>
        ) : (
          <span className="truncate">{p.origen}</span>
        ),
    },
    {
      clave: "tipo",
      titulo: "Pago",
      ancho: 110,
      texto: (p) => tipoFila(p),
    },
    {
      clave: "tercero",
      titulo: "Tercero",
      ancho: 280,
      flexible: true,
      texto: (p) => terceroFila(p) ?? "",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate" title={terceroFila(p) ?? undefined}>
            {terceroFila(p) ?? <span className="text-muted-foreground/60">Sin tercero</span>}
          </div>
          {p.terceroDocumento && <div className="truncate text-xs text-muted-foreground">{p.terceroDocumento}</div>}
        </div>
      ),
    },
    {
      clave: "proyecto",
      titulo: "Proyecto",
      ancho: 150,
      texto: (p) => p.proyectoCodigo ?? p.proyectoNombre ?? "",
    },
    { clave: "empresa", titulo: "Empresa", ancho: 220, texto: (p) => p.empresaNombre ?? "" },
    {
      clave: "valor",
      titulo: "Valor a pagar",
      ancho: 150,
      alinear: "right",
      texto: (p) => formatoMoneda(valorFila(p)),
      celda: (p) => (
        <div className="leading-tight">
          <div>{formatoMoneda(valorFila(p))}</div>
          {p.actaBruto != null && p.actaBruto !== p.valor && (
            <div className="text-xs text-muted-foreground">Bruto del acta {formatoMoneda(p.actaBruto)}</div>
          )}
        </div>
      ),
      claseCelda: "tabular-nums",
    },
    {
      clave: "fecha",
      titulo: "Solicitado",
      ancho: 110,
      texto: (p) =>
        p.estado === "programado" && p.fechaProgramada
          ? `Desde ${formatearFechaSinHora(p.fechaProgramada)}`
          : p.solicitadoEn
            ? formatoFechaHora(p.solicitadoEn)
            : "",
    },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 130,
      texto: (p) => ETIQUETA_ESTADO_PAGO[p.estado],
      celda: (p) => (
        <div className="flex items-center gap-1.5">
          <EtiquetaEstado estado={p.estado} />
          {p.novedad && (
            <span title={p.novedad}>
              <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Con novedad" />
            </span>
          )}
        </div>
      ),
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      ancho: 250,
      ordenable: false,
      texto: () => "",
      celda: (p) => (
        <div className="flex min-w-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0"
            title={p.requisicionAdminLote ? "Historial de la requisición" : "Historial del pago"}
            aria-label={p.requisicionAdminLote ? "Historial de la requisición" : "Historial del pago"}
            onClick={() => setHistorialDe(p)}
          >
            <History className="h-4 w-4" />
          </Button>
          {puedeAprobar && p.estado === "solicitado" ? (
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-8 w-24" disabled={procesandoId === p.id} onClick={() => setPorAprobar(p)}>
              <Check className="mr-1.5 h-4 w-4" />
              Aprobar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-24 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
              disabled={procesandoId === p.id}
              onClick={() => {
                setRechazando(p)
                setMotivo("")
              }}
            >
              <X className="mr-1.5 h-4 w-4" />
              Rechazar
            </Button>
          </div>
        ) : p.estado === "rechazado" ? (
          <div className="flex min-w-0 items-center gap-2">
            {puedeResolicitar && p.ordenNumero != null && !resolicitados.has(p.id) && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                disabled={procesandoId === p.id}
                onClick={() => handleResolicitar(p)}
                title="Crea un pago nuevo por aprobar con los mismos datos; este queda como registro"
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Volver a solicitar
              </Button>
            )}
            {p.motivoRechazo && (
              <span className="truncate text-xs text-muted-foreground" title={p.motivoRechazo}>
                {p.motivoRechazo}
              </span>
            )}
          </div>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Aquí se aprueban las órdenes de compra: aprobar su pago único o su anticipo aprueba la orden y rechazarlo la rechaza (el origen la abre). También los saldos, los pagos de las actas de contratos (aprobar o rechazar el pago aprueba o rechaza el acta) y las requisiciones administrativas (una fila por requisición, que se aprueba completa; el origen la abre)."
        >
          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select value={estado} onValueChange={(v) => setEstado((v ?? "solicitado") as EstadoPago | "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTADOS_FILTRO.map((e) => (
                  <SelectItem key={e.valor} value={e.valor}>
                    {e.etiqueta}
                  </SelectItem>
                ))}
                <SelectItem value="todos">Todos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tercero-pago">Tercero</Label>
            <Input
              id="tercero-pago"
              placeholder="Nombre o razón social"
              value={tercero}
              onChange={(e) => setTercero(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {pagos === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Presiona Consultar para ver los pagos por aprobar.
            </div>
          ) : pagos === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando pagos...
            </div>
          ) : pagos.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Ningún pago coincide con los filtros.
            </div>
          ) : (
            <TablaExcel
              filas={pagos}
              columnas={columnas}
              claveFila={(p) => p.id}
              onDobleClickFila={(p) => (p.requisicionAdminLote ? setRequisicionDe(p) : setViendo(p))}
              tituloFila={AYUDA_DOBLE_CLIC}
              tarjeta={{
                titulo: (p) => terceroFila(p) ?? "Sin tercero",
                subtitulo: (p) => `${p.origen || "—"} · ${tipoFila(p)}`,
                esquina: (p) => <EtiquetaEstado estado={p.estado} />,
                campos: ["proyecto", "empresa", "valor", "fecha", "acciones"],
              }}
            />
          )}

          {pagos !== null && pagos.length > 0 && (
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimosFiltros, n)} />
          )}
        </div>
      </div>

      <Dialog
        open={rechazando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setRechazando(null)
            setMotivo("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rechazando?.requisicionAdminLote ? "Rechazar requisición" : "Rechazar pago"} — {rechazando?.origen} (
              {rechazando ? tipoFila(rechazando) : ""})
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {rechazando && `${terceroFila(rechazando) ?? "Sin tercero"} · ${formatoMoneda(valorFila(rechazando))}`}
            {rechazando?.requisicionAdminLote && ". Vuelve completa a quien la hizo para corregirla."}
          </p>
          <Textarea
            placeholder="Motivo del rechazo (obligatorio)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechazando(null)}>
              Volver
            </Button>
            <Button variant="destructive" disabled={!motivo.trim() || procesandoId !== null} onClick={handleRechazar}>
              {procesandoId !== null ? "Rechazando..." : "Rechazar pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmarAprobacion
        abierta={porAprobar !== null}
        titulo={
          porAprobar?.requisicionAdminLote
            ? `¿Aprobar la requisición completa (${porAprobar.requisicionAdminLote.items} ${porAprobar.requisicionAdminLote.items === 1 ? "pago" : "pagos"} por ${formatoMoneda(porAprobar.requisicionAdminLote.total)})?`
            : `¿Aprobar el pago de ${porAprobar ? formatoMoneda(porAprobar.valor) : ""}?`
        }
        detalle={
          porAprobar
            ? `${terceroFila(porAprobar) ?? "Sin tercero"}${porAprobar.origen ? ` · ${porAprobar.origen}` : ""}${
                porAprobar.proyectoCodigo ? ` · ${porAprobar.proyectoCodigo}` : ""
              }. ${porAprobar.requisicionAdminLote ? "Los pagos de todos sus ítems pasan al consolidado." : porAprobar.concepto}`
            : ""
        }
        procesando={porAprobar !== null && procesandoId === porAprobar.id}
        onConfirmar={() => porAprobar && handleAprobar(porAprobar)}
        onCerrar={() => setPorAprobar(null)}
      />

      {requisicionDe?.requisicionAdminId && (
        <VerRequisicionAdminPago
          id={requisicionDe.requisicionAdminId}
          onCerrar={() => setRequisicionDe(null)}
          acciones={
            <BarraPago pago={requisicionDe} acciones={accionesDeFila(columnas, requisicionDe)} onCerrar={() => setRequisicionDe(null)} />
          }
        />
      )}

      {/* La fila de una requisición administrativa muestra el historial de la
          requisición (total, ítems, rechazos, aprobación), no el del pago de su ítem 1. */}
      {/* Doble clic: el documento de donde sale el pago, completo (la orden de
          compra con sus insumos, o el acta), con el pago y sus botones abajo.
          Sin documento (o sin id), la ventana común con los datos del pago. */}
      <Dialog open={viendo?.ordenCompraId != null} onOpenChange={(abierto) => !abierto && setViendo(null)}>
        <DialogContent className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col overflow-hidden sm:w-[90vw] sm:max-w-none">
          <DialogTitle className="sr-only">Detalle de la orden de compra del pago</DialogTitle>
          {viendo?.ordenCompraId && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <OrdenCompraDetalleView ordenId={viendo.ordenCompraId} onCerrar={() => setViendo(null)} />
              </div>
              <BarraPago pago={viendo} acciones={accionesDeFila(columnas, viendo)} onCerrar={() => setViendo(null)} />
            </>
          )}
        </DialogContent>
      </Dialog>

      <DetalleActa
        id={viendo?.ordenCompraId == null ? (viendo?.actaId ?? null) : null}
        onCerrar={() => setViendo(null)}
        acciones={() =>
          viendo && <BarraPago pago={viendo} acciones={accionesDeFila(columnas, viendo)} onCerrar={() => setViendo(null)} />
        }
      />

      <VentanaDetalle
        abierta={viendo !== null && viendo.ordenCompraId == null && viendo.actaId == null}
        onCerrar={() => setViendo(null)}
        titulo={viendo ? viendo.concepto : ""}
        subtitulo={viendo ? `${viendo.origen || "—"} · ${ETIQUETA_TIPO_PAGO[viendo.tipo]}` : undefined}
        campos={viendo ? camposDesdeColumnas(columnas, viendo) : []}
        acciones={accionesDeFila(columnas, viendo)}
      />

      <HistorialDialog
        abierto={historialDe !== null}
        tipo={historialDe?.requisicionAdminLote && historialDe.requisicionAdminId ? "requisicion_admin" : "pago"}
        id={
          historialDe?.requisicionAdminLote && historialDe.requisicionAdminId
            ? historialDe.requisicionAdminId
            : (historialDe?.id ?? null)
        }
        titulo={`Historial ${historialDe?.requisicionAdminLote ? "de la requisición" : "del pago"}${historialDe?.origen ? ` — ${historialDe.origen}` : ""}`}
        onCerrar={() => setHistorialDe(null)}
      />
    </div>
  )
}

// Detalle de la requisición administrativa de un pago: sus ítems (con la cuenta
// completa para A&F) y el estado del pago de cada uno. Se aprueban o rechazan
// en la lista, pago por pago.
function VerRequisicionAdminPago({ id, onCerrar, acciones }: { id: string; onCerrar: () => void; acciones?: React.ReactNode }) {
  const [carga, setCarga] = useState<{ id: string; detalle: RequisicionAdminDetalle | null; error: string | null } | null>(null)

  useEffect(() => {
    let vigente = true
    obtenerRequisicionAdminAprobacion(id)
      .then((d: RequisicionAdminDetalle) => vigente && setCarga({ id, detalle: d, error: null }))
      .catch((e) => vigente && setCarga({ id, detalle: null, error: e instanceof Error ? e.message : "No se pudo cargar." }))
    return () => {
      vigente = false
    }
  }, [id])

  const actual = carga?.id === id ? carga : null
  return (
    <Dialog open onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>
            Requisición administrativa {actual?.detalle?.numero != null ? `N° ${actual.detalle.numero}` : ""}
          </DialogTitle>
        </DialogHeader>
        {!actual ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </p>
        ) : actual.error ? (
          <p className="text-sm text-destructive">{actual.error}</p>
        ) : actual.detalle ? (
          <DetalleRequisicionAdmin detalle={actual.detalle} />
        ) : null}
        {acciones}
      </DialogContent>
    </Dialog>
  )
}
