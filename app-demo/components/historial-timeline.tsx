"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  obtenerHistorial,
  type EventoHistorial,
  type TipoHistorial,
} from "@/app/(app)/almacen/historial/actions"

// Cómo se muestra cada evento. El color del punto indica el "tono":
// verde = aprobado, rojo = rechazado/cancelado, ámbar = desaprobado.
const EVENTOS: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  // órdenes de compra
  creada: { etiqueta: "Orden solicitada", tono: "neutro" },
  aprobada: { etiqueta: "Orden aprobada", tono: "ok" },
  rechazada: { etiqueta: "Orden rechazada", tono: "malo" },
  desaprobada: { etiqueta: "Orden desaprobada", tono: "aviso" },
  cancelada: { etiqueta: "Orden cancelada", tono: "malo" },
  marcada_enviada: { etiqueta: "Marcada como enviada al proveedor", tono: "neutro" },
  entrega_actualizada: { etiqueta: "Estado de entrega", tono: "neutro" },
  // requisiciones
  creado: { etiqueta: "Requisición solicitada", tono: "neutro" },
  modificado: { etiqueta: "Requisición modificada", tono: "aviso" },
  aprobado: { etiqueta: "Requisición aprobada", tono: "ok" },
  rechazado: { etiqueta: "Requisición rechazada", tono: "malo" },
  desaprobado: { etiqueta: "Requisición desaprobada", tono: "aviso" },
  cancelado: { etiqueta: "Requisición cancelada", tono: "malo" },
  rechazado_por_compras: { etiqueta: "Rechazado por Compras", tono: "malo" },
  estado_cambiado: { etiqueta: "Cambio de estado", tono: "neutro" },
}

// Eventos de una REQUISICIÓN (agrupada). Mismas claves que las órdenes de compra
// (creada, aprobada...) pero con su propio texto.
const EVENTOS_REQUISICION: Record<string, { etiqueta: string; tono: "ok" | "malo" | "aviso" | "neutro" }> = {
  creada: { etiqueta: "Requisición solicitada", tono: "neutro" },
  modificada: { etiqueta: "Requisición modificada", tono: "aviso" },
  aprobada: { etiqueta: "Requisición aprobada", tono: "ok" },
  rechazada: { etiqueta: "Requisición rechazada", tono: "malo" },
  desaprobada: { etiqueta: "Requisición desaprobada", tono: "aviso" },
  cancelada: { etiqueta: "Requisición cancelada", tono: "malo" },
  rechazado_por_compras: { etiqueta: "Insumo rechazado por Compras", tono: "malo" },
}

const COLOR_PUNTO = {
  ok: "bg-emerald-500",
  malo: "bg-red-500",
  aviso: "bg-amber-500",
  neutro: "bg-slate-400",
}

const ETIQUETA_ENTREGA: Record<string, string> = {
  sin_entregar: "Sin entregar",
  entrega_parcial: "Entrega parcial",
  entregada: "Entregada",
}

const CAMPOS_PEDIDO: { clave: string; etiqueta: string }[] = [
  { clave: "cantidad", etiqueta: "Cantidad" },
  { clave: "fecha_requerida", etiqueta: "Fecha requerida" },
  { clave: "urgente", etiqueta: "Urgente" },
  { clave: "observaciones", etiqueta: "Observaciones" },
]

const formatoFechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

function formatoValor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "boolean") return v ? "Sí" : "No"
  return String(v)
}

// Detalle extra de algunos eventos (qué cambió en una modificación, etc.).
function detalleEvento(e: EventoHistorial, tipo: TipoHistorial): string[] {
  const d = e.datos ?? {}
  if (tipo === "requisicion") {
    if (e.evento === "creada" && d.insumos) return [`${d.insumos} ${d.insumos === 1 ? "insumo" : "insumos"}`]
    if (e.evento === "rechazado_por_compras" && d.insumo) return [String(d.insumo)]
    if (e.evento === "modificada") {
      const lineas: string[] = []
      for (const x of d.agregados ?? []) lineas.push(`Agregó: ${x.insumo} (${x.cantidad}) · ítem ${x.item}`)
      for (const x of d.quitados ?? []) lineas.push(`Quitó: ${x.insumo} (${x.cantidad}) · ítem ${x.item}`)
      for (const x of d.cambios ?? []) lineas.push(`${x.insumo} · ítem ${x.item}: cantidad ${x.de} → ${x.a}`)
      if (d.antes && d.despues) {
        for (const c of CAMPOS_PEDIDO.filter((c) => c.clave !== "cantidad")) {
          if (d.antes[c.clave] !== d.despues[c.clave]) {
            lineas.push(`${c.etiqueta}: ${formatoValor(d.antes[c.clave])} → ${formatoValor(d.despues[c.clave])}`)
          }
        }
      }
      return lineas
    }
    return []
  }
  if (e.evento === "modificado" && d.antes && d.despues) {
    return CAMPOS_PEDIDO.filter((c) => d.antes[c.clave] !== d.despues[c.clave]).map(
      (c) => `${c.etiqueta}: ${formatoValor(d.antes[c.clave])} → ${formatoValor(d.despues[c.clave])}`
    )
  }
  if (e.evento === "entrega_actualizada" && d.de && d.a) {
    return [`${ETIQUETA_ENTREGA[d.de] ?? d.de} → ${ETIQUETA_ENTREGA[d.a] ?? d.a}`]
  }
  return []
}

export function HistorialTimeline({ tipo, id }: { tipo: TipoHistorial; id: string }) {
  const [eventos, setEventos] = useState<EventoHistorial[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEventos(null)
    setError(null)
    obtenerHistorial(tipo, id)
      .then((e: EventoHistorial[]) => setEventos(e))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el historial."))
  }, [tipo, id])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (eventos === null) {
    return (
      <div className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando historial...
      </div>
    )
  }
  if (eventos.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay movimientos registrados.</p>
  }

  return (
    <ol className="space-y-3">
      {eventos.map((e) => {
        const def =
          (tipo === "requisicion" ? EVENTOS_REQUISICION[e.evento] : undefined) ??
          EVENTOS[e.evento] ?? { etiqueta: e.evento, tono: "neutro" as const }
        const detalle = detalleEvento(e, tipo)
        return (
          <li key={e.id} className="flex gap-3 text-sm">
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_PUNTO[def.tono]}`} />
            <div className="min-w-0">
              <p className="font-medium">{def.etiqueta}</p>
              <p className="text-xs text-muted-foreground">
                {e.usuarioNombre ?? "Usuario desconocido"} · {formatoFechaHora(e.createdAt)}
                {e.datos?.reconstruido && " · reconstruido de datos anteriores"}
              </p>
              {detalle.map((linea, i) => (
                <p key={i} className="text-xs">
                  {linea}
                </p>
              ))}
              {e.motivo && <p className="mt-0.5 text-xs">Motivo: {e.motivo}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function HistorialDialog({
  abierto,
  tipo,
  id,
  titulo,
  onCerrar,
}: {
  abierto: boolean
  tipo: TipoHistorial
  id: string | null
  titulo: string
  onCerrar: () => void
}) {
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {id && <HistorialTimeline tipo={tipo} id={id} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
