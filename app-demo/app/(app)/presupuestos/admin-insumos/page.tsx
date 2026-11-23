"use client"

import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { Suspense, useEffect, useMemo, useState } from "react"
import { nombreUnidad, unidadMaestro, UNIDADES_MAESTRO } from "@/lib/unidades"
import {
  listarSolicitudesInsumos,
  listarAgrupacionesInsumos,
  aprobarSolicitudInsumo,
  rechazarSolicitudInsumo,
  type OrigenSolicitudInsumo,
  type SolicitudInsumo,
} from "@/app/(app)/presupuestos/actions"
import { CATEGORIAS_APU } from "@/app/(app)/presupuestos/categorias-apu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BannerPreciosInsumos } from "@/components/banner-precios-insumos"
import { useSearchParams, useRouter } from "next/navigation"
import { formatearFechaSinHora } from "@/lib/fechas"
import { AYUDA_DOBLE_CLIC, CLASE_FILA_DOBLE_CLIC, VentanaDetalle, alDobleClic } from "@/components/ventana-detalle"
import { CLASE_CELDA_EXCEL, CLASE_ENCABEZADO_EXCEL, CLASE_MARCO_EXCEL, CLASE_TABLA_EXCEL } from "@/components/tabla-excel"

const TODOS_LOS_TIPOS = CATEGORIAS_APU.flatMap((c) => c.tipos as readonly string[])

const SIN_PROYECTO = "__sin_proyecto__"
const NOMBRE_ORIGEN: Record<OrigenSolicitudInsumo, string> = {
  presupuesto: "Presupuesto (técnica)",
  requisicion_administrativa: "Requisición administrativa",
  requisicion_extraordinaria: "Requisición extraordinaria",
}

const headClasses = CLASE_ENCABEZADO_EXCEL
const celda = `${CLASE_CELDA_EXCEL} text-xs`

// Lo que se elige al aprobar para que el insumo entre estandarizado al maestro.
type DatosAprobacion = {
  precio: number
  tipo: string
  uM: string
  agrupacion: string
  ivaPorcentaje: number
  // nombre con que entra al maestro (se puede corregir: "ALAMBRE GALVANIZADO X 50 M")
  descripcion: string
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
  // Filtros (sobre lo ya cargado): proyecto ("" = todos, SIN_PROYECTO) y
  // origen (presupuesto o requisición administrativa).
  const [filtroProyecto, setFiltroProyecto] = useState("")
  const [filtroOrigen, setFiltroOrigen] = useState<"" | OrigenSolicitudInsumo>("")
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

  // Carga al entrar (cargando ya empieza en true).
  useEffect(() => {
    listarSolicitudesInsumos()
      .then(setSolicitudes)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las solicitudes."))
      .finally(() => setCargando(false))
  }, [])

  // Después de subir el Excel de precios: las aprobadas salen de la lista.
  function recargarSolicitudes() {
    listarSolicitudesInsumos()
      .then(setSolicitudes)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las solicitudes."))
  }

  // Proyectos que tienen solicitudes, para la lista del filtro.
  const proyectosConSolicitudes = useMemo(() => {
    const porId = new Map<string, string>()
    let sinProyecto = false
    for (const s of solicitudes) {
      if (s.proyectoId) porId.set(s.proyectoId, s.proyectoNombre ?? "Proyecto")
      else sinProyecto = true
    }
    const lista = Array.from(porId, ([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    return { lista, sinProyecto }
  }, [solicitudes])

  const visibles = useMemo(
    () =>
      solicitudes.filter(
        (s) =>
          (!filtroOrigen || s.origen === filtroOrigen) &&
          (!filtroProyecto || (filtroProyecto === SIN_PROYECTO ? !s.proyectoId : s.proyectoId === filtroProyecto))
      ),
    [solicitudes, filtroOrigen, filtroProyecto]
  )
  const hayFiltro = Boolean(filtroProyecto || filtroOrigen)
  const idsVisibles = useMemo(() => (hayFiltro ? new Set(visibles.map((s) => s.id)) : null), [hayFiltro, visibles])

  function marcarProcesando(id: string, activo: boolean) {
    setIdsEnProceso((prev) => {
      const next = new Set(prev)
      if (activo) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleAprobar(solicitud: SolicitudInsumo, datos: DatosAprobacion) {
    const { precio, tipo, uM, agrupacion, ivaPorcentaje, descripcion } = datos
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
        descripcion,
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
    <EncabezadoPagina titulo="Aprobación de insumos" subtitulo="Solicitudes de insumos nuevos pedidos por ingenieros" />
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

      <BannerPreciosInsumos onAprobadas={recargarSolicitudes} soloIds={idsVisibles} />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : solicitudes.length === 0 ? (
        <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          No hay solicitudes pendientes.
        </p>
      ) : (
        <>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Proyecto</span>
            <select
              value={filtroProyecto}
              onChange={(e) => setFiltroProyecto(e.target.value)}
              className="h-9 min-w-56 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Todos los proyectos</option>
              {proyectosConSolicitudes.lista.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
              {proyectosConSolicitudes.sinProyecto && <option value={SIN_PROYECTO}>Sin proyecto</option>}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Origen</span>
            <select
              value={filtroOrigen}
              onChange={(e) => setFiltroOrigen(e.target.value as "" | OrigenSolicitudInsumo)}
              className="h-9 min-w-56 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Todos los orígenes</option>
              <option value="presupuesto">{NOMBRE_ORIGEN.presupuesto}</option>
              <option value="requisicion_administrativa">{NOMBRE_ORIGEN.requisicion_administrativa}</option>
              <option value="requisicion_extraordinaria">{NOMBRE_ORIGEN.requisicion_extraordinaria}</option>
            </select>
          </label>
          {hayFiltro && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFiltroProyecto("")
                setFiltroOrigen("")
              }}
            >
              Limpiar filtros
            </Button>
          )}
          <span className="pb-2 text-xs text-muted-foreground">
            {hayFiltro ? `${visibles.length} de ${solicitudes.length} solicitudes` : `${solicitudes.length} solicitudes`}
          </span>
        </div>
        {visibles.length === 0 ? (
          <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            Ninguna solicitud cumple los filtros.
          </p>
        ) : (
        <TablaPendientes
          solicitudes={visibles}
          idsEnProceso={idsEnProceso}
          agrupaciones={agrupaciones}
          onAprobar={handleAprobar}
          onRechazar={handleRechazar}
        />
        )}
        </>
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
    <div className={CLASE_MARCO_EXCEL}>
      <table className={CLASE_TABLA_EXCEL}>
        <thead>
          <tr>
            <th className={`${headClasses} w-72`} title="Nombre con que entra al maestro (se puede corregir)">
              Insumo (nombre en el maestro)
            </th>
            <th className={`${headClasses} w-40`}>Origen</th>
            <th className={`${headClasses} w-44`}>Tipo</th>
            <th
              className={`${headClasses} w-40`}
              title="En la que se compra y se pone el precio. Viene la del presupuesto; si se compra por rollo, bulto o unidad, cámbiala y escribe en el nombre cuánto trae."
            >
              Unidad de compra
            </th>
            <th className={`${headClasses} w-48`}>Agrupación</th>
            <th className={`${headClasses} w-20`}>IVA</th>
            <th className={`${headClasses} w-36 text-right`}>Precio unitario sin IVA</th>
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
  const [viendo, setViendo] = useState(false)
  // Lo que trae la solicitud (del Excel: "INSUMO", "m³") se usa solo si
  // corresponde a la lista estándar; si no, queda vacío para elegirlo.
  const [tipo, setTipo] = useState(solicitud.tipo && TODOS_LOS_TIPOS.includes(solicitud.tipo) ? solicitud.tipo : "")
  // Unidad en que se COMPRA (la del precio): viene la del presupuesto y se
  // cambia si se compra por rollo, bulto, unidad... Si cambia, el ingeniero
  // confirma la conversión en su presupuesto (ver aprobarSolicitudInsumo).
  const unidadPresupuesto = unidadMaestro(solicitud.uM)
  const [uM, setUM] = useState(unidadPresupuesto ?? "")
  const [agrupacion, setAgrupacion] = useState("")
  const [iva, setIva] = useState("19")
  // Nombre con que entra al maestro (se puede corregir).
  const [nombre, setNombre] = useState(solicitud.descripcion.trim().replace(/\s+/g, " ").toUpperCase())
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
    if (!nombre.trim()) {
      setError("Escribe el nombre del insumo.")
      return
    }
    setError(null)
    onAprobar(solicitud, {
      precio: precioNum,
      tipo,
      uM,
      agrupacion,
      ivaPorcentaje: Number(iva),
      descripcion: nombre,
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
    <tr
      className={`align-top hover:bg-muted/30 ${CLASE_FILA_DOBLE_CLIC}`}
      title={AYUDA_DOBLE_CLIC}
      onDoubleClick={alDobleClic(() => setViendo(true))}
    >
      <td className={celda}>
        {/* El nombre se ve completo: el campo crece en alto con el texto (un
            doble invisible en la misma celda del grid le da la altura). */}
        <div className="grid">
          <span
            aria-hidden
            className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words rounded-xl border px-3 py-1.5 text-xs font-medium"
          >
            {nombre + " "}
          </span>
          <textarea
            value={nombre}
            rows={1}
            onChange={(e) => setNombre(e.target.value.replace(/\s*\n\s*/g, " ").toUpperCase())}
            disabled={mostrandoRechazo}
            className="col-start-1 row-start-1 w-full min-w-0 resize-none overflow-hidden break-words rounded-xl border border-input bg-input/30 px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Nombre en el maestro"
          />
        </div>
        {nombre !== solicitud.descripcion.trim().replace(/\s+/g, " ").toUpperCase() && (
          <p className="mt-1 text-[11px] text-muted-foreground">Pedido como: {solicitud.descripcion}</p>
        )}
      </td>
      <td className={`${celda} text-muted-foreground`}>
        <p>{solicitud.solicitadoPorNombre ?? "alguien"}</p>
        <p>{formatearFechaSinHora(solicitud.createdAt)}</p>
        {solicitud.origen !== "presupuesto" && (
          <p className="font-medium text-amber-700">{NOMBRE_ORIGEN[solicitud.origen]}</p>
        )}
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
          className={`h-8 w-full rounded-md border bg-background px-1.5 text-xs ${uM ? "" : "border-amber-400"}`}
          aria-label="Unidad de compra"
        >
          <option value="">Elegir…</option>
          {UNIDADES_MAESTRO.map((u) => (
            <option key={u.codigo} value={u.texto}>
              {nombreUnidad(u.texto)} — {u.texto}
            </option>
          ))}
        </select>
        {solicitud.uM && (
          <p className={`mt-1 text-[11px] ${unidadPresupuesto ? "text-muted-foreground" : "text-amber-700"}`}>
            {unidadPresupuesto
              ? `Presupuesto: ${nombreUnidad(solicitud.uM)}`
              : `El presupuesto dice «${solicitud.uM}», que no es una unidad`}
          </p>
        )}
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
          aria-label={uM ? `Precio por ${nombreUnidad(uM)} sin IVA` : "Precio sin IVA"}
        />
        {uM && <p className="mt-1 text-right text-[11px] text-muted-foreground">por {nombreUnidad(uM)}</p>}
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
      {/* Solo datos de la solicitud: aprobar y rechazar se hacen en la fila,
          donde están los campos que hay que llenar. */}
      <VentanaDetalle
        abierta={viendo}
        onCerrar={() => setViendo(false)}
        titulo={solicitud.descripcion}
        subtitulo="Solicitud por aprobar: los datos para aprobarla se llenan en la fila."
        campos={[
          { etiqueta: "Solicitado por", valor: solicitud.solicitadoPorNombre ?? "" },
          { etiqueta: "Fecha", valor: formatearFechaSinHora(solicitud.createdAt) },
          { etiqueta: "Origen", valor: NOMBRE_ORIGEN[solicitud.origen] },
          { etiqueta: "Proyecto", valor: solicitud.proyectoNombre ?? "" },
          { etiqueta: "Ítem", valor: solicitud.itemCodigo ?? "" },
          { etiqueta: "Tipo pedido", valor: solicitud.tipo ?? "" },
          { etiqueta: "Unidad pedida", valor: solicitud.uM ?? "" },
        ]}
      />
    </tr>
  )
}
