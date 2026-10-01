"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell } from "lucide-react"
import {
  listarNotificaciones,
  marcarNotificacionLeida,
  type Notificacion,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

const formatoFecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" })

// A dónde navega cada tipo de notificación al hacer click: las órdenes de
// compra a su detalle, y las requisiciones al registro de requisiciones.
function rutaDestino(n: Notificacion): string {
  if (n.entidadTipo === "orden_compra") return `/almacen/ordenes-compra/${n.entidadId}`
  return "/almacen/registro-requisiciones"
}

// Sin realtime: se recarga la lista cada minuto y cada vez que se abre la
// campanita, así una notificación nueva aparece sin recargar la página.
export function CampanitaNotificaciones() {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [notificaciones, setNotificaciones] = useState<Notificacion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const contenedorRef = useRef<HTMLDivElement>(null)

  function cargar() {
    listarNotificaciones()
      .then((lista) => {
        setNotificaciones(lista)
        setError(null)
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudieron cargar las notificaciones.")
      )
  }

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    function alHacerClicAfuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener("mousedown", alHacerClicAfuera)
    return () => document.removeEventListener("mousedown", alHacerClicAfuera)
  }, [])

  function handleClicNotificacion(n: Notificacion) {
    setAbierto(false)
    if (!n.leida) {
      // Optimista: actualiza el badge de inmediato. Si el marcado falla en
      // el servidor, no revertimos ni bloqueamos la navegación -- el
      // próximo refresh de la lista lo corrige solo.
      setNotificaciones((prev) => prev?.map((x) => (x.id === n.id ? { ...x, leida: true } : x)) ?? prev)
      void marcarNotificacionLeida(n.id).catch(() => {})
    }
    router.push(rutaDestino(n))
  }

  const noLeidas = notificaciones?.filter((n) => !n.leida).length ?? 0

  return (
    <div ref={contenedorRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!abierto) cargar()
          setAbierto((v) => !v)
        }}
        aria-label={noLeidas > 0 ? `Notificaciones, ${noLeidas} sin leer` : "Notificaciones"}
        className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      >
        <Bell className="size-4" />
        {noLeidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
            {noLeidas > 9 ? "9+" : noLeidas}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="max-h-96 overflow-auto">
            {error && <div className="px-2 py-3 text-sm text-destructive">{error}</div>}
            {!error && notificaciones === null && (
              <div className="px-2 py-3 text-sm text-muted-foreground">Cargando...</div>
            )}
            {!error && notificaciones?.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground">No tienes notificaciones.</div>
            )}
            {notificaciones?.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClicNotificacion(n)}
                className={`flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent ${
                  !n.leida ? "bg-accent/40" : ""
                }`}
              >
                <div className="flex w-full items-center gap-1.5">
                  {!n.leida && <span className="size-1.5 shrink-0 rounded-full bg-destructive" />}
                  <span className="truncate font-medium">{n.titulo}</span>
                </div>
                <span className="line-clamp-2 text-xs text-muted-foreground">{n.mensaje}</span>
                <span className="text-[10px] text-muted-foreground">{formatoFecha(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}