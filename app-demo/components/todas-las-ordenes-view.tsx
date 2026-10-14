"use client"

import { Fragment, useEffect, useState } from "react"
import { Loader2, Download, Ban, Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { OrdenCompraDetalleView } from "@/components/orden-compra-detalle-view"
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
import {
  exportarOrdenesCompra,
  listarTodasLasOrdenesCompra,
  obtenerPermisosOrdenCompra,
  cancelarOrdenCompra,
  buscarUsuarios,
  type FiltrosOrdenesCompra,
  type OrdenCompraListado,
  type PermisosOrdenCompra,
} from "@/app/(app)/almacen/comprar-pedidos/actions"
import { verProyectos } from "@/app/(app)/almacen/actions"
import {
  ESTADO_VISIBLE_BADGE,
  muestraCancelar,
  type EstadoOrdenVisible,
} from "@/lib/ordenes-compra-estado"
import { descargarExcelOrdenes, type VistaOrdenes } from "@/lib/exportar-ordenes-compra"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

const formatoMoneda = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})
const formatoNumero = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })
const formatoPorcentaje = (n: number) => `${n.toLocaleString("es-CO", { maximumFractionDigits: 2 })} %`

const ESTADOS_FILTRO = Object.entries(ESTADO_VISIBLE_BADGE).map(([valor, b]) => ({
  valor: valor as EstadoOrdenVisible,
  etiqueta: b.label,
}))

async function buscarUsuariosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const usuarios = await buscarUsuarios(termino)
  return usuarios.map((u) => ({ id: u.id, etiqueta: u.nombre }))
}

export function TodasLasOrdenesView() {
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [ordenes, setOrdenes] = useState<OrdenCompraListado[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Últimos filtros consultados (para refrescar tras cancelar una orden).
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosOrdenesCompra>({})

  // Filtros del panel (todos opcionales)
  const [proyectos, setProyectos] = useState<{ id: string; codigo: string | null; nombre: string }[]>([])
  const [numero, setNumero] = useState("")
  const [proyectoId, setProyectoId] = useState("todos")
  const [proveedor, setProveedor] = useState("")
  const [estado, setEstado] = useState<EstadoOrdenVisible | "todos">("todos")
  // Las canceladas no se muestran salvo que se pida (o se filtre por ese estado).
  const [mostrarCanceladas, setMostrarCanceladas] = useState(false)
  const [creadaPor, setCreadaPor] = useState<OpcionBuscador | null>(null)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  // Resumida = una fila por orden con su valor total; detallada = además todos
  // sus insumos con precios. Cambia la tabla al instante (los datos ya traen
  // las líneas) y es la que se descarga a Excel.
  const [vista, setVista] = useState<VistaOrdenes>("resumida")
  const [descargando, setDescargando] = useState(false)

  const [permisos, setPermisos] = useState<PermisosOrdenCompra | null>(null)
  // Orden abierta con el botón Ver (detalle encima de la lista).
  const [abiertaId, setAbiertaId] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<OrdenCompraListado | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)

  function cargar(filtros: FiltrosOrdenesCompra = ultimosFiltros, pag: number = pagina) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    listarTodasLasOrdenesCompra(filtros, pag)
      .then((r: { ordenes: OrdenCompraListado[]; hayMas: boolean }) => {
        // Si la página quedó vacía (p. ej. se canceló la última de la página), se retrocede.
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
      estado: estado === "todos" ? undefined : estado,
      incluirCanceladas: mostrarCanceladas,
      creadaPorId: creadaPor?.id,
      desde: desde || undefined,
      hasta: hasta || undefined,
    }, 0)
    return true
  }

  function limpiar() {
    setNumero("")
    setProyectoId("todos")
    setProveedor("")
    setEstado("todos")
    setMostrarCanceladas(false)
    setCreadaPor(null)
    setDesde("")
    setHasta("")
    setVista("resumida")
  }

  // Descarga TODO lo que cumple la última consulta (no solo esta página), en la vista elegida.
  async function descargar() {
    setDescargando(true)
    setError(null)
    try {
      const todas = await exportarOrdenesCompra(ultimosFiltros)
      if (todas.length === 0) {
        setError("No hay órdenes de compra para descargar con estos filtros.")
        return
      }
      await descargarExcelOrdenes(todas, vista)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descargar el Excel.")
    } finally {
      setDescargando(false)
    }
  }

  // PDF y Acciones de una orden (iguales en las dos vistas; en la detallada
  // ocupan todas las filas de sus insumos).
  function celdasAcciones(orden: OrdenCompraListado, filas = 1) {
    return (
      <>
        <TableCell rowSpan={filas} className="text-center align-top">
          {orden.estado === "aprobada" ? (
            <a
              href={`/almacen/ordenes-compra/${orden.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-primary hover:underline"
              aria-label={`Descargar PDF de la orden ${orden.numero}`}
            >
              <Download className="h-4 w-4" />
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell rowSpan={filas} className="align-top">
          {/* Dos casillas de ancho fijo: Ver siempre en el mismo sitio y, a su
              lado, Cancelar / Retirar cuando aplica. */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-20 shrink-0"
              onClick={() => setAbiertaId(orden.id)}
              aria-label={`Ver orden ${orden.numero}`}
            >
              <Eye className="mr-1.5 h-4 w-4" />
              Ver
            </Button>
            <div className="flex h-8 w-44 shrink-0 items-center">
              {permisos && muestraCancelar(orden, permisos) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => {
                    setCancelando(orden)
                    setMotivo("")
                  }}
                  aria-label={`Cancelar orden ${orden.numero}`}
                >
                  <Ban className="mr-1.5 h-4 w-4" />
                  {orden.estado === "pendiente_aprobacion" ? "Retirar" : "Cancelar"}
                </Button>
              )}
            </div>
          </div>
        </TableCell>
      </>
    )
  }

  async function confirmarCancelacion() {
    if (!cancelando || !motivo.trim()) return
    setProcesando(true)
    setError(null)
    try {
      await cancelarOrdenCompra(cancelando.id, motivo.trim())
      setCancelando(null)
      setMotivo("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar la orden.")
      setCancelando(null)
    } finally {
      setProcesando(false)
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
            <Label>Vista</Label>
            <Select value={vista} onValueChange={(v) => setVista((v ?? "resumida") as VistaOrdenes)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="resumida">Órdenes de compra resumidas</SelectItem>
                <SelectItem value="detallada">Órdenes de compra detalladas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="numero-oc">N°</Label>
            <Input
              id="numero-oc"
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
            <Label htmlFor="proveedor-oc">Proveedor</Label>
            <Input
              id="proveedor-oc"
              placeholder="Nombre del proveedor"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select
              value={estado}
              onValueChange={(v) => setEstado((v ?? "todos") as EstadoOrdenVisible | "todos")}
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

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={mostrarCanceladas}
              onCheckedChange={(v) => setMostrarCanceladas(v === true)}
            />
            Mostrar órdenes canceladas
          </label>

          <div className="space-y-1.5">
            <Label>Creada por</Label>
            <BuscadorAsync
              placeholder="Buscar usuario"
              valorSeleccionado={creadaPor}
              onSeleccionar={setCreadaPor}
              buscar={buscarUsuariosAdaptado}
            />
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
          Elige los filtros que quieras y presiona Consultar para ver las órdenes de compra.
        </div>
      ) : ordenes === null ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando órdenes...
        </div>
      ) : ordenes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          Ninguna orden de compra coincide con los filtros.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {ordenes.length} {ordenes.length === 1 ? "orden" : "órdenes"} en esta página.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={descargar}
              disabled={descargando}
              title={
                vista === "resumida"
                  ? "Descarga todas las órdenes de la consulta (todas las páginas), una fila por orden con su valor total."
                  : "Descarga todas las órdenes de la consulta (todas las páginas), una fila por insumo con precios y valor."
              }
            >
              {descargando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Descargar Excel
            </Button>
          </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          {vista === "resumida" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creada por</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Valor total</TableHead>
                <TableHead className="text-center">PDF</TableHead>
                <TableHead className="w-[290px]">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenes.map((orden) => {
                const badge = ESTADO_VISIBLE_BADGE[orden.estadoVisible]
                return (
                  <TableRow key={orden.id}>
                    <TableCell>{orden.numero}</TableCell>
                    <TableCell>{orden.proyectoCodigo ?? orden.proyectoNombre ?? "—"}</TableCell>
                    <TableCell>{orden.proveedorNombre}</TableCell>
                    <TableCell>
                      {/* El flex va en un div: una celda con display:flex deja de ser
                          celda de tabla y se descuadra respecto al resto de la fila. */}
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={badge.clase}>{badge.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>{orden.creadaPorNombre ?? "—"}</TableCell>
                    <TableCell>{formatoFecha(orden.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatoMoneda.format(orden.valorTotal)}</TableCell>
                    {celdasAcciones(orden)}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creada por</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="min-w-64">Insumo</TableHead>
                <TableHead>UM</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio unitario</TableHead>
                <TableHead className="text-right">Desc.</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right">Valor total</TableHead>
                <TableHead className="text-center">PDF</TableHead>
                <TableHead className="w-[290px]">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenes.map((orden) => {
                const badge = ESTADO_VISIBLE_BADGE[orden.estadoVisible]
                // Los datos de la orden ocupan sus insumos + la fila del total.
                const filas = Math.max(orden.lineas.length, 1) + 1
                const datosOrden = (
                  <>
                    <TableCell rowSpan={filas} className="align-top font-medium">{orden.numero}</TableCell>
                    <TableCell rowSpan={filas} className="align-top">{orden.proyectoCodigo ?? orden.proyectoNombre ?? "—"}</TableCell>
                    <TableCell rowSpan={filas} className="align-top">{orden.proveedorNombre}</TableCell>
                    <TableCell rowSpan={filas} className="align-top">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={badge.clase}>{badge.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell rowSpan={filas} className="align-top">{orden.creadaPorNombre ?? "—"}</TableCell>
                    <TableCell rowSpan={filas} className="align-top">{formatoFecha(orden.createdAt)}</TableCell>
                  </>
                )
                return (
                  <Fragment key={orden.id}>
                    {orden.lineas.length === 0 ? (
                      <TableRow className="border-b-0">
                        {datosOrden}
                        <TableCell colSpan={7} className="text-muted-foreground">Sin insumos.</TableCell>
                        {celdasAcciones(orden, filas)}
                      </TableRow>
                    ) : (
                      orden.lineas.map((l, i) => (
                        <TableRow key={l.id} className="border-b-0">
                          {i === 0 && datosOrden}
                          <TableCell className="whitespace-normal">
                            {l.insumoCodigo != null ? `${l.insumoCodigo} - ` : ""}
                            {l.insumoDescripcion}
                          </TableCell>
                          <TableCell>{l.um ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatoNumero(l.cantidad)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatoMoneda.format(l.precioUnitario)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatoPorcentaje(l.porcentajeDescuento)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatoPorcentaje(l.porcentajeIva)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatoMoneda.format(l.total)}</TableCell>
                          {i === 0 && celdasAcciones(orden, filas)}
                        </TableRow>
                      ))
                    )}
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={6} className="text-right text-xs font-medium text-muted-foreground">
                        Total de la orden {orden.numero}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatoMoneda.format(orden.valorTotal)}</TableCell>
                    </TableRow>
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
          )}
        </div>
        </>
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
        open={cancelando !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelando(null)
            setMotivo("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar orden de compra #{cancelando?.numero}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            La orden queda cancelada y sus pedidos vuelven a &ldquo;Comprar pedidos&rdquo; para poder
            comprarse de nuevo. No se puede cancelar una orden con entrega parcial o entregada.
            <strong className="mt-2 block text-foreground">
              Esta orden ya fue creada: avísale al proveedor de la cancelación.
            </strong>
          </p>
          <Textarea
            placeholder="Motivo de la cancelación (obligatorio)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              disabled={!motivo.trim() || procesando}
              onClick={confirmarCancelacion}
            >
              {procesando ? "Cancelando..." : "Cancelar orden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detalle encima de la lista (igual que en Aprobación de órdenes de compra). */}
      <Dialog
        open={abiertaId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAbiertaId(null)
            if (ordenes !== null) cargar()
          }
        }}
      >
        <DialogContent className="flex h-[90vh] w-[90vw] max-w-none flex-col overflow-hidden sm:max-w-none">
          <DialogTitle className="sr-only">Detalle de orden de compra</DialogTitle>
          {abiertaId && (
            <OrdenCompraDetalleView
              ordenId={abiertaId}
              onCerrar={() => {
                setAbiertaId(null)
                if (ordenes !== null) cargar()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
