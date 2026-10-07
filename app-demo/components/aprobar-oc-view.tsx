"use client"

// Aprobación de órdenes de compra, con el mismo formato que Aprobación de
// requisiciones: panel de filtros a la izquierda (se minimiza al consultar) y,
// a la derecha, una fila por orden con Ver / Aprobar / Rechazar / Desaprobar.
// No muestra nada hasta consultar; "Solo por aprobar" viene marcado.

import { useEffect, useState } from "react"
import { Loader2, ClipboardCheck, Eye, Check, X, Undo2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { OrdenCompraDetalleView } from "./orden-compra-detalle-view"
import { PanelFiltros } from "@/components/panel-filtros"
import { ConfirmarAprobacion } from "@/components/confirmar-aprobacion"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { ESTADO_VISIBLE_BADGE, sePuedeDesaprobar } from "@/lib/ordenes-compra-estado"
import {
  listarTodasLasOrdenesCompra,
  obtenerPermisosOrdenCompra,
  aprobarOrdenCompra,
  rechazarOrdenCompra,
  desaprobarOrdenCompra,
  type FiltrosOrdenesCompra,
  type OrdenCompraListado,
  type OrdenCompraEstado,
  type PermisosOrdenCompra,
} from "@/app/(app)/almacen/comprar-pedidos/actions"
import { verProyectos } from "@/app/(app)/almacen/actions"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

const ESTADOS_FILTRO = Object.entries(ESTADO_VISIBLE_BADGE).map(([valor, b]) => ({
  valor: valor as OrdenCompraEstado,
  etiqueta: b.label,
}))

export function AprobarOCView() {
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [ordenes, setOrdenes] = useState<OrdenCompraListado[] | null>(null)
  const [ordenAbiertaId, setOrdenAbiertaId] = useState<string | null>(null)
  const [permisos, setPermisos] = useState<PermisosOrdenCompra | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  // Últimos filtros consultados (para refrescar tras aprobar, rechazar, etc.).
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosOrdenesCompra>({})

  // Filtros del panel (todos opcionales)
  const [proyectos, setProyectos] = useState<{ id: string; codigo: string | null; nombre: string }[]>([])
  const [numero, setNumero] = useState("")
  const [proyectoId, setProyectoId] = useState("todos")
  const [proveedor, setProveedor] = useState("")
  // "Solo por aprobar" (marcado de entrada): solo las pendientes de aprobación.
  const [soloPorAprobar, setSoloPorAprobar] = useState(true)
  const [estado, setEstado] = useState<OrdenCompraEstado | "todos">("todos")
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  const [procesandoId, setProcesandoId] = useState<string | null>(null)
  const [rechazandoId, setRechazandoId] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState("")
  const [desaprobando, setDesaprobando] = useState<OrdenCompraListado | null>(null)
  const [motivoDesaprobacion, setMotivoDesaprobacion] = useState("")

  function cargar(filtros: FiltrosOrdenesCompra = ultimosFiltros, pag: number = pagina) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    listarTodasLasOrdenesCompra(filtros, pag)
      .then((r: { ordenes: OrdenCompraListado[]; hayMas: boolean }) => {
        // Si la página quedó vacía (se resolvió la última de la página), se retrocede.
        if (r.ordenes.length === 0 && pag > 0) return cargar(filtros, pag - 1)
        setOrdenes(r.ordenes)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las órdenes."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    obtenerPermisosOrdenCompra()
      .then(setPermisos)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los permisos."))
    verProyectos()
      .then(setProyectos)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos."))
  }, [])

  function handleConsultar(): boolean {
    const n = numero.trim() === "" ? undefined : Number(numero)
    if (n !== undefined && (!Number.isInteger(n) || n <= 0)) {
      setError("El número de orden debe ser un número entero mayor que cero.")
      return false
    }
    cargar({
      numero: n,
      proyectoId: proyectoId === "todos" ? undefined : proyectoId,
      proveedor: proveedor.trim() || undefined,
      estado: soloPorAprobar ? "pendiente_aprobacion" : estado === "todos" ? undefined : estado,
      // Sin un estado concreto, las canceladas no se mezclan en la cola.
      incluirCanceladas: false,
      desde: desde || undefined,
      hasta: hasta || undefined,
    }, 0)
    return true
  }

  function limpiar() {
    setNumero("")
    setProyectoId("todos")
    setProveedor("")
    setSoloPorAprobar(true)
    setEstado("todos")
    setDesde("")
    setHasta("")
  }

  // Aprobar pide confirmación (ver ConfirmarAprobacion).
  const [porAprobar, setPorAprobar] = useState<OrdenCompraListado | null>(null)

  async function handleAprobar(id: string) {
    setProcesandoId(id)
    setError(null)
    try {
      await aprobarOrdenCompra(id)
      setPorAprobar(null)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar la orden.")
      setPorAprobar(null)
    } finally {
      setProcesandoId(null)
    }
  }

  async function confirmarRechazo() {
    if (!rechazandoId || !motivoRechazo.trim()) return
    setProcesandoId(rechazandoId)
    setError(null)
    try {
      await rechazarOrdenCompra(rechazandoId, motivoRechazo.trim())
      setRechazandoId(null)
      setMotivoRechazo("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar la orden.")
    } finally {
      setProcesandoId(null)
    }
  }

  async function confirmarDesaprobacion() {
    if (!desaprobando || !motivoDesaprobacion.trim()) return
    setProcesandoId(desaprobando.id)
    setError(null)
    try {
      await desaprobarOrdenCompra(desaprobando.id, motivoDesaprobacion.trim())
      setDesaprobando(null)
      setMotivoDesaprobacion("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desaprobar la orden.")
      setDesaprobando(null)
    } finally {
      setProcesandoId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Ningún filtro es obligatorio: sin filtros se consultan todas."
        >
          <div className="space-y-1.5">
            <Label htmlFor="numero-oc-aprobacion">Número</Label>
            <Input
              id="numero-oc-aprobacion"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="Ej. 34"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Proyecto</Label>
            <Select value={proyectoId} onValueChange={(v) => setProyectoId(v ?? "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos mis proyectos</SelectItem>
                {proyectos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.codigo ? `${p.codigo} · ${p.nombre}` : p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proveedor-oc-aprobacion">Proveedor</Label>
            <Input
              id="proveedor-oc-aprobacion"
              placeholder="Nombre del proveedor"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={soloPorAprobar} onCheckedChange={(v) => setSoloPorAprobar(v === true)} />
            Solo por Aprobar
          </label>

          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select
              disabled={soloPorAprobar}
              value={soloPorAprobar ? "pendiente_aprobacion" : estado}
              onValueChange={(v) => setEstado((v ?? "todos") as OrdenCompraEstado | "todos")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {ESTADOS_FILTRO.map((e) => (
                  <SelectItem key={e.valor} value={e.valor}>
                    {e.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Rango de fechas</Label>
            <div className="flex items-center gap-2">
              <span className="w-12 text-xs text-muted-foreground">Inicial</span>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 text-xs text-muted-foreground">Final</span>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {ordenes === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar. Con &quot;Solo por Aprobar&quot; ves
              únicamente las órdenes que están esperando aprobación.
            </div>
          ) : ordenes === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando órdenes...
            </div>
          ) : ordenes.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              <ClipboardCheck className="h-8 w-8" />
              Ninguna orden de compra coincide con los filtros.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N°</TableHead>
                    <TableHead>Proyecto</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Creada por</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="w-[300px]">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordenes.map((orden) => {
                    const badge = ESTADO_VISIBLE_BADGE[orden.estado]
                    const puedeGestionar = permisos?.esAdmin && orden.estado === "pendiente_aprobacion"
                    const puedeDesaprobar = permisos?.puedeDesaprobar && sePuedeDesaprobar(orden)
                    const procesando = procesandoId === orden.id
                    return (
                      <TableRow
                        key={orden.id}
                        className={orden.tieneSobrecostoPrecio ? "bg-destructive/10 hover:bg-destructive/15" : undefined}
                      >
                        <TableCell className="font-medium">{orden.numero}</TableCell>
                        <TableCell>{orden.proyectoCodigo ?? orden.proyectoNombre ?? "—"}</TableCell>
                        <TableCell>{orden.proveedorNombre}</TableCell>
                        <TableCell>{orden.creadaPorNombre ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatoFecha(orden.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={badge.clase}>{badge.label}</Badge>
                            {orden.tieneSobrecostoPrecio && (
                              <Badge
                                variant="destructive"
                                title="Alguna línea tiene un precio por encima del +10% del precio unitario vigente"
                              >
                                Precio +10%
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {/* Dos casillas de ancho fijo: Ver siempre en el mismo sitio y, a su
                              lado, o Desaprobar o Aprobar + Rechazar (mismo ancho y alto). */}
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 w-20 shrink-0"
                              onClick={() => setOrdenAbiertaId(orden.id)}
                            >
                              <Eye className="mr-1.5 h-4 w-4" />
                              Ver
                            </Button>
                            <div className="flex h-8 w-44 shrink-0 items-center gap-2">
                              {puedeDesaprobar && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 w-full border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                                  disabled={procesando}
                                  onClick={() => {
                                    setDesaprobando(orden)
                                    setMotivoDesaprobacion("")
                                  }}
                                  aria-label={`Desaprobar orden ${orden.numero}`}
                                >
                                  <Undo2 className="mr-1.5 h-4 w-4" />
                                  Desaprobar
                                </Button>
                              )}
                              {puedeGestionar && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 flex-1 border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                                    disabled={procesando}
                                    onClick={() => setPorAprobar(orden)}
                                    aria-label={`Aprobar orden ${orden.numero}`}
                                  >
                                    {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 flex-1 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                                    disabled={procesando}
                                    onClick={() => {
                                      setRechazandoId(orden.id)
                                      setMotivoRechazo("")
                                    }}
                                    aria-label={`Rechazar orden ${orden.numero}`}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {ordenes !== null && ordenes.length > 0 && (
            <PaginacionSimple
              pagina={pagina}
              hayMas={hayMas}
              cargando={cargando}
              onCambiar={(n) => cargar(ultimosFiltros, n)}
            />
          )}
        </div>
      </div>

      <Dialog
        open={rechazandoId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRechazandoId(null)
            setMotivoRechazo("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar orden de compra</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Las líneas de esta orden se mantienen para revisión manual — los pedidos no vuelven
            automáticamente a la cola de "Comprar requisiciones".
          </p>
          <Textarea
            placeholder="Motivo del rechazo (obligatorio)"
            value={motivoRechazo}
            onChange={(e) => setMotivoRechazo(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechazandoId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivoRechazo.trim() || procesandoId === rechazandoId}
              onClick={confirmarRechazo}
            >
              {procesandoId === rechazandoId ? "Rechazando..." : "Rechazar orden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={desaprobando !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDesaprobando(null)
            setMotivoDesaprobacion("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desaprobar orden de compra #{desaprobando?.numero}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            La orden vuelve a &ldquo;Pendiente&rdquo; y se podrá aprobar o rechazar de nuevo. Solo se
            puede desaprobar si no tiene material recibido (entradas de almacén).
          </p>
          <Textarea
            placeholder="Motivo (obligatorio)"
            value={motivoDesaprobacion}
            onChange={(e) => setMotivoDesaprobacion(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDesaprobando(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivoDesaprobacion.trim() || procesandoId === desaprobando?.id}
              onClick={confirmarDesaprobacion}
            >
              {procesandoId === desaprobando?.id ? "Desaprobando..." : "Desaprobar orden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={ordenAbiertaId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOrdenAbiertaId(null)
            if (ordenes !== null) cargar()
          }
        }}
      >
        <DialogContent className="flex h-[90vh] w-[90vw] max-w-none flex-col overflow-hidden sm:max-w-none">
          <DialogTitle className="sr-only">Detalle de orden de compra</DialogTitle>
          {ordenAbiertaId && (
            <OrdenCompraDetalleView
              ordenId={ordenAbiertaId}
              onCerrar={() => {
                setOrdenAbiertaId(null)
                if (ordenes !== null) cargar()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmarAprobacion
        abierta={porAprobar !== null}
        titulo={`¿Aprobar la orden de compra #${porAprobar?.numero ?? ""}?`}
        detalle={
          porAprobar
            ? `Proveedor: ${porAprobar.proveedorNombre}. Al aprobarla se generan sus pagos y queda lista para recibir en almacén.`
            : ""
        }
        procesando={porAprobar !== null && procesandoId === porAprobar.id}
        onConfirmar={() => porAprobar && handleAprobar(porAprobar.id)}
        onCerrar={() => setPorAprobar(null)}
      />
    </div>
  )
}
