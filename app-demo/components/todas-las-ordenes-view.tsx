"use client"

import { useEffect, useState } from "react"
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
import { CampoFecha } from "@/components/ui/campo-fecha"
import { AYUDA_DOBLE_CLIC } from "@/components/ventana-detalle"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"

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

  // PDF y botones de una orden (celdas de las dos vistas).
  function pdfOrden(orden: OrdenCompraListado) {
    return orden.estado === "aprobada" ? (
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
          )
  }

  // Dos casillas de ancho fijo: Ver siempre en el mismo sitio y, a su lado,
  // Cancelar / Retirar cuando aplica.
  function botonesOrden(orden: OrdenCompraListado) {
    return (
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
    )
  }

  const columnas: ColumnaExcel<OrdenCompraListado>[] = [
    { clave: "numero", titulo: "N°", ancho: 80, fija: true, texto: (o) => String(o.numero), valorOrden: (o) => o.numero, claseCelda: "font-medium tabular-nums" },
    { clave: "proyecto", titulo: "Proyecto", ancho: 170, texto: (o) => o.proyectoCodigo ?? o.proyectoNombre ?? "" },
    { clave: "proveedor", titulo: "Proveedor", ancho: 240, flexible: true, texto: (o) => o.proveedorNombre },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 130,
      alinear: "center",
      texto: (o) => ESTADO_VISIBLE_BADGE[o.estadoVisible].label,
      celda: (o) => <Badge variant="outline" className={ESTADO_VISIBLE_BADGE[o.estadoVisible].clase}>{ESTADO_VISIBLE_BADGE[o.estadoVisible].label}</Badge>,
    },
    { clave: "creadaPor", titulo: "Creada por", ancho: 160, texto: (o) => o.creadaPorNombre ?? "" },
    { clave: "fecha", titulo: "Fecha", ancho: 160, texto: (o) => formatoFecha(o.createdAt), valorOrden: (o) => o.createdAt, claseCelda: "tabular-nums" },
    { clave: "valor", titulo: "Valor total", ancho: 140, alinear: "right", texto: (o) => formatoMoneda.format(o.valorTotal), valorOrden: (o) => o.valorTotal, claseCelda: "tabular-nums" },
    { clave: "pdf", titulo: "PDF", ancho: 70, alinear: "center", ordenable: false, texto: () => "", celda: (o) => pdfOrden(o) },
    { clave: "acciones", titulo: "Acciones", ancho: 290, ordenable: false, texto: () => "", celda: (o) => botonesOrden(o) },
  ]
  const { ordenadas, orden, ordenar } = useOrdenExcel(ordenes ?? [], columnas)

  // Vista detallada: filas de insumo + una de total por orden (en una pasada).
  type FilaDetalle = {
    clave: string
    tipo: "linea" | "vacia" | "total"
    primera: boolean
    orden: OrdenCompraListado
    linea: OrdenCompraListado["lineas"][number] | null
  }
  const filasDetalle: FilaDetalle[] = []
  for (const o of ordenes ?? []) {
    if (o.lineas.length === 0) filasDetalle.push({ clave: `${o.id}-vacia`, tipo: "vacia", primera: true, orden: o, linea: null })
    o.lineas.forEach((l, i) => filasDetalle.push({ clave: l.id, tipo: "linea", primera: i === 0, orden: o, linea: l }))
    filasDetalle.push({ clave: `${o.id}-total`, tipo: "total", primera: false, orden: o, linea: null })
  }
  const deOrden = (f: FilaDetalle, valor: string) => (f.primera ? valor : "")
  const columnasDetalle: ColumnaExcel<FilaDetalle>[] = [
    { clave: "numero", titulo: "N°", ancho: 80, fija: true, ordenable: false, texto: (f) => deOrden(f, String(f.orden.numero)), claseCelda: "font-medium tabular-nums" },
    { clave: "proyecto", titulo: "Proyecto", ancho: 150, ordenable: false, texto: (f) => deOrden(f, f.orden.proyectoCodigo ?? f.orden.proyectoNombre ?? "") },
    { clave: "proveedor", titulo: "Proveedor", ancho: 200, ordenable: false, texto: (f) => deOrden(f, f.orden.proveedorNombre) },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 120,
      alinear: "center",
      ordenable: false,
      texto: (f) => deOrden(f, ESTADO_VISIBLE_BADGE[f.orden.estadoVisible].label),
      celda: (f) =>
        f.primera ? (
          <Badge variant="outline" className={ESTADO_VISIBLE_BADGE[f.orden.estadoVisible].clase}>{ESTADO_VISIBLE_BADGE[f.orden.estadoVisible].label}</Badge>
        ) : null,
    },
    { clave: "creadaPor", titulo: "Creada por", ancho: 150, ordenable: false, texto: (f) => deOrden(f, f.orden.creadaPorNombre ?? "") },
    { clave: "fecha", titulo: "Fecha", ancho: 150, ordenable: false, texto: (f) => deOrden(f, formatoFecha(f.orden.createdAt)), claseCelda: "tabular-nums" },
    {
      clave: "insumo",
      titulo: "Insumo",
      ancho: 260,
      flexible: true,
      ordenable: false,
      texto: (f) =>
        f.tipo === "total"
          ? `Total de la orden ${f.orden.numero}`
          : f.tipo === "vacia"
            ? "Sin insumos."
            : `${f.linea!.insumoCodigo != null ? `${f.linea!.insumoCodigo} - ` : ""}${f.linea!.insumoDescripcion}`,
      celda: (f) =>
        f.tipo === "total" ? (
          <span className="w-full text-right text-xs font-medium text-muted-foreground">Total de la orden {f.orden.numero}</span>
        ) : f.tipo === "vacia" ? (
          <span className="text-muted-foreground">Sin insumos.</span>
        ) : (
          <span className="truncate" title={f.linea!.insumoDescripcion}>
            {f.linea!.insumoCodigo != null ? `${f.linea!.insumoCodigo} - ` : ""}
            {f.linea!.insumoDescripcion}
          </span>
        ),
    },
    { clave: "um", titulo: "UM", ancho: 110, ordenable: false, texto: (f) => f.linea?.um ?? "" },
    { clave: "cantidad", titulo: "Cantidad", ancho: 100, alinear: "right", ordenable: false, texto: (f) => (f.linea ? formatoNumero(f.linea.cantidad) : ""), claseCelda: "tabular-nums" },
    { clave: "precio", titulo: "Precio unitario", ancho: 130, alinear: "right", ordenable: false, texto: (f) => (f.linea ? formatoMoneda.format(f.linea.precioUnitario) : ""), claseCelda: "tabular-nums" },
    { clave: "desc", titulo: "Desc.", ancho: 80, alinear: "right", ordenable: false, texto: (f) => (f.linea ? formatoPorcentaje(f.linea.porcentajeDescuento) : ""), claseCelda: "tabular-nums" },
    { clave: "iva", titulo: "IVA", ancho: 80, alinear: "right", ordenable: false, texto: (f) => (f.linea ? formatoPorcentaje(f.linea.porcentajeIva) : ""), claseCelda: "tabular-nums" },
    {
      clave: "valor",
      titulo: "Valor total",
      ancho: 140,
      alinear: "right",
      ordenable: false,
      texto: (f) => (f.tipo === "total" ? formatoMoneda.format(f.orden.valorTotal) : f.linea ? formatoMoneda.format(f.linea.total) : ""),
      claseCelda: "tabular-nums",
      celda: (f) => (
        <span className={f.tipo === "total" ? "font-semibold" : ""}>
          {f.tipo === "total" ? formatoMoneda.format(f.orden.valorTotal) : f.linea ? formatoMoneda.format(f.linea.total) : ""}
        </span>
      ),
    },
    { clave: "pdf", titulo: "PDF", ancho: 70, alinear: "center", ordenable: false, texto: () => "", celda: (f) => (f.primera ? pdfOrden(f.orden) : null) },
    { clave: "acciones", titulo: "Acciones", ancho: 290, ordenable: false, texto: () => "", celda: (f) => (f.primera ? botonesOrden(f.orden) : null) },
  ]

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
              <CampoFecha value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 text-xs text-muted-foreground">Final</span>
              <CampoFecha value={hasta} onChange={(e) => setHasta(e.target.value)} />
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
        {vista === "resumida" ? (
          <TablaExcel
            filas={ordenadas}
            columnas={columnas}
            claveFila={(o) => o.id}
            orden={orden}
            onOrdenar={ordenar}
            onDobleClickFila={(o) => setAbiertaId(o.id)}
            tituloFila={AYUDA_DOBLE_CLIC}
            tarjeta={{
              titulo: (o) => `OC N° ${o.numero}`,
              subtitulo: (o) => `${o.proyectoCodigo ?? o.proyectoNombre ?? "—"} · ${o.proveedorNombre}`,
              esquina: (o) => <Badge variant="outline" className={ESTADO_VISIBLE_BADGE[o.estadoVisible].clase}>{ESTADO_VISIBLE_BADGE[o.estadoVisible].label}</Badge>,
              campos: ["creadaPor", "fecha", "valor", "pdf", "acciones"],
            }}
          />
        ) : (
          // Detallada: una fila por insumo y una de total por orden; los datos
          // de la orden van solo en su primera fila.
          <TablaExcel
            filas={filasDetalle}
            columnas={columnasDetalle}
            claveFila={(f) => f.clave}
            onDobleClickFila={(f) => setAbiertaId(f.orden.id)}
            tituloFila={AYUDA_DOBLE_CLIC}
            fondoFila={(f) => (f.tipo === "total" ? "bg-muted/40" : undefined)}
            vacioEnBlanco
            tarjeta={{
              titulo: (f) => (f.tipo === "total" ? `Total de la orden ${f.orden.numero}` : `OC N° ${f.orden.numero}`),
              subtitulo: (f) => (f.linea ? `${f.linea.insumoCodigo != null ? `${f.linea.insumoCodigo} - ` : ""}${f.linea.insumoDescripcion}` : f.orden.proveedorNombre),
              campos: ["um", "cantidad", "precio", "valor"],
            }}
          />
        )}
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
            La orden queda cancelada y sus requisiciones vuelven a &ldquo;Requisiciones por comprar&rdquo; para poder
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
