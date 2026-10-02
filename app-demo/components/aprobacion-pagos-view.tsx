"use client"

import { useState } from "react"
import { AlertTriangle, Check, Loader2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { aprobarPago, listarPagosAprobacion, rechazarPago } from "@/app/(app)/ayf/aprobacion-pagos/actions"
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

const ESTADOS_FILTRO: { valor: EstadoPago; etiqueta: string }[] = [
  { valor: "solicitado", etiqueta: "Por aprobar" },
  { valor: "programado", etiqueta: "Programados (esperan entrega o fecha)" },
  { valor: "aprobado", etiqueta: "Aprobados" },
  { valor: "rechazado", etiqueta: "Rechazados" },
]

function EtiquetaEstado({ estado }: { estado: EstadoPago }) {
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_PAGO[estado]}`}>
      {ETIQUETA_ESTADO_PAGO[estado]}
    </Badge>
  )
}

export function AprobacionPagosView({ puedeAprobar }: { puedeAprobar: boolean }) {
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
  const [motivo, setMotivo] = useState("")

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
      reflejar(await aprobarPago(p.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar el pago.")
    } finally {
      setProcesandoId(null)
    }
  }

  async function handleRechazar() {
    if (!rechazando || !motivo.trim()) return
    setProcesandoId(rechazando.id)
    setError(null)
    try {
      reflejar(await rechazarPago(rechazando.id, motivo.trim()))
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
      titulo: "OC",
      ancho: 80,
      fija: true,
      texto: (p) => (p.ordenNumero != null ? String(p.ordenNumero) : ""),
    },
    {
      clave: "tipo",
      titulo: "Pago",
      ancho: 110,
      texto: (p) => ETIQUETA_TIPO_PAGO[p.tipo],
    },
    {
      clave: "tercero",
      titulo: "Tercero",
      ancho: 280,
      flexible: true,
      texto: (p) => p.terceroNombre ?? "",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate" title={p.terceroNombre ?? undefined}>
            {p.terceroNombre ?? <span className="text-muted-foreground/60">Sin tercero</span>}
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
      titulo: "Valor",
      ancho: 130,
      alinear: "right",
      texto: (p) => formatoMoneda(p.valor),
      claseCelda: "tabular-nums",
    },
    {
      clave: "fecha",
      titulo: "Solicitado",
      ancho: 110,
      texto: (p) =>
        p.estado === "programado" && p.fechaProgramada
          ? `Desde ${new Date(p.fechaProgramada + "T00:00:00").toLocaleDateString("es-CO")}`
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
      ancho: 210,
      ordenable: false,
      texto: () => "",
      celda: (p) =>
        puedeAprobar && p.estado === "solicitado" ? (
          <div className="flex items-center gap-2">
            <Button size="sm" className="h-8 w-24" disabled={procesandoId === p.id} onClick={() => handleAprobar(p)}>
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
        ) : p.estado === "rechazado" && p.motivoRechazo ? (
          <span className="truncate text-xs text-muted-foreground" title={p.motivoRechazo}>
            {p.motivoRechazo}
          </span>
        ) : null,
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Aprobar la orden de compra ya aprueba su pago único o su anticipo. Aquí se aprueban los saldos."
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
              tarjeta={{
                titulo: (p) => p.terceroNombre ?? "Sin tercero",
                subtitulo: (p) => `OC ${p.ordenNumero ?? "—"} · ${ETIQUETA_TIPO_PAGO[p.tipo]}`,
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
              Rechazar pago — OC {rechazando?.ordenNumero} ({rechazando ? ETIQUETA_TIPO_PAGO[rechazando.tipo] : ""})
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {rechazando && `${rechazando.terceroNombre ?? "Sin tercero"} · ${formatoMoneda(rechazando.valor)}`}
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
    </div>
  )
}
