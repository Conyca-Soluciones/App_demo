// "use client"

// import { useEffect, useState } from "react"
// import { useRouter } from "next/navigation"
// import { Loader2 } from "lucide-react"
// import { Badge } from "@/components/ui/badge"
// import { Button } from "@/components/ui/button"
// import {
//   Table,
//   TableBody,
//   TableCell,
//   TableFooter,
//   TableHead,
//   TableHeader,
//   TableRow,
// } from "@/components/ui/table"
// import {
//   Dialog,
//   DialogContent,
//   DialogFooter,
//   DialogHeader,
//   DialogTitle,
// } from "@/components/ui/dialog"
// import { Textarea } from "@/components/ui/textarea"
// import { calcularLinea, calcularTotalesOrden } from "@/lib/ordenes-compra-calculos"
// import {
//   obtenerOrdenCompraDetalle,
//   obtenerPermisosOrdenCompra,
//   aprobarOrdenCompra,
//   rechazarOrdenCompra,
//   marcarOrdenEnviada,
//   type OrdenCompraDetalle,
//   type PermisosOrdenCompra,
// } from "@/app/(app)/almacen/comprar-pedidos/actions"

// const formatoFecha = (iso: string) =>
//   new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

// const formatoMoneda = new Intl.NumberFormat("es-CO", {
//   style: "currency",
//   currency: "COP",
//   maximumFractionDigits: 0,
// })

// const ESTADO_BADGE: Record<
//   OrdenCompraDetalle["estado"],
//   { label: string; variant: "default" | "destructive" | "secondary" }
// > = {
//   pendiente_aprobacion: { label: "Pendiente de aprobación", variant: "secondary" },
//   aprobada: { label: "Aprobada", variant: "default" },
//   rechazada: { label: "Rechazada", variant: "destructive" },
// }

// type OrdenCompraDetalleViewProps = { ordenId: string }

// export function OrdenCompraDetalleView({ ordenId }: OrdenCompraDetalleViewProps) {
//   const router = useRouter()
//   const [orden, setOrden] = useState<OrdenCompraDetalle | null>(null)
//   const [permisos, setPermisos] = useState<PermisosOrdenCompra | null>(null)
//   const [error, setError] = useState<string | null>(null)
//   const [procesando, setProcesando] = useState(false)
//   const [rechazando, setRechazando] = useState(false)
//   const [motivoRechazo, setMotivoRechazo] = useState("")

//   function cargar() {
//     setError(null)
//     Promise.all([obtenerOrdenCompraDetalle(ordenId), obtenerPermisosOrdenCompra()])
//       .then(([o, p]) => {
//         setOrden(o)
//         setPermisos(p)
//       })
//       .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la orden."))
//   }

//   useEffect(() => {
//     cargar()
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [ordenId])

//   async function handleAprobar() {
//     setProcesando(true)
//     setError(null)
//     try {
//       await aprobarOrdenCompra(ordenId)
//       cargar()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo aprobar la orden.")
//     } finally {
//       setProcesando(false)
//     }
//   }

//   async function confirmarRechazo() {
//     if (!motivoRechazo.trim()) return
//     setProcesando(true)
//     setError(null)
//     try {
//       await rechazarOrdenCompra(ordenId, motivoRechazo.trim())
//       setRechazando(false)
//       setMotivoRechazo("")
//       cargar()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo rechazar la orden.")
//     } finally {
//       setProcesando(false)
//     }
//   }

//   async function handleMarcarEnviada() {
//     setProcesando(true)
//     setError(null)
//     try {
//       await marcarOrdenEnviada(ordenId)
//       cargar()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo marcar como enviada.")
//     } finally {
//       setProcesando(false)
//     }
//   }

//   if (!orden || !permisos) {
//     return (
//       <div className="flex h-full items-center justify-center text-muted-foreground">
//         {error ? (
//           <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
//             {error}
//           </div>
//         ) : (
//           <>
//             <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando orden...
//           </>
//         )}
//       </div>
//     )
//   }

//   const badge = ESTADO_BADGE[orden.estado]
//   const puedeAprobarORechazar = permisos.esAdmin && orden.estado === "pendiente_aprobacion"
//   const puedeMarcarEnviada = permisos.rolCompras && orden.estado === "aprobada" && !orden.enviada
//   // Misma fórmula que usan orden-compra-pdf.tsx y generar-oc-view.tsx, para
//   // que el total mostrado acá, en el PDF y en la pantalla de creación sean
//   // siempre el mismo número.
//   const totales = calcularTotalesOrden(orden.lineas)
//   const totalOrden = totales.total

//   return (
//     <div className="flex h-full min-h-0 flex-col gap-4">
//       <div className="flex items-center justify-between">
//         <div className="flex items-center gap-3">
//           <h1 className="text-2xl font-semibold">Orden de Compra #{orden.numero}</h1>
//           <Badge variant={badge.variant}>{badge.label}</Badge>
//           {orden.enviada && <Badge variant="outline">Enviada</Badge>}

//           {orden.estado === "aprobada" && (
//           <a href={`/almacen/ordenes-compra/${orden.id}/pdf`} target="_blank" rel="noreferrer">
//             <Button variant="outline">Descargar PDF</Button>
//           </a>
//         )}
//         </div>
//         <Button variant="outline" onClick={() => router.push("/almacen/comprar-pedidos")}>
//           Volver
//         </Button>
//       </div>

//       {error && (
//         <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
//           {error}
//         </div>
//       )}

//       {orden.estado === "rechazada" && orden.motivoRechazo && (
//         <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
//           <strong>Motivo del rechazo:</strong> {orden.motivoRechazo}
//         </div>
//       )}

//       <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto lg:grid-cols-[2fr_1fr]">
//         <div className="min-h-0 overflow-auto rounded-lg border">
//           <Table>
//             <TableHeader>
//               <TableRow>
//                 <TableHead>Cod</TableHead>
//                 <TableHead>Insumo</TableHead>
//                 <TableHead>UM</TableHead>
//                 <TableHead className="text-right">Cantidad</TableHead>
//                 <TableHead className="text-right">Precio unit.</TableHead>
//                 <TableHead className="text-right">Total</TableHead>
//               </TableRow>
//             </TableHeader>
//             <TableBody>
//               {orden.lineas.map((linea) => {
//                 const c = calcularLinea(linea)
//                 return (
//                   <TableRow key={linea.id}>
//                     <TableCell className="text-muted-foreground">{linea.insumoCodigo}</TableCell>
//                     <TableCell>{linea.insumoDescripcion}</TableCell>
//                     <TableCell>{linea.um ?? "—"}</TableCell>
//                     <TableCell className="text-right">{linea.cantidad.toLocaleString("es-CO")}</TableCell>
//                     <TableCell className="text-right">{formatoMoneda.format(linea.precioUnitario)}</TableCell>
//                     <TableCell className="text-right font-medium">{formatoMoneda.format(c.total)}</TableCell>
//                   </TableRow>
//                 )
//               })}
//             </TableBody>
//             <TableFooter>
//               <TableRow>
//                 <TableCell colSpan={4} className="text-right text-muted-foreground">
//                   Subtotal
//                 </TableCell>
//                 <TableCell colSpan={2} className="text-right text-muted-foreground">
//                   {formatoMoneda.format(orden.lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0))}
//                 </TableCell>
//               </TableRow>
//               <TableRow>
//                 <TableCell colSpan={4} className="text-right text-muted-foreground">
//                   Descuento
//                 </TableCell>
//                 <TableCell colSpan={2} className="text-right text-muted-foreground">
//                   −{formatoMoneda.format(totales.descuento)}
//                 </TableCell>
//               </TableRow>
//               <TableRow>
//                 <TableCell colSpan={4} className="text-right text-muted-foreground">
//                   IVA
//                 </TableCell>
//                 <TableCell colSpan={2} className="text-right text-muted-foreground">
//                   {formatoMoneda.format(totales.iva)}
//                 </TableCell>
//               </TableRow>
//               <TableRow>
//                 <TableCell colSpan={4} className="text-right font-medium">
//                   Total orden
//                 </TableCell>
//                 <TableCell colSpan={2} className="text-right font-semibold">
//                   {formatoMoneda.format(totalOrden)}
//                 </TableCell>
//               </TableRow>
//             </TableFooter>
//           </Table>
//         </div>

//         <div className="space-y-4 overflow-auto rounded-lg border bg-card p-4 text-sm">
//           <div className="space-y-1">
//             <p className="text-muted-foreground">Proyecto</p>
//             <p>
//               {orden.proyectoCodigo ?? "—"} {orden.proyectoNombre ? `· ${orden.proyectoNombre}` : ""}
//             </p>
//           </div>
//           <div className="space-y-1">
//             <p className="text-muted-foreground">Proveedor</p>
//             <p>{orden.proveedorNombre}</p>
//           </div>
//           <div className="space-y-1">
//             <p className="text-muted-foreground">Sitio de entrega</p>
//             <p>{orden.sitioEntrega ?? "—"}</p>
//           </div>
//           <div className="space-y-1">
//             <p className="text-muted-foreground">Fecha de entrega</p>
//             <p>{orden.fechaEntrega ? formatoFecha(orden.fechaEntrega) : "—"}</p>
//           </div>
//           <div className="space-y-1">
//             <p className="text-muted-foreground">Contacto</p>
//             <p>{orden.contactoNombre ?? "—"}</p>
//             <p className="text-xs text-muted-foreground">
//               {orden.telefono ?? "—"} · {orden.email ?? "—"}
//             </p>
//           </div>
//           <div className="space-y-1 border-t pt-3">
//             <p className="text-muted-foreground">Total de la orden</p>
//             {totales.descuento > 0 && (
//               <p className="text-xs text-muted-foreground">Descuento: −{formatoMoneda.format(totales.descuento)}</p>
//             )}
//             {totales.iva > 0 && (
//               <p className="text-xs text-muted-foreground">IVA: {formatoMoneda.format(totales.iva)}</p>
//             )}
//             <p className="text-lg font-semibold">{formatoMoneda.format(totalOrden)}</p>
//           </div>
//           <div className="space-y-1 border-t pt-3">
//             <p className="text-muted-foreground">Creada por</p>
//             <p>
//               {orden.creadaPorNombre ?? "—"} — {formatoFecha(orden.createdAt)}
//             </p>
//           </div>
//           {orden.aprobadaPorNombre && (
//             <div className="space-y-1">
//               <p className="text-muted-foreground">
//                 {orden.estado === "rechazada" ? "Rechazada por" : "Aprobada por"}
//               </p>
//               <p>
//                 {orden.aprobadaPorNombre}
//                 {orden.aprobadaAt ? ` — ${formatoFecha(orden.aprobadaAt)}` : ""}
//               </p>
//             </div>
//           )}

//           {(puedeAprobarORechazar || puedeMarcarEnviada) && (
//             <div className="space-y-2 border-t pt-3">
//               {puedeAprobarORechazar && (
//                 <>
//                   <Button className="w-full" disabled={procesando} onClick={handleAprobar}>
//                     Aprobar orden
//                   </Button>
//                   <Button
//                     className="w-full"
//                     variant="destructive"
//                     disabled={procesando}
//                     onClick={() => setRechazando(true)}
//                   >
//                     Rechazar orden
//                   </Button>
//                 </>
//               )}
//               {puedeMarcarEnviada && (
//                 <Button className="w-full" disabled={procesando} onClick={handleMarcarEnviada}>
//                   Marcar como enviada
//                 </Button>
//               )}
//             </div>
//           )}
//         </div>
//       </div>

//       <Dialog
//         open={rechazando}
//         onOpenChange={(open) => {
//           if (!open) {
//             setRechazando(false)
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
//             <Button variant="outline" onClick={() => setRechazando(false)}>
//               Cancelar
//             </Button>
//             <Button
//               variant="destructive"
//               disabled={!motivoRechazo.trim() || procesando}
//               onClick={confirmarRechazo}
//             >
//               {procesando ? "Rechazando..." : "Rechazar orden"}
//             </Button>
//           </DialogFooter>
//         </DialogContent>
//       </Dialog>
//     </div>
//   )
// }

"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { calcularLinea, calcularTotalesOrden } from "@/lib/ordenes-compra-calculos"
import {
  obtenerOrdenCompraDetalle,
  obtenerPermisosOrdenCompra,
  aprobarOrdenCompra,
  rechazarOrdenCompra,
  marcarOrdenEnviada,
  type OrdenCompraDetalle,
  type PermisosOrdenCompra,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

const formatoMoneda = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})

const ESTADO_BADGE: Record<
  OrdenCompraDetalle["estado"],
  { label: string; variant: "default" | "destructive" | "secondary" }
> = {
  pendiente_aprobacion: { label: "Pendiente de aprobación", variant: "secondary" },
  aprobada: { label: "Aprobada", variant: "default" },
  rechazada: { label: "Rechazada", variant: "destructive" },
}

// onCerrar es opcional: si se pasa (uso dentro de un Dialog), el botón de
// arriba cierra el diálogo en vez de navegar -- la página standalone
// (/almacen/ordenes-compra/[id]) sigue funcionando igual, sin pasarlo.
type OrdenCompraDetalleViewProps = { ordenId: string; onCerrar?: () => void }

export function OrdenCompraDetalleView({ ordenId, onCerrar }: OrdenCompraDetalleViewProps) {
  const router = useRouter()
  const [orden, setOrden] = useState<OrdenCompraDetalle | null>(null)
  const [permisos, setPermisos] = useState<PermisosOrdenCompra | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [rechazando, setRechazando] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState("")

  function cargar() {
    setError(null)
    Promise.all([obtenerOrdenCompraDetalle(ordenId), obtenerPermisosOrdenCompra()])
      .then(([o, p]) => {
        setOrden(o)
        setPermisos(p)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la orden."))
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenId])

  async function handleAprobar() {
    setProcesando(true)
    setError(null)
    try {
      await aprobarOrdenCompra(ordenId)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar la orden.")
    } finally {
      setProcesando(false)
    }
  }

  async function confirmarRechazo() {
    if (!motivoRechazo.trim()) return
    setProcesando(true)
    setError(null)
    try {
      await rechazarOrdenCompra(ordenId, motivoRechazo.trim())
      setRechazando(false)
      setMotivoRechazo("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar la orden.")
    } finally {
      setProcesando(false)
    }
  }

  async function handleMarcarEnviada() {
    setProcesando(true)
    setError(null)
    try {
      await marcarOrdenEnviada(ordenId)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo marcar como enviada.")
    } finally {
      setProcesando(false)
    }
  }

  if (!orden || !permisos) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando orden...
          </>
        )}
      </div>
    )
  }

  const badge = ESTADO_BADGE[orden.estado]
  const puedeAprobarORechazar = permisos.esAdmin && orden.estado === "pendiente_aprobacion"
  const puedeMarcarEnviada = permisos.rolCompras && orden.estado === "aprobada" && !orden.enviada
  // Misma fórmula que usan orden-compra-pdf.tsx y generar-oc-view.tsx, para
  // que el total mostrado acá, en el PDF y en la pantalla de creación sean
  // siempre el mismo número.
  const totales = calcularTotalesOrden(orden.lineas)
  const totalOrden = totales.total

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Orden de Compra #{orden.numero}</h1>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {orden.enviada && <Badge variant="outline">Enviada</Badge>}

          {orden.estado === "aprobada" && (
          <a href={`/almacen/ordenes-compra/${orden.id}/pdf`} target="_blank" rel="noreferrer">
            <Button variant="outline">Descargar PDF</Button>
          </a>
        )}
        </div>
        <Button variant="outline" onClick={onCerrar ?? (() => router.push("/almacen/comprar-pedidos"))}>
          {onCerrar ? "Cerrar" : "Volver"}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {orden.estado === "rechazada" && orden.motivoRechazo && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <strong>Motivo del rechazo:</strong> {orden.motivoRechazo}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto lg:grid-cols-[2fr_1fr]">
        <div className="min-h-0 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cod</TableHead>
                <TableHead>Insumo</TableHead>
                <TableHead>UM</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio unit.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orden.lineas.map((linea) => {
                const c = calcularLinea(linea)
                return (
                  <TableRow key={linea.id}>
                    <TableCell className="text-muted-foreground">{linea.insumoCodigo}</TableCell>
                    <TableCell>{linea.insumoDescripcion}</TableCell>
                    <TableCell>{linea.um ?? "—"}</TableCell>
                    <TableCell className="text-right">{linea.cantidad.toLocaleString("es-CO")}</TableCell>
                    <TableCell className="text-right">{formatoMoneda.format(linea.precioUnitario)}</TableCell>
                    <TableCell className="text-right font-medium">{formatoMoneda.format(c.total)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="text-right text-muted-foreground">
                  Subtotal
                </TableCell>
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  {formatoMoneda.format(orden.lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0))}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={4} className="text-right text-muted-foreground">
                  Descuento
                </TableCell>
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  −{formatoMoneda.format(totales.descuento)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={4} className="text-right text-muted-foreground">
                  IVA
                </TableCell>
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  {formatoMoneda.format(totales.iva)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={4} className="text-right font-medium">
                  Total orden
                </TableCell>
                <TableCell colSpan={2} className="text-right font-semibold">
                  {formatoMoneda.format(totalOrden)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        <div className="space-y-4 overflow-auto rounded-lg border bg-card p-4 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">Proyecto</p>
            <p>
              {orden.proyectoCodigo ?? "—"} {orden.proyectoNombre ? `· ${orden.proyectoNombre}` : ""}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Proveedor</p>
            <p>{orden.proveedorNombre}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Sitio de entrega</p>
            <p>{orden.sitioEntrega ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Fecha de entrega</p>
            <p>{orden.fechaEntrega ? formatoFecha(orden.fechaEntrega) : "—"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Contacto</p>
            <p>{orden.contactoNombre ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {orden.telefono ?? "—"} · {orden.email ?? "—"}
            </p>
          </div>
          <div className="space-y-1 border-t pt-3">
            <p className="text-muted-foreground">Total de la orden</p>
            {totales.descuento > 0 && (
              <p className="text-xs text-muted-foreground">Descuento: −{formatoMoneda.format(totales.descuento)}</p>
            )}
            {totales.iva > 0 && (
              <p className="text-xs text-muted-foreground">IVA: {formatoMoneda.format(totales.iva)}</p>
            )}
            <p className="text-lg font-semibold">{formatoMoneda.format(totalOrden)}</p>
          </div>
          <div className="space-y-1 border-t pt-3">
            <p className="text-muted-foreground">Creada por</p>
            <p>
              {orden.creadaPorNombre ?? "—"} — {formatoFecha(orden.createdAt)}
            </p>
          </div>
          {orden.aprobadaPorNombre && (
            <div className="space-y-1">
              <p className="text-muted-foreground">
                {orden.estado === "rechazada" ? "Rechazada por" : "Aprobada por"}
              </p>
              <p>
                {orden.aprobadaPorNombre}
                {orden.aprobadaAt ? ` — ${formatoFecha(orden.aprobadaAt)}` : ""}
              </p>
            </div>
          )}

          {(puedeAprobarORechazar || puedeMarcarEnviada) && (
            <div className="space-y-2 border-t pt-3">
              {puedeAprobarORechazar && (
                <>
                  <Button className="w-full" disabled={procesando} onClick={handleAprobar}>
                    Aprobar orden
                  </Button>
                  <Button
                    className="w-full"
                    variant="destructive"
                    disabled={procesando}
                    onClick={() => setRechazando(true)}
                  >
                    Rechazar orden
                  </Button>
                </>
              )}
              {puedeMarcarEnviada && (
                <Button className="w-full" disabled={procesando} onClick={handleMarcarEnviada}>
                  Marcar como enviada
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={rechazando}
        onOpenChange={(open) => {
          if (!open) {
            setRechazando(false)
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
            <Button variant="outline" onClick={() => setRechazando(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!motivoRechazo.trim() || procesando}
              onClick={confirmarRechazo}
            >
              {procesando ? "Rechazando..." : "Rechazar orden"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}