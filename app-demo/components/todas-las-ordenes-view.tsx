"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Download } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  type OrdenCompraListado,
  type OrdenCompraEstado,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

const ESTADO_BADGE: Record<
  OrdenCompraEstado,
  { label: string; variant: "default" | "destructive" | "secondary" }
> = {
  pendiente_aprobacion: { label: "Pendiente", variant: "secondary" },
  aprobada: { label: "Aprobada", variant: "default" },
  rechazada: { label: "Rechazada", variant: "destructive" },
}

const FILTROS_ESTADO: { valor: OrdenCompraEstado | "todas"; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "pendiente_aprobacion", etiqueta: "Pendientes" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
]

export function TodasLasOrdenesView() {
  const router = useRouter()
  const [ordenes, setOrdenes] = useState<OrdenCompraListado[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<OrdenCompraEstado | "todas">("todas")

  useEffect(() => {
    listarTodasLasOrdenesCompra()
      .then(setOrdenes)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las órdenes."))
  }, [])

  const ordenesFiltradas = useMemo(() => {
    if (!ordenes) return []
    if (filtroEstado === "todas") return ordenes
    return ordenes.filter((o) => o.estado === filtroEstado)
  }, [ordenes, filtroEstado])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">Órdenes de compra</h1>

      <div className="flex gap-2">
        {FILTROS_ESTADO.map((f) => (
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenesFiltradas.map((orden) => {
                const badge = ESTADO_BADGE[orden.estado]
                return (
                  <TableRow
                    key={orden.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/almacen/ordenes-compra/${orden.id}`)}
                  >
                    <TableCell>{orden.numero}</TableCell>
                    <TableCell>{orden.proyectoCodigo ?? orden.proyectoNombre ?? "—"}</TableCell>
                    <TableCell>{orden.proveedorNombre}</TableCell>
                    <TableCell className="flex items-center gap-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {orden.enviada && <Badge variant="outline">Enviada</Badge>}
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
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}