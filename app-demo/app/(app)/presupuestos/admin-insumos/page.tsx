"use client"

import { useEffect, useState } from "react"
import {
  listarSolicitudesInsumos,
  aprobarSolicitudInsumo,
  rechazarSolicitudInsumo,
  type SolicitudInsumo,
} from "@/app/(app)/presupuestos/actions"
import { CATEGORIAS_APU } from "@/app/(app)/presupuestos/categorias-apu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSearchParams, useRouter } from "next/navigation"

const TODOS_LOS_TIPOS = CATEGORIAS_APU.flatMap((c) => c.tipos as readonly string[])

const headClasses = "border-r bg-primary px-3 py-2.5 text-left text-xs font-medium text-primary-foreground last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

type Estado = "pendiente" | "aprobado" | "rechazado"

const FILTROS: { valor: Estado; etiqueta: string }[] = [
  { valor: "pendiente", etiqueta: "Pendientes" },
  { valor: "aprobado", etiqueta: "Aprobadas" },
  { valor: "rechazado", etiqueta: "Rechazadas" },
]

export default function AdminInsumosPage() {
  const [estadoFiltro, setEstadoFiltro] = useState<Estado>("pendiente")
  const [solicitudes, setSolicitudes] = useState<SolicitudInsumo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [idsEnProceso, setIdsEnProceso] = useState<Set<string>>(new Set())

    // dentro del componente:
  const searchParams = useSearchParams()
  const router = useRouter()
  const [mostrarNoAutorizado, setMostrarNoAutorizado] = useState(
    searchParams.get("error") === "no-autorizado"
  )

  function descartarAviso() {
    setMostrarNoAutorizado(false)
    // limpia el query param de la URL sin recargar la página
    router.replace("/presupuestos")
  }

  function cargar() {
    setCargando(true)
    setError(null)
    listarSolicitudesInsumos(estadoFiltro)
      .then(setSolicitudes)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las solicitudes."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estadoFiltro])

  function marcarProcesando(id: string, activo: boolean) {
    setIdsEnProceso((prev) => {
      const next = new Set(prev)
      if (activo) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleAprobar(solicitud: SolicitudInsumo, precio: number, tipo: string, uM: string) {
    marcarProcesando(solicitud.id, true)
    setError(null)
    try {
      await aprobarSolicitudInsumo({
        solicitudId: solicitud.id,
        vrUnitario: precio,
        tipo,
        uM: uM || null,
      })
      setSolicitudes((prev) => prev.filter((s) => s.id !== solicitud.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar la solicitud.")
    } finally {
      marcarProcesando(solicitud.id, false)
    }
  }

  // `motivo` ahora es OBLIGATORIO -- si se rechaza un insumo que vino de
  // un import, ese motivo es lo único que le explica al ingeniero, en la
  // tabla del presupuesto, por qué su ítem quedó en rojo. Sin motivo, el
  // rechazo no dice nada útil.
  async function handleRechazar(solicitud: SolicitudInsumo, motivo: string) {
    marcarProcesando(solicitud.id, true)
    setError(null)
    try {
      await rechazarSolicitudInsumo(solicitud.id, motivo)
      setSolicitudes((prev) => prev.filter((s) => s.id !== solicitud.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar la solicitud.")
    } finally {
      marcarProcesando(solicitud.id, false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Solicitudes de insumos</h1>
        <p className="text-sm text-muted-foreground">
          Insumos nuevos pedidos por ingenieros 
        </p>
      </div>

          {mostrarNoAutorizado && (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <span>No está autorizado para esta acción. Si crees que deberías tener acceso, contacta a tu administrador.</span>
        <button
          type="button"
          onClick={descartarAviso}
          className="shrink-0 text-xs underline underline-offset-2 hover:no-underline"
        >
          Cerrar
        </button>
      </div>
    )}

      {/* Filtro por estado -- pestañas simples, mismo patrón de "un solo
          estado a la vez" que ya usa admin-tecnico para pendientes,
          extendido acá a las tres posibilidades */}
      <div className="flex gap-1.5 border-b">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => setEstadoFiltro(f.valor)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              estadoFiltro === f.valor
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.etiqueta}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : solicitudes.length === 0 ? (
        <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          {estadoFiltro === "pendiente"
            ? "No hay solicitudes pendientes."
            : `No hay solicitudes ${FILTROS.find((f) => f.valor === estadoFiltro)?.etiqueta.toLowerCase()}.`}
        </p>
      ) : estadoFiltro === "pendiente" ? (
        <TablaPendientes
          solicitudes={solicitudes}
          idsEnProceso={idsEnProceso}
          onAprobar={handleAprobar}
          onRechazar={handleRechazar}
        />
      ) : (
        <TablaResueltas solicitudes={solicitudes} estado={estadoFiltro} />
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// Tabla de PENDIENTES -- con los campos editables (tipo/unidad/precio)
// antes de aprobar, igual que la versión anterior pero en formato tabla.
// ---------------------------------------------------------------------------

function TablaPendientes({
  solicitudes,
  idsEnProceso,
  onAprobar,
  onRechazar,
}: {
  solicitudes: SolicitudInsumo[]
  idsEnProceso: Set<string>
  onAprobar: (s: SolicitudInsumo, precio: number, tipo: string, uM: string) => void
  onRechazar: (s: SolicitudInsumo, motivo: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-none border">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={`${headClasses} w-64`}>Insumo</th>
            <th className={`${headClasses} w-40`}>Origen</th>
            <th className={`${headClasses} w-44`}>Tipo</th>
            <th className={`${headClasses} w-24`}>Unidad</th>
            <th className={`${headClasses} w-32 text-right`}>Precio real</th>
            <th className={`${headClasses} w-56 text-center`}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {solicitudes.map((s) => (
            <FilaPendiente
              key={s.id}
              solicitud={s}
              procesando={idsEnProceso.has(s.id)}
              onAprobar={onAprobar}
              onRechazar={onRechazar}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FilaPendiente({
  solicitud,
  procesando,
  onAprobar,
  onRechazar,
}: {
  solicitud: SolicitudInsumo
  procesando: boolean
  onAprobar: (s: SolicitudInsumo, precio: number, tipo: string, uM: string) => void
  onRechazar: (s: SolicitudInsumo, motivo: string) => void
}) {
  const [precio, setPrecio] = useState("")
  const [tipo, setTipo] = useState(solicitud.tipo ?? TODOS_LOS_TIPOS[0])
  const [uM, setUM] = useState(solicitud.uM ?? "")
  const [error, setError] = useState<string | null>(null)

  // Caja de observaciones para el rechazo -- se abre solo cuando le dan
  // "Rechazar" la primera vez, en vez de estar siempre visible ocupando
  // espacio. El motivo es OBLIGATORIO (ver nota en handleRechazar del
  // padre) -- sin él no se puede confirmar el rechazo.
  const [mostrandoRechazo, setMostrandoRechazo] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState("")

  function intentarAprobar() {
    const precioNum = Number(precio)
    if (!precio || precioNum <= 0) {
      setError("Ingresa un precio real.")
      return
    }
    if (!tipo) {
      setError("Elige un tipo.")
      return
    }
    setError(null)
    onAprobar(solicitud, precioNum, tipo, uM)
  }

  function confirmarRechazo() {
    if (!motivoRechazo.trim()) {
      setError("Escribe el motivo del rechazo -- el ingeniero lo va a ver en el presupuesto.")
      return
    }
    setError(null)
    onRechazar(solicitud, motivoRechazo.trim())
  }

  return (
    <tr className="border-b align-top hover:bg-muted/30">
      <td className={celda}>
        <p className="font-medium">{solicitud.descripcion}</p>
      </td>
      <td className={`${celda} text-muted-foreground`}>
        <p>{solicitud.solicitadoPorNombre ?? "alguien"}</p>
        <p>{new Date(solicitud.createdAt).toLocaleDateString("es-CO")}</p>
        {solicitud.proyectoNombre && (
          <p className="truncate">
            {solicitud.proyectoNombre}
            {solicitud.itemCodigo && ` — ${solicitud.itemCodigo}`}
          </p>
        )}
      </td>
      <td className={celda}>
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          disabled={mostrandoRechazo}
          className="h-8 w-full rounded-md border bg-background px-1.5 text-xs"
        >
          {TODOS_LOS_TIPOS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className={celda}>
        <Input
          value={uM}
          onChange={(e) => setUM(e.target.value)}
          disabled={mostrandoRechazo}
          className="h-8 text-xs"
        />
      </td>
      <td className={celda}>
        <Input
          type="number"
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          disabled={mostrandoRechazo}
          placeholder="$"
          className="h-8 text-right text-xs"
        />
      </td>
      <td className={`${celda} text-center`}>
        <div className="flex flex-col items-stretch gap-1.5">
          {!mostrandoRechazo ? (
            <div className="flex justify-center gap-1.5">
              <Button
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={intentarAprobar}
                disabled={procesando}
              >
                {procesando ? "…" : "Aprobar"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setError(null)
                  setMostrandoRechazo(true)
                }}
                disabled={procesando}
              >
                Rechazar
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5 text-left">
              <textarea
                autoFocus
                value={motivoRechazo}
                onChange={(e) => setMotivoRechazo(e.target.value)}
                placeholder="¿Por qué se rechaza? El ingeniero lo va a ver en el presupuesto."
                rows={2}
                className="w-full rounded-md border bg-background px-2 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex justify-center gap-1.5">
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 px-2 text-[11px]"
                  onClick={confirmarRechazo}
                  disabled={procesando}
                >
                  {procesando ? "…" : "Confirmar rechazo"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => {
                    setMostrandoRechazo(false)
                    setMotivoRechazo("")
                    setError(null)
                  }}
                  disabled={procesando}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
          {error && <p className="text-[10px] text-destructive">{error}</p>}
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Tabla de RESUELTAS (aprobadas/rechazadas) -- de solo lectura, con
// trazabilidad: quién resolvió, cuándo, y el código de insumo que quedó
// en el maestro (si fue aprobada) o el motivo (si fue rechazada).
// ---------------------------------------------------------------------------

function TablaResueltas({
  solicitudes,
  estado,
}: {
  solicitudes: SolicitudInsumo[]
  estado: "aprobado" | "rechazado"
}) {
  return (
    <div className="overflow-x-auto rounded-none border">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={`${headClasses} w-64`}>Insumo</th>
            <th className={`${headClasses} w-40`}>Origen</th>
            {estado === "aprobado" && (
              <th className={`${headClasses} w-28 text-center`}>Código maestro</th>
            )}
            {estado === "rechazado" && <th className={`${headClasses} w-56`}>Motivo</th>}
            <th className={`${headClasses} w-44`}>
              {estado === "aprobado" ? "Aprobado por" : "Rechazado por"}
            </th>
            <th className={`${headClasses} w-32 text-center`}>Fecha resolución</th>
          </tr>
        </thead>
        <tbody>
          {solicitudes.map((s) => (
            <tr key={s.id} className="border-b hover:bg-muted/30">
              <td className={celda}>
                <p className="font-medium">{s.descripcion}</p>
                {s.tipo && <p className="text-muted-foreground">{s.tipo}</p>}
              </td>
              <td className={`${celda} text-muted-foreground`}>
                <p>{s.solicitadoPorNombre ?? "alguien"}</p>
                <p>{new Date(s.createdAt).toLocaleDateString("es-CO")}</p>
                {s.proyectoNombre && (
                  <p className="truncate">
                    {s.proyectoNombre}
                    {s.itemCodigo && ` — ${s.itemCodigo}`}
                  </p>
                )}
              </td>
              {estado === "aprobado" && (
                <td className={`${celda} text-center font-mono`}>
                  {s.codigoMaestroAsignado ?? "—"}
                </td>
              )}
              {estado === "rechazado" && (
                <td className={celda}>{s.motivoRechazo ?? "—"}</td>
              )}
              <td className={celda}>{s.resueltoPorNombre ?? "—"}</td>
              <td className={`${celda} text-center`}>
                {s.resueltoAt ? new Date(s.resueltoAt).toLocaleDateString("es-CO") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}