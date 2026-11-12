"use client"

import { formatearFechaHora } from "@/lib/fechas"
import { rutaNotificacion } from "@/lib/notificaciones-rutas"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, X } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  borrarNotificacion,
  borrarNotificacionesLeidas,
  listarNotificaciones,
  marcarNotificacionLeida,
  marcarTodasNotificacionesLeidas,
  type Notificacion,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

// Fecha y hora en la de Colombia: "06/11/2026, 3:45 p. m." (lib/fechas).
const formatoFecha = (iso: string) => formatearFechaHora(iso)

// La ruta de cada aviso vive en lib/notificaciones-rutas (también la usa el
// enlace de los correos, /notificaciones/<id>).
const rutaDestino = (n: Notificacion) => rutaNotificacion(n)

// Sin realtime: se recarga la lista cada minuto y cada vez que se abre la
// campanita, así una notificación nueva aparece sin recargar la página.
export function CampanitaNotificaciones() {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [notificaciones, setNotificaciones] = useState<Notificacion[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  // Solo con la pestaña a la vista: cada recarga es un viaje al servidor (y
  // pasa por el middleware), y una pestaña olvidada en segundo plano la
  // repetía cada minuto todo el día. Al volver a la pestaña se recarga ya.
  useEffect(() => {
    cargar()
    const t = setInterval(() => {
      if (document.visibilityState === "visible") cargar()
    }, 60_000)
    function alVolver() {
      if (document.visibilityState === "visible") cargar()
    }
    document.addEventListener("visibilitychange", alVolver)
    return () => {
      clearInterval(t)
      document.removeEventListener("visibilitychange", alVolver)
    }
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

  // No leídas arriba y leídas al final (la base ya las manda así; esto lo
  // mantiene al marcar una como leída sin recargar). Orden estable: O(n log n).
  const ordenadas = notificaciones ? [...notificaciones].sort((a, b) => Number(a.leida) - Number(b.leida)) : null
  const noLeidas = notificaciones?.filter((n) => !n.leida).length ?? 0
  const leidas = (notificaciones?.length ?? 0) - noLeidas

  function handleBorrar(id: string) {
    setNotificaciones((prev) => prev?.filter((x) => x.id !== id) ?? prev)
    void borrarNotificacion(id).catch((e) => {
      setError(e instanceof Error ? e.message : "No se pudo borrar la notificación.")
      cargar()
    })
  }

  function handleMarcarTodas() {
    setNotificaciones((prev) => prev?.map((x) => (x.leida ? x : { ...x, leida: true })) ?? prev)
    void marcarTodasNotificacionesLeidas().catch((e) => {
      setError(e instanceof Error ? e.message : "No se pudieron marcar las notificaciones.")
      cargar()
    })
  }

  function handleBorrarLeidas() {
    setNotificaciones((prev) => prev?.filter((x) => !x.leida) ?? prev)
    void borrarNotificacionesLeidas().catch((e) => {
      setError(e instanceof Error ? e.message : "No se pudieron borrar las notificaciones.")
      cargar()
    })
  }

  // Popover de Base UI: el panel va en un portal sobre toda la página (dentro
  // del menú lateral quedaba recortado y tapado por el contenido), se ubica
  // solo para no salirse de la pantalla y se cierra con clic afuera o Escape.
  return (
    <Popover
      open={abierto}
      onOpenChange={(v) => {
        if (v) cargar()
        setAbierto(v)
      }}
    >
      <PopoverTrigger
        aria-label={noLeidas > 0 ? `Notificaciones, ${noLeidas} sin leer` : "Notificaciones"}
        className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      >
        <Bell className="size-4" />
        {noLeidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
            {noLeidas > 9 ? "9+" : noLeidas}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent side="bottom" align="end" className="w-80 max-w-[calc(100vw-1rem)] gap-0 rounded-md p-1 shadow-lg">
        <div className="flex items-center justify-between gap-2 px-2 pt-1.5 pb-1">
          <p className="text-xs font-semibold text-muted-foreground">Notificaciones</p>
          <div className="flex-1" />
          {noLeidas > 0 && (
            <button
              type="button"
              onClick={handleMarcarTodas}
              className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Marcar todas como leídas
            </button>
          )}
          {leidas > 0 && (
            <button
              type="button"
              onClick={handleBorrarLeidas}
              className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Borrar las leídas ({leidas})
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-auto">
          {error && <div className="px-2 py-3 text-sm text-destructive">{error}</div>}
          {!error && notificaciones === null && <div className="px-2 py-3 text-sm text-muted-foreground">Cargando...</div>}
          {!error && notificaciones?.length === 0 && (
            <div className="px-2 py-3 text-sm text-muted-foreground">No tienes notificaciones.</div>
          )}
          {ordenadas?.map((n) => (
            <div
              key={n.id}
              className={`group relative rounded-sm hover:bg-accent ${!n.leida ? "bg-accent/40" : ""}`}
            >
              <button
                type="button"
                onClick={() => handleClicNotificacion(n)}
                className="flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-2 pr-8 text-left text-sm"
              >
                <div className="flex w-full items-center gap-1.5">
                  {!n.leida && <span className="size-1.5 shrink-0 rounded-full bg-destructive" />}
                  <span className={`truncate ${!n.leida ? "font-medium" : "text-muted-foreground"}`}>{n.titulo}</span>
                </div>
                <span className="line-clamp-2 text-xs text-muted-foreground">{n.mensaje}</span>
                <span className="text-[10px] text-muted-foreground">{formatoFecha(n.createdAt)}</span>
              </button>
              <button
                type="button"
                onClick={() => handleBorrar(n.id)}
                aria-label={`Borrar la notificación ${n.titulo}`}
                title="Borrar"
                className="absolute right-1 top-1.5 flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
