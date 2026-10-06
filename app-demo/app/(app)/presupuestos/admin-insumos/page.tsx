"use client"

import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { Suspense, useEffect, useState } from "react"
import { sugerirPresentacion, unidadMaestro, UNIDADES_DE_USO, UNIDADES_MAESTRO } from "@/lib/unidades"
import {
  listarSolicitudesInsumos,
  listarAgrupacionesInsumos,
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

// Lo que se elige al aprobar para que el insumo entre estandarizado al maestro.
type DatosAprobacion = {
  precio: number
  tipo: string
  uM: string
  agrupacion: string
  ivaPorcentaje: number
  presentacion: { unidadUso: string; contenido: string }
}

// Contenido real de la página -- usa useSearchParams(), así que NO puede
// ser el export default directo: Next.js exige que cualquier componente
// que lea searchParams esté envuelto en <Suspense>, o el build falla con
// "useSearchParams() should be wrapped in a suspense boundary" al
// intentar prerenderizar la ruta. Ver AdminInsumosPage más abajo.
function AdminInsumosContent() {
  const [solicitudes, setSolicitudes] = useState<SolicitudInsumo[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [idsEnProceso, setIdsEnProceso] = useState<Set<string>>(new Set())
  const [agrupaciones, setAgrupaciones] = useState<string[]>([])
  useEffect(() => {
    listarAgrupacionesInsumos()
      .then((lista: string[]) => setAgrupaciones(lista))
      .catch(() => setAgrupaciones([]))
  }, [])

    // dentro del componente:
  const searchParams = useSearchParams()
  const router = useRouter()
  const [mostrarNoAutorizado, setMostrarNoAutorizado] = useState(
    searchParams.get("error") === "no-autorizado"
  )

  function descartarAviso() {
    setMostrarNoAutorizado(false)
    // limpia el query param de la URL sin recargar la página -- OJO:
    // antes esto mandaba a "/presupuestos" (una ruta distinta), lo que
    // sacaba al usuario de admin-insumos en vez de solo limpiar el
    // query param en la página donde ya estaba.
    router.replace("/presupuestos/admin-insumos")
  }

  function cargar() {
    setCargando(true)
    setError(null)
    listarSolicitudesInsumos()
      .then(setSolicitudes)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las solicitudes."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    cargar()
  }, [])

  function marcarProcesando(id: string, activo: boolean) {
    setIdsEnProceso((prev) => {
      const next = new Set(prev)
      if (activo) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleAprobar(solicitud: SolicitudInsumo, datos: DatosAprobacion) {
    const { precio, tipo, uM, agrupacion, ivaPorcentaje, presentacion } = datos
    marcarProcesando(solicitud.id, true)
    setError(null)
    try {
      await aprobarSolicitudInsumo({
        solicitudId: solicitud.id,
        vrUnitario: precio,
        tipo,
        uM: uM || null,
        agrupacion,
        ivaPorcentaje,
        unidadUso: presentacion.unidadUso || null,
        contenido: presentacion.contenido.trim() ? Number(presentacion.contenido.replace(",", ".")) : null,
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
    <>
    <EncabezadoPagina titulo="Solicitudes de insumos" subtitulo="Insumos nuevos pedidos por ingenieros" />
    <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-4 sm:p-6">

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

      {error && <p className="text-sm text-destructive">{error}</p>}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : solicitudes.length === 0 ? (
        <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          No hay solicitudes pendientes.
        </p>
      ) : (
        <TablaPendientes
          solicitudes={solicitudes}
          idsEnProceso={idsEnProceso}
          agrupaciones={agrupaciones}
          onAprobar={handleAprobar}
          onRechazar={handleRechazar}
        />
      )}
    </main>
    </>
  )
}

// El export default real: solo envuelve AdminInsumosContent en
// Suspense. El fallback se ve un instante mientras Next resuelve los
// searchParams -- en la práctica es casi instantáneo salvo en el
// primer load frío.
export default function AdminInsumosPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-6">
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </main>
      }
    >
      <AdminInsumosContent />
    </Suspense>
  )
}

// ---------------------------------------------------------------------------
// Tabla de PENDIENTES -- con los campos editables (tipo/unidad/precio)
// antes de aprobar, igual que la versión anterior pero en formato tabla.
// ---------------------------------------------------------------------------

function TablaPendientes({
  solicitudes,
  idsEnProceso,
  agrupaciones,
  onAprobar,
  onRechazar,
}: {
  solicitudes: SolicitudInsumo[]
  idsEnProceso: Set<string>
  agrupaciones: string[]
  onAprobar: (s: SolicitudInsumo, datos: DatosAprobacion) => void
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
            <th className={`${headClasses} w-40`}>Unidad</th>
            <th className={`${headClasses} w-48`}>Agrupación</th>
            <th className={`${headClasses} w-20`}>IVA</th>
            <th className={`${headClasses} w-32 text-right`}>Precio sin IVA</th>
            <th className={`${headClasses} w-56 text-center`}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {solicitudes.map((s) => (
            <FilaPendiente
              key={s.id}
              solicitud={s}
              procesando={idsEnProceso.has(s.id)}
              agrupaciones={agrupaciones}
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
  agrupaciones,
  onAprobar,
  onRechazar,
}: {
  solicitud: SolicitudInsumo
  procesando: boolean
  agrupaciones: string[]
  onAprobar: (s: SolicitudInsumo, datos: DatosAprobacion) => void
  onRechazar: (s: SolicitudInsumo, motivo: string) => void
}) {
  const [precio, setPrecio] = useState("")
  // Lo que trae la solicitud (del Excel: "INSUMO", "m³") se usa solo si
  // corresponde a la lista estándar; si no, queda vacío para elegirlo.
  const [tipo, setTipo] = useState(solicitud.tipo && TODOS_LOS_TIPOS.includes(solicitud.tipo) ? solicitud.tipo : "")
  const [uM, setUM] = useState(unidadMaestro(solicitud.uM) ?? "")
  const [agrupacion, setAgrupacion] = useState("")
  const [iva, setIva] = useState("19")
  // Presentación: cuánto trae cada U.M. (1 bulto = 50 kg). Se propone la que
  // se lee del nombre ("CEMENTO X 50 KG").
  const sugerida = sugerirPresentacion(solicitud.descripcion, solicitud.uM)
  const [contenido, setContenido] = useState(sugerida ? String(sugerida.contenido) : "")
  const [unidadUso, setUnidadUso] = useState(sugerida?.unidadUso ?? "")
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
    if (!uM) {
      setError("Elige la unidad de compra.")
      return
    }
    if (!agrupacion) {
      setError("Elige la agrupación.")
      return
    }
    if (!!contenido.trim() !== !!unidadUso) {
      setError("La presentación necesita las dos cosas: cuánto trae y en qué unidad (o ninguna).")
      return
    }
    setError(null)
    onAprobar(solicitud, {
      precio: precioNum,
      tipo,
      uM,
      agrupacion,
      ivaPorcentaje: Number(iva),
      presentacion: { unidadUso, contenido },
    })
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
          <option value="">Elegir…</option>
          {TODOS_LOS_TIPOS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className={celda}>
        <select
          value={uM}
          onChange={(e) => setUM(e.target.value)}
          disabled={mostrandoRechazo}
          className="h-8 w-full rounded-md border bg-background px-1.5 text-xs"
          title={solicitud.uM ? `En la solicitud: ${solicitud.uM}` : undefined}
        >
          <option value="">Elegir…</option>
          {UNIDADES_MAESTRO.map((u) => (
            <option key={u.codigo} value={u.texto}>
              {u.texto}
            </option>
          ))}
        </select>
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground" title="Presentación: cuánto trae cada unidad de compra (opcional)">
          <span className="shrink-0">trae</span>
          <Input
            value={contenido}
            onChange={(e) => setContenido(e.target.value)}
            disabled={mostrandoRechazo}
            inputMode="decimal"
            placeholder="—"
            className="h-7 w-14 px-1.5 text-xs"
            aria-label="Contenido de la presentación"
          />
          <select
            value={unidadUso}
            onChange={(e) => setUnidadUso(e.target.value)}
            disabled={mostrandoRechazo}
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1 text-xs"
            aria-label="Unidad de uso"
          >
            <option value="">—</option>
            {UNIDADES_DE_USO.map((u) => (
              <option key={u.codigo} value={u.codigo}>
                {u.nombre}
              </option>
            ))}
          </select>
        </div>
      </td>
      <td className={celda}>
        <select
          value={agrupacion}
          onChange={(e) => setAgrupacion(e.target.value)}
          disabled={mostrandoRechazo}
          className="h-8 w-full rounded-md border bg-background px-1.5 text-xs"
        >
          <option value="">Elegir…</option>
          {agrupaciones.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </td>
      <td className={celda}>
        <select
          value={iva}
          onChange={(e) => setIva(e.target.value)}
          disabled={mostrandoRechazo}
          className="h-8 w-full rounded-md border bg-background px-1.5 text-xs"
        >
          <option value="0">0 %</option>
          <option value="5">5 %</option>
          <option value="19">19 %</option>
        </select>
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
