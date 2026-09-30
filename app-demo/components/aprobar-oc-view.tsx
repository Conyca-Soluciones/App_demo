// "use client"

// import { useEffect, useMemo, useState } from "react"
// import { Loader2, ClipboardCheck, Eye, Check, X, RefreshCw } from "lucide-react"
// import { Badge } from "@/components/ui/badge"
// import { Button } from "@/components/ui/button"
// import {
//   Dialog,
//   DialogContent,
//   DialogFooter,
//   DialogHeader,
//   DialogTitle,
// } from "@/components/ui/dialog"
// import { Textarea } from "@/components/ui/textarea"
// import {
//   Table,
//   TableBody,
//   TableCell,
//   TableHead,
//   TableHeader,
//   TableRow,
// } from "@/components/ui/table"
// import { OrdenCompraDetalleView } from "./orden-compra-detalle-view"
// import {
//   listarTodasLasOrdenesCompra,
//   obtenerPermisosOrdenCompra,
//   aprobarOrdenCompra,
//   rechazarOrdenCompra,
//   type OrdenCompraListado,
//   type OrdenCompraEstado,
//   type PermisosOrdenCompra,
// } from "@/app/(app)/almacen/comprar-pedidos/actions"

// const formatoFecha = (iso: string) =>
//   new Date(iso).toLocaleString("es-CO", {
//     day: "2-digit",
//     month: "2-digit",
//     year: "numeric",
//     hour: "numeric",
//     minute: "2-digit",
//   })

// const ESTADO_BADGE: Record<
//   OrdenCompraEstado,
//   { label: string; variant: "default" | "destructive" | "secondary" }
// > = {
//   pendiente_aprobacion: { label: "Pendiente", variant: "secondary" },
//   aprobada: { label: "Aprobada", variant: "default" },
//   rechazada: { label: "Rechazada", variant: "destructive" },
// }

// const FILTROS_ESTADO: { valor: OrdenCompraEstado | "todas"; etiqueta: string }[] = [
//   { valor: "todas", etiqueta: "Todas" },
//   { valor: "pendiente_aprobacion", etiqueta: "Pendientes" },
//   { valor: "aprobada", etiqueta: "Aprobadas" },
//   { valor: "rechazada", etiqueta: "Rechazadas" },
// ]

// function Tile({ etiqueta, valor, color }: { etiqueta: string; valor: number; color?: string }) {
//   return (
//     <div className="rounded-lg border bg-card p-4">
//       <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
//       <p className={`mt-1 text-3xl font-semibold ${color ?? ""}`}>{valor}</p>
//     </div>
//   )
// }

// export function AprobarOCView() {
//   const [ordenes, setOrdenes] = useState<OrdenCompraListado[] | null>(null)
//   const [ordenAbiertaId, setOrdenAbiertaId] = useState<string | null>(null)
//   const [permisos, setPermisos] = useState<PermisosOrdenCompra | null>(null)
//   const [error, setError] = useState<string | null>(null)
//   const [cargando, setCargando] = useState(false)
//   const [filtroEstado, setFiltroEstado] = useState<OrdenCompraEstado | "todas">("todas")
//   const [procesandoId, setProcesandoId] = useState<string | null>(null)
//   const [rechazandoId, setRechazandoId] = useState<string | null>(null)
//   const [motivoRechazo, setMotivoRechazo] = useState("")

//   function cargar() {
//     setCargando(true)
//     setError(null)
//     Promise.all([listarTodasLasOrdenesCompra(), obtenerPermisosOrdenCompra()])
//       .then(([o, p]) => {
//         setOrdenes(o)
//         setPermisos(p)
//       })
//       .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las órdenes."))
//       .finally(() => setCargando(false))
//   }

//   useEffect(() => {
//     cargar()
//   }, [])

//   const conteos = useMemo(() => {
//     const base = { total: 0, pendiente_aprobacion: 0, aprobada: 0, rechazada: 0 }
//     if (!ordenes) return base
//     base.total = ordenes.length
//     for (const o of ordenes) base[o.estado] += 1
//     return base
//   }, [ordenes])

//   const ordenesFiltradas = useMemo(() => {
//     if (!ordenes) return []
//     if (filtroEstado === "todas") return ordenes
//     return ordenes.filter((o) => o.estado === filtroEstado)
//   }, [ordenes, filtroEstado])

//   async function handleAprobar(id: string) {
//     setProcesandoId(id)
//     setError(null)
//     try {
//       await aprobarOrdenCompra(id)
//       cargar()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo aprobar la orden.")
//     } finally {
//       setProcesandoId(null)
//     }
//   }

//   async function confirmarRechazo() {
//     if (!rechazandoId || !motivoRechazo.trim()) return
//     setProcesandoId(rechazandoId)
//     setError(null)
//     try {
//       await rechazarOrdenCompra(rechazandoId, motivoRechazo.trim())
//       setRechazandoId(null)
//       setMotivoRechazo("")
//       cargar()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo rechazar la orden.")
//     } finally {
//       setProcesandoId(null)
//     }
//   }

//   return (
//     <div className="flex h-full min-h-0 flex-col gap-4">
//       <div className="flex items-center justify-between">
//         <div className="flex items-center gap-3">
//           <h1 className="text-2xl font-semibold">Órdenes de compra</h1>
//           {conteos.pendiente_aprobacion > 0 && (
//             <Badge className="rounded-full px-2.5">{conteos.pendiente_aprobacion}</Badge>
//           )}
//         </div>
//         <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
//           <RefreshCw className={`mr-2 h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
//           Actualizar
//         </Button>
//       </div>

//       <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
//         <Tile etiqueta="Total" valor={conteos.total} />
//         <Tile etiqueta="Pendientes" valor={conteos.pendiente_aprobacion} color="text-amber-600" />
//         <Tile etiqueta="Aprobadas" valor={conteos.aprobada} color="text-emerald-600" />
//         <Tile etiqueta="Rechazadas" valor={conteos.rechazada} color="text-red-600" />
//       </div>

//       <div className="flex gap-2">
//         {FILTROS_ESTADO.map((f) => (
//           <Button
//             key={f.valor}
//             size="sm"
//             variant={filtroEstado === f.valor ? "default" : "outline"}
//             className="rounded-full"
//             onClick={() => setFiltroEstado(f.valor)}
//           >
//             {f.etiqueta}
//           </Button>
//         ))}
//       </div>

//       {error && (
//         <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
//           {error}
//         </div>
//       )}

//       {ordenes === null ? (
//         <div className="flex flex-1 items-center justify-center text-muted-foreground">
//           <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando órdenes...
//         </div>
//       ) : ordenesFiltradas.length === 0 ? (
//         <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
//           <ClipboardCheck className="h-8 w-8" />
//           No hay órdenes de compra con este filtro.
//         </div>
//       ) : (
//         <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
//           <Table>
//             <TableHeader>
//               <TableRow>
//                 <TableHead>N°</TableHead>
//                 <TableHead>Proyecto</TableHead>
//                 <TableHead>Proveedor</TableHead>
//                 <TableHead>Creada por</TableHead>
//                 <TableHead>Fecha</TableHead>
//                 <TableHead>Estado</TableHead>
//                 <TableHead className="text-right">Acciones</TableHead>
//               </TableRow>
//             </TableHeader>
//             <TableBody>
//               {ordenesFiltradas.map((orden) => {
//                 const badge = ESTADO_BADGE[orden.estado]
//                 const puedeGestionar = permisos?.esAdmin && orden.estado === "pendiente_aprobacion"
//                 const procesando = procesandoId === orden.id
//                 return (
//                   <TableRow key={orden.id}>
//                     <TableCell>{orden.numero}</TableCell>
//                     <TableCell>{orden.proyectoCodigo ?? orden.proyectoNombre ?? "—"}</TableCell>
//                     <TableCell>{orden.proveedorNombre}</TableCell>
//                     <TableCell>{orden.creadaPorNombre ?? "—"}</TableCell>
//                     <TableCell className="whitespace-nowrap">{formatoFecha(orden.createdAt)}</TableCell>
//                     <TableCell>
//                       <div className="flex items-center gap-2">
//                         <Badge variant={badge.variant}>{badge.label}</Badge>
//                         {orden.enviada && <Badge variant="outline">Enviada</Badge>}
//                       </div>
//                     </TableCell>
//                     <TableCell>
//                       <div className="flex items-center justify-end gap-1.5">
//                         <Button size="sm" variant="outline" onClick={() => setOrdenAbiertaId(orden.id)}>
//                           <Eye className="mr-1.5 h-4 w-4" />
//                           Ver
//                         </Button>
//                         {puedeGestionar && (
//                           <>
//                             <Button
//                               size="icon"
//                               variant="outline"
//                               className="border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
//                               disabled={procesando}
//                               onClick={() => handleAprobar(orden.id)}
//                               aria-label={`Aprobar orden ${orden.numero}`}
//                             >
//                               {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
//                             </Button>
//                             <Button
//                               size="icon"
//                               variant="outline"
//                               className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
//                               disabled={procesando}
//                               onClick={() => {
//                                 setRechazandoId(orden.id)
//                                 setMotivoRechazo("")
//                               }}
//                               aria-label={`Rechazar orden ${orden.numero}`}
//                             >
//                               <X className="h-4 w-4" />
//                             </Button>
//                           </>
//                         )}
//                       </div>
//                     </TableCell>
//                   </TableRow>
//                 )
//               })}
//             </TableBody>
//           </Table>
//         </div>
//       )}

//       <Dialog
//         open={rechazandoId !== null}
//         onOpenChange={(open) => {
//           if (!open) {
//             setRechazandoId(null)
//             setMotivoRechazo("")
//           }
//         }}
//       >
//         <DialogContent>
//           <DialogHeader>
//             <DialogTitle>Rechazar orden de compra</DialogTitle>
//           </DialogHeader>
//           <p className="text-sm text-muted-foreground">
//             Las líneas de esta orden se mantienen para revisión manual — los pedidos no vuelven
//             automáticamente a la cola de "Comprar pedidos".
//           </p>
//           <Textarea
//             placeholder="Motivo del rechazo (obligatorio)"
//             value={motivoRechazo}
//             onChange={(e) => setMotivoRechazo(e.target.value)}
//             rows={3}
//           />
//           <DialogFooter>
//             <Button variant="outline" onClick={() => setRechazandoId(null)}>
//               Cancelar
//             </Button>
//             <Button
//               variant="destructive"
//               disabled={!motivoRechazo.trim() || procesandoId === rechazandoId}
//               onClick={confirmarRechazo}
//             >
//               {procesandoId === rechazandoId ? "Rechazando..." : "Rechazar orden"}
//             </Button>
//           </DialogFooter>
//         </DialogContent>
//       </Dialog>

//       <Dialog
//         open={ordenAbiertaId !== null}
//         onOpenChange={(open) => {
//           if (!open) {
//             setOrdenAbiertaId(null)
//             cargar()
//           }
//         }}
//       >
//         <DialogContent className="flex h-[90vh] w-[90vw] max-w-none flex-col overflow-hidden sm:max-w-none">
//           <DialogTitle className="sr-only">Detalle de orden de compra</DialogTitle>
//           {ordenAbiertaId && (
//             <OrdenCompraDetalleView
//               ordenId={ordenAbiertaId}
//               onCerrar={() => {
//                 setOrdenAbiertaId(null)
//                 cargar()
//               }}
//             />
//           )}
//         </DialogContent>
//       </Dialog>
//     </div>
//   )
// }


"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, ClipboardCheck, Eye, Check, X, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  listarTodasLasOrdenesCompra,
  obtenerPermisosOrdenCompra,
  aprobarOrdenCompra,
  rechazarOrdenCompra,
  type OrdenCompraListado,
  type OrdenCompraEstado,
  type PermisosOrdenCompra,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

const ESTADO_BADGE: Record<
  OrdenCompraEstado,
  { label: string; variant: "default" | "destructive" | "secondary" }
> = {
  pendiente_aprobacion: { label: "Pendiente", variant: "secondary" },
  aprobada: { label: "Aprobada", variant: "default" },
  rechazada: { label: "Rechazada", variant: "destructive" },
  cancelada: { label: "Cancelada", variant: "destructive" },
}

const FILTROS_ESTADO: { valor: OrdenCompraEstado | "todas"; etiqueta: string }[] = [
  { valor: "todas", etiqueta: "Todas" },
  { valor: "pendiente_aprobacion", etiqueta: "Pendientes" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: "cancelada", etiqueta: "Canceladas" },
]

function Tile({ etiqueta, valor, color }: { etiqueta: string; valor: number; color?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
      <p className={`mt-1 text-3xl font-semibold ${color ?? ""}`}>{valor}</p>
    </div>
  )
}

export function AprobarOCView() {
  const [ordenes, setOrdenes] = useState<OrdenCompraListado[] | null>(null)
  const [ordenAbiertaId, setOrdenAbiertaId] = useState<string | null>(null)
  const [permisos, setPermisos] = useState<PermisosOrdenCompra | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<OrdenCompraEstado | "todas">("todas")
  const [procesandoId, setProcesandoId] = useState<string | null>(null)
  const [rechazandoId, setRechazandoId] = useState<string | null>(null)
  const [motivoRechazo, setMotivoRechazo] = useState("")

  function cargar() {
    setCargando(true)
    setError(null)
    Promise.all([listarTodasLasOrdenesCompra(), obtenerPermisosOrdenCompra()])
      .then(([o, p]) => {
        setOrdenes(o)
        setPermisos(p)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las órdenes."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    cargar()
  }, [])

  const conteos = useMemo(() => {
    const base = { total: 0, pendiente_aprobacion: 0, aprobada: 0, rechazada: 0, cancelada: 0 }
    if (!ordenes) return base
    base.total = ordenes.length
    for (const o of ordenes) base[o.estado] += 1
    return base
  }, [ordenes])

  const ordenesFiltradas = useMemo(() => {
    if (!ordenes) return []
    if (filtroEstado === "todas") return ordenes
    return ordenes.filter((o) => o.estado === filtroEstado)
  }, [ordenes, filtroEstado])

  async function handleAprobar(id: string) {
    setProcesandoId(id)
    setError(null)
    try {
      await aprobarOrdenCompra(id)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar la orden.")
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Órdenes de compra</h1>
          {conteos.pendiente_aprobacion > 0 && (
            <Badge className="rounded-full px-2.5">{conteos.pendiente_aprobacion}</Badge>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
          <RefreshCw className={`mr-2 h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile etiqueta="Total" valor={conteos.total} />
        <Tile etiqueta="Pendientes" valor={conteos.pendiente_aprobacion} color="text-amber-600" />
        <Tile etiqueta="Aprobadas" valor={conteos.aprobada} color="text-emerald-600" />
        <Tile etiqueta="Rechazadas" valor={conteos.rechazada} color="text-red-600" />
      </div>

      <div className="flex gap-2">
        {FILTROS_ESTADO.map((f) => (
          <Button
            key={f.valor}
            size="sm"
            variant={filtroEstado === f.valor ? "default" : "outline"}
            className="rounded-full"
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
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <ClipboardCheck className="h-8 w-8" />
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
                <TableHead>Creada por</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenesFiltradas.map((orden) => {
                const badge = ESTADO_BADGE[orden.estado]
                const puedeGestionar = permisos?.esAdmin && orden.estado === "pendiente_aprobacion"
                const procesando = procesandoId === orden.id
                return (
                  <TableRow
                    key={orden.id}
                    className={orden.tieneSobrecostoPrecio ? "bg-destructive/10 hover:bg-destructive/15" : undefined}
                  >
                    <TableCell>{orden.numero}</TableCell>
                    <TableCell>{orden.proyectoCodigo ?? orden.proyectoNombre ?? "—"}</TableCell>
                    <TableCell>{orden.proveedorNombre}</TableCell>
                    <TableCell>{orden.creadaPorNombre ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatoFecha(orden.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {orden.enviada && <Badge variant="outline">Enviada</Badge>}
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
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setOrdenAbiertaId(orden.id)}>
                          <Eye className="mr-1.5 h-4 w-4" />
                          Ver
                        </Button>
                        {puedeGestionar && (
                          <>
                            <Button
                              size="icon"
                              variant="outline"
                              className="border-emerald-300 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                              disabled={procesando}
                              onClick={() => handleAprobar(orden.id)}
                              aria-label={`Aprobar orden ${orden.numero}`}
                            >
                              {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
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
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

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
            automáticamente a la cola de "Comprar pedidos".
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
        open={ordenAbiertaId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOrdenAbiertaId(null)
            cargar()
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
                cargar()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}