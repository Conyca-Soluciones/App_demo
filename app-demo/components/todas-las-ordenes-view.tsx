"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Download, Ban } from "lucide-react"
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
import {
  listarTodasLasOrdenesCompra,
  obtenerPermisosOrdenCompra,
  cancelarOrdenCompra,
  type OrdenCompraListado,
  type PermisosOrdenCompra,
} from "@/app/(app)/almacen/comprar-pedidos/actions"
import {
  ESTADO_VISIBLE_BADGE,
  FILTROS_ESTADO_VISIBLE,
  muestraCancelar,
  type EstadoOrdenVisible,
} from "@/lib/ordenes-compra-estado"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

export function TodasLasOrdenesView() {
  const router = useRouter()
  const [ordenes, setOrdenes] = useState<OrdenCompraListado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoOrdenVisible | "todas">("todas")

  const [permisos, setPermisos] = useState<PermisosOrdenCompra | null>(null)
  const [cancelando, setCancelando] = useState<OrdenCompraListado | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)

  function cargar() {
    Promise.all([listarTodasLasOrdenesCompra(), obtenerPermisosOrdenCompra()])
      .then(([o, p]: [OrdenCompraListado[], PermisosOrdenCompra]) => {
        setOrdenes(o)
        setPermisos(p)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las órdenes."))
  }

  useEffect(cargar, [])

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

  const ordenesFiltradas = useMemo(() => {
    if (!ordenes) return []
    if (filtroEstado === "todas") return ordenes
    return ordenes.filter((o) => o.estadoVisible === filtroEstado)
  }, [ordenes, filtroEstado])

  // La columna de acciones aparece si el usuario puede cancelar órdenes, o si
  // tiene alguna orden propia pendiente que puede retirar.
  const hayAcciones = !!permisos && (permisos.puedeCancelar || ordenesFiltradas.some((o) => muestraCancelar(o, permisos)))

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">Órdenes de compra</h1>

      <div className="flex gap-2">
        {FILTROS_ESTADO_VISIBLE.map((f) => (
          <Button
            key={f.valor}
            size="sm"
            variant={filtroEstado === f.valor ? "default" : "outline"}
            onClick={() => setFiltroEstado(f.valor)}
          >
            {f.etiqueta}
          </Button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {ordenes === null ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando órdenes...
        </div>
      ) : ordenesFiltradas.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          No hay órdenes de compra con este filtro.
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
              {ordenesFiltradas.map((orden) => {
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
                        {orden.enviada && <Badge variant="outline">Enviada</Badge>}
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
            {cancelando?.enviada && (
              <strong className="mt-2 block text-foreground">
                Esta orden ya fue marcada como enviada: avísale al proveedor de la cancelación.
              </strong>
            )}
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
