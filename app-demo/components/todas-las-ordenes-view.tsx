"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Download, Ban } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { PanelFiltros } from "@/components/panel-filtros"
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

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

const ESTADOS_FILTRO = Object.entries(ESTADO_VISIBLE_BADGE).map(([valor, b]) => ({
  valor: valor as EstadoOrdenVisible,
  etiqueta: b.label,
}))

async function buscarUsuariosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const usuarios = await buscarUsuarios(termino)
  return usuarios.map((u) => ({ id: u.id, etiqueta: u.nombre }))
}

export function TodasLasOrdenesView() {
  const router = useRouter()
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [ordenes, setOrdenes] = useState<OrdenCompraListado[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Últimos filtros consultados (para refrescar tras cancelar una orden).
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosOrdenesCompra>({})

  // Filtros del panel (todos opcionales)
  const [proyectos, setProyectos] = useState<{ id: string; codigo: string | null; nombre: string }[]>([])
  const [numero, setNumero] = useState("")
  const [proyectoId, setProyectoId] = useState("todos")
  const [proveedor, setProveedor] = useState("")
  const [estado, setEstado] = useState<EstadoOrdenVisible | "todos">("todos")
  const [creadaPor, setCreadaPor] = useState<OpcionBuscador | null>(null)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  const [permisos, setPermisos] = useState<PermisosOrdenCompra | null>(null)
  const [cancelando, setCancelando] = useState<OrdenCompraListado | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)

  function cargar(filtros: FiltrosOrdenesCompra = ultimosFiltros) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    listarTodasLasOrdenesCompra(filtros)
      .then((o: OrdenCompraListado[]) => setOrdenes(o))
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
      creadaPorId: creadaPor?.id,
      desde: desde || undefined,
      hasta: hasta || undefined,
    })
    return true
  }

  function limpiar() {
    setNumero("")
    setProyectoId("todos")
    setProveedor("")
    setEstado("todos")
    setCreadaPor(null)
    setDesde("")
    setHasta("")
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

  // La columna de acciones aparece si el usuario puede cancelar órdenes, o si
  // tiene alguna orden propia pendiente que puede retirar.
  const hayAcciones = !!permisos && (permisos.puedeCancelar || (ordenes ?? []).some((o) => muestraCancelar(o, permisos)))

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">Órdenes de compra</h1>

      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Ningún filtro es obligatorio: sin filtros se consultan todas."
        >
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
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Proyecto</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creada por</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-center">PDF</TableHead>
                {hayAcciones && <TableHead className="text-center">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenes.map((orden) => {
                const badge = ESTADO_VISIBLE_BADGE[orden.estadoVisible]
                return (
                  <TableRow
                    key={orden.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/almacen/ordenes-compra/${orden.id}`)}
                  >
                    <TableCell>{orden.numero}</TableCell>
                    <TableCell>{orden.proyectoCodigo ?? orden.proyectoNombre ?? "—"}</TableCell>
                    <TableCell>{orden.proveedorNombre}</TableCell>
                    <TableCell>
                      {/* El flex va en un div: una celda con display:flex deja de ser
                          celda de tabla y se descuadra respecto al resto de la fila. */}
                      <div className="flex items-center gap-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>{orden.creadaPorNombre ?? "—"}</TableCell>
                    <TableCell>{formatoFecha(orden.createdAt)}</TableCell>
                    <TableCell className="text-center">
                      {orden.estado === "aprobada" ? (
                        <a
                          href={`/almacen/ordenes-compra/${orden.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex text-primary hover:underline"
                          aria-label={`Descargar PDF de la orden ${orden.numero}`}
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {hayAcciones && (
                      <TableCell className="text-center">
                        {permisos && muestraCancelar(orden, permisos) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={(e) => {
                              e.stopPropagation()
                              setCancelando(orden)
                              setMotivo("")
                            }}
                            aria-label={`Cancelar orden ${orden.numero}`}
                          >
                            <Ban className="mr-1.5 h-4 w-4" />
                            {orden.estado === "pendiente_aprobacion" ? "Retirar" : "Cancelar"}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
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
    </div>
  )
}
