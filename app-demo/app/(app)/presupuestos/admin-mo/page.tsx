"use client"

import { useEffect, useMemo, useState } from "react"
import {
  listarSolicitudesManoObra,
  aprobarSolicitudManoObra,
  rechazarSolicitudManoObra,
  type SolicitudManoObra,
} from "@/app/(app)/presupuestos/actions"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { ArrowUp, ArrowDown, ArrowUpDown, Search, X } from "lucide-react"
import { useSearchParams, useRouter } from "next/navigation"

const headClasses = "border-r bg-primary px-3 py-2.5 text-left text-xs font-medium text-primary-foreground last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

type Estado = "pendiente" | "aprobado" | "rechazado"
// "catalogo" es una pestaña más, junto a las 3 de solicitudes -- no es
// un estado de nada, es una vista distinta (la tabla completa de
// mano_obra_categorias, tipo maestro de insumos).
type Vista = Estado | "catalogo"

const FILTROS: { valor: Vista; etiqueta: string }[] = [
  { valor: "pendiente", etiqueta: "Pendientes" },
  { valor: "aprobado", etiqueta: "Aprobadas" },
  { valor: "rechazado", etiqueta: "Rechazadas" },
  { valor: "catalogo", etiqueta: "Catálogo" },
]

export default function AdminManoObraPage() {
  const [vista, setVista] = useState<Vista>("pendiente")
  const [solicitudes, setSolicitudes] = useState<SolicitudManoObra[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [idsEnProceso, setIdsEnProceso] = useState<Set<string>>(new Set())

  const searchParams = useSearchParams()
  const router = useRouter()
  const [mostrarNoAutorizado, setMostrarNoAutorizado] = useState(
    searchParams.get("error") === "no-autorizado"
  )

  function descartarAviso() {
    setMostrarNoAutorizado(false)
    router.replace("/presupuestos")
  }

  function cargar() {
    if (vista === "catalogo") return // el catálogo se carga solo, ver CatalogoManoObra abajo
    setCargando(true)
    setError(null)
    listarSolicitudesManoObra(vista)
      .then(setSolicitudes)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las solicitudes."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista])

  function marcarProcesando(id: string, activo: boolean) {
    setIdsEnProceso((prev) => {
      const next = new Set(prev)
      if (activo) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleAprobar(solicitud: SolicitudManoObra, valor: number, grupo: string, unidad: string) {
    marcarProcesando(solicitud.id, true)
    setError(null)
    try {
      await aprobarSolicitudManoObra({
        solicitudId: solicitud.id,
        valorUnitario: valor,
        grupo: grupo || null,
        unidad,
      })
      setSolicitudes((prev) => prev.filter((s) => s.id !== solicitud.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar la solicitud.")
    } finally {
      marcarProcesando(solicitud.id, false)
    }
  }

  // `motivo` es OBLIGATORIO -- si se rechaza una solicitud que vino de un
  // import, ese motivo es lo único que le explica al ingeniero, en la
  // tabla del presupuesto, por qué su ítem quedó en rojo.
  async function handleRechazar(solicitud: SolicitudManoObra, motivo: string) {
    marcarProcesando(solicitud.id, true)
    setError(null)
    try {
      await rechazarSolicitudManoObra(solicitud.id, motivo)
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
        <h1 className="text-2xl font-semibold tracking-tight">Solicitudes de mano de obra</h1>
        <p className="text-sm text-muted-foreground">
          Categorías de actividad nuevas pedidas por ingenieros
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

      <div className="flex gap-1.5 border-b">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => setVista(f.valor)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              vista === f.valor
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.etiqueta}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {vista === "catalogo" ? (
        <CatalogoManoObra />
      ) : cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : solicitudes.length === 0 ? (
        <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          {vista === "pendiente"
            ? "No hay solicitudes pendientes."
            : `No hay solicitudes ${FILTROS.find((f) => f.valor === vista)?.etiqueta.toLowerCase()}.`}
        </p>
      ) : vista === "pendiente" ? (
        <TablaPendientes
          solicitudes={solicitudes}
          idsEnProceso={idsEnProceso}
          onAprobar={handleAprobar}
          onRechazar={handleRechazar}
        />
      ) : (
        <TablaResueltas solicitudes={solicitudes} estado={vista} />
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// Tabla de PENDIENTES -- con los campos editables (grupo/valor) antes de
// aprobar. Igual que /admin-insumos, pero sin selector de "tipo" (mano
// de obra no tiene tipo) -- en su lugar, un campo de texto libre para el
// grupo (con lo que el ingeniero sugirió como valor inicial).
// ---------------------------------------------------------------------------

function TablaPendientes({
  solicitudes,
  idsEnProceso,
  onAprobar,
  onRechazar,
}: {
  solicitudes: SolicitudManoObra[]
  idsEnProceso: Set<string>
  onAprobar: (s: SolicitudManoObra, valor: number, grupo: string, unidad: string) => void
  onRechazar: (s: SolicitudManoObra, motivo: string) => void
}) {
  return (
    <div className="overflow-x-auto rounded-none border">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={`${headClasses} w-64`}>Categoría</th>
            <th className={`${headClasses} w-40`}>Origen</th>
            <th className={`${headClasses} w-40`}>Grupo</th>
            <th className={`${headClasses} w-24 text-center`}>Unidad</th>
            <th className={`${headClasses} w-28 text-right`}>Valor</th>
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

// Unidades que ya existen en el catálogo -- sugeridas vía datalist (con
// autocompletado, pero sin forzar a que sea solo una de estas) para no
// terminar con variantes tipo "UN"/"UND" escritas distinto por accidente,
// mismo problema que ya tuvimos que unificar una vez en mano_obra_categorias.
const UNIDADES_CONOCIDAS = ["M", "M2", "M3", "ML", "UN", "JUEGO", "PTO"]

function FilaPendiente({
  solicitud,
  procesando,
  onAprobar,
  onRechazar,
}: {
  solicitud: SolicitudManoObra
  procesando: boolean
  onAprobar: (s: SolicitudManoObra, valor: number, grupo: string, unidad: string) => void
  onRechazar: (s: SolicitudManoObra, motivo: string) => void
}) {
  const [valor, setValor] = useState(solicitud.valorPropuesto ? String(solicitud.valorPropuesto) : "")
  const [grupo, setGrupo] = useState(solicitud.grupoSugerido ?? "")
  const [unidad, setUnidad] = useState("")
  const [error, setError] = useState<string | null>(null)

  // Caja de observaciones para el rechazo -- se abre solo cuando le dan
  // "Rechazar" la primera vez, mismo patrón que /admin-insumos. El
  // motivo es OBLIGATORIO -- sin él no se puede confirmar el rechazo.
  const [mostrandoRechazo, setMostrandoRechazo] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState("")

  function intentarAprobar() {
    const valorNum = Number(valor)
    if (!valor || valorNum <= 0) {
      setError("Ingresa un valor real.")
      return
    }
    if (!unidad.trim()) {
      setError("Elige la unidad (M2, UN, ML...) -- es importante para saber cómo aplicar el valor.")
      return
    }
    setError(null)
    onAprobar(solicitud, valorNum, grupo, unidad.trim().toUpperCase())
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
        <Input
          value={grupo}
          onChange={(e) => setGrupo(e.target.value)}
          disabled={mostrandoRechazo}
          placeholder="ej. DEMOLICION"
          className="h-8 text-xs"
        />
      </td>
      <td className={celda}>
        <Input
          list="unidades-conocidas-mo"
          value={unidad}
          onChange={(e) => setUnidad(e.target.value)}
          disabled={mostrandoRechazo}
          placeholder="M2, UN…"
          className="h-8 text-center text-xs"
        />
        <datalist id="unidades-conocidas-mo">
          {UNIDADES_CONOCIDAS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </td>
      <td className={celda}>
        <Input
          type="number"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
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
// trazabilidad: quién resolvió, cuándo, y qué categoría quedó en el
// catálogo (si fue aprobada) o el motivo (si fue rechazada).
// ---------------------------------------------------------------------------

function TablaResueltas({
  solicitudes,
  estado,
}: {
  solicitudes: SolicitudManoObra[]
  estado: "aprobado" | "rechazado"
}) {
  return (
    <div className="overflow-x-auto rounded-none border">
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={`${headClasses} w-64`}>Categoría</th>
            <th className={`${headClasses} w-40`}>Origen</th>
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
                {s.grupoSugerido && <p className="text-muted-foreground">{s.grupoSugerido}</p>}
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
              {estado === "rechazado" && <td className={celda}>{s.motivoRechazo ?? "—"}</td>}
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

// ---------------------------------------------------------------------------
// Pestaña "Catálogo" -- tabla completa de mano_obra_categorias, mismo
// patrón que /maestro-insumos (búsqueda, filtros, orden, paginación,
// doble-click para editar), pero con las columnas de mano de obra
// (grupo/unidad/valor en vez de tipo/u.m./agrupación/vr_unitario).
// ---------------------------------------------------------------------------

interface CategoriaManoObraFila {
  id: string
  grupo: string | null
  categoria: string
  unidad: string
  valor_unitario: number | null
}

type ColumnaOrdenableCatalogo = "grupo" | "categoria" | "unidad" | "valor_unitario"
type Direccion = "asc" | "desc"

const FILAS_POR_PAGINA_CATALOGO = 50

const COLUMNAS_CATALOGO: { key: ColumnaOrdenableCatalogo; label: string; alinear?: "right" }[] = [
  { key: "grupo", label: "Grupo" },
  { key: "categoria", label: "Categoría" },
  { key: "unidad", label: "Unidad" },
  { key: "valor_unitario", label: "Valor", alinear: "right" },
]

function CatalogoManoObra() {
  const [categorias, setCategorias] = useState<CategoriaManoObraFila[]>([])
  const [loading, setLoading] = useState(true)

  const [busqueda, setBusqueda] = useState("")
  const [filtroGrupo, setFiltroGrupo] = useState("todos")
  const [filtroUnidad, setFiltroUnidad] = useState("todos")

  const [columnaOrden, setColumnaOrden] = useState<ColumnaOrdenableCatalogo>("grupo")
  const [direccionOrden, setDireccionOrden] = useState<Direccion>("asc")

  const [pagina, setPagina] = useState(1)
  const [categoriaEditando, setCategoriaEditando] = useState<CategoriaManoObraFila | null>(null)

  useEffect(() => {
    async function fetchCategorias() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("mano_obra_categorias")
        .select("id, grupo, categoria, unidad, valor_unitario")
        .order("grupo")

      if (error) {
        console.error("Error obteniendo categorías de mano de obra:", error)
        setLoading(false)
        return
      }
      setCategorias(data ?? [])
      setLoading(false)
    }
    fetchCategorias()
  }, [])

  const grupos = useMemo(
    () => Array.from(new Set(categorias.map((c) => c.grupo).filter((v): v is string => !!v))).sort(),
    [categorias]
  )
  const unidades = useMemo(
    () => Array.from(new Set(categorias.map((c) => c.unidad).filter((v): v is string => !!v))).sort(),
    [categorias]
  )

  const hayFiltrosActivos = busqueda !== "" || filtroGrupo !== "todos" || filtroUnidad !== "todos"

  function limpiarFiltros() {
    setBusqueda("")
    setFiltroGrupo("todos")
    setFiltroUnidad("todos")
  }

  const filasProcesadas = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()

    const filtradas = categorias.filter((c) => {
      if (filtroGrupo !== "todos" && c.grupo !== filtroGrupo) return false
      if (filtroUnidad !== "todos" && c.unidad !== filtroUnidad) return false
      if (!termino) return true
      return (
        c.categoria.toLowerCase().includes(termino) ||
        (c.grupo ?? "").toLowerCase().includes(termino)
      )
    })

    const ordenadas = [...filtradas].sort((a, b) => {
      const va = a[columnaOrden]
      const vb = b[columnaOrden]
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      const comparacion =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "es")
      return direccionOrden === "asc" ? comparacion : -comparacion
    })

    return ordenadas
  }, [categorias, busqueda, filtroGrupo, filtroUnidad, columnaOrden, direccionOrden])

  useEffect(() => {
    setPagina(1)
  }, [busqueda, filtroGrupo, filtroUnidad, columnaOrden, direccionOrden])

  const totalPaginas = Math.max(1, Math.ceil(filasProcesadas.length / FILAS_POR_PAGINA_CATALOGO))
  const paginaActual = Math.min(pagina, totalPaginas)
  const filasPagina = filasProcesadas.slice(
    (paginaActual - 1) * FILAS_POR_PAGINA_CATALOGO,
    paginaActual * FILAS_POR_PAGINA_CATALOGO
  )

  function alternarOrden(columna: ColumnaOrdenableCatalogo) {
    if (columnaOrden === columna) {
      setDireccionOrden((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setColumnaOrden(columna)
      setDireccionOrden("asc")
    }
  }

  function formatearMoneda(valor: number | null) {
    if (valor === null) return "—"
    return valor.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
  }

  function handleGuardado(actualizada: CategoriaManoObraFila) {
    setCategorias((prev) => prev.map((c) => (c.id === actualizada.id ? actualizada : c)))
    setCategoriaEditando(null)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {loading
          ? "Cargando categorías…"
          : `${filasProcesadas.length.toLocaleString("es-CO")} de ${categorias.length.toLocaleString("es-CO")} categorías`}
      </p>

      {!loading && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por categoría o grupo..."
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <select
            value={filtroGrupo}
            onChange={(e) => setFiltroGrupo(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="todos">Todos los grupos</option>
            {grupos.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <select
            value={filtroUnidad}
            onChange={(e) => setFiltroUnidad(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="todos">Todas las unidades</option>
            {unidades.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          {hayFiltrosActivos && (
            <button
              onClick={limpiarFiltros}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {!loading && (
        <>
          <div className="overflow-hidden rounded-xl border">
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <tr>
                    {COLUMNAS_CATALOGO.map((col) => (
                      <th
                        key={col.key}
                        className={`whitespace-nowrap border-b px-4 py-3 font-medium ${
                          col.alinear === "right" ? "text-right" : "text-left"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => alternarOrden(col.key)}
                          className={`inline-flex select-none items-center gap-1.5 hover:text-foreground ${
                            columnaOrden === col.key ? "text-foreground" : "text-muted-foreground"
                          } ${col.alinear === "right" ? "flex-row-reverse" : ""}`}
                        >
                          {col.label}
                          {columnaOrden === col.key ? (
                            direccionOrden === "asc" ? (
                              <ArrowUp className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5" />
                            )
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/40" />
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filasPagina.map((c, idx) => (
                    <tr
                      key={c.id}
                      onDoubleClick={() => setCategoriaEditando(c)}
                      title="Doble click para editar esta categoría"
                      className={`cursor-pointer border-b last:border-b-0 hover:bg-muted/40 ${
                        idx % 2 === 1 ? "bg-muted/10" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 text-muted-foreground">{c.grupo ?? "—"}</td>
                      <td className="px-4 py-2.5">{c.categoria}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{c.unidad}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono">
                        {formatearMoneda(c.valor_unitario)}
                      </td>
                    </tr>
                  ))}
                  {filasPagina.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNAS_CATALOGO.length} className="px-4 py-10 text-center text-muted-foreground">
                        No hay categorías que coincidan con la búsqueda o los filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {filasProcesadas.length > FILAS_POR_PAGINA_CATALOGO && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Página {paginaActual} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={paginaActual === 1}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                  disabled={paginaActual === totalPaginas}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {categoriaEditando && (
        <EditarCategoriaManoObraDialog
          categoria={categoriaEditando}
          gruposConocidos={grupos}
          unidadesConocidas={unidades}
          onCerrar={() => setCategoriaEditando(null)}
          onGuardado={handleGuardado}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diálogo de edición del catálogo -- mismo patrón que
// EditarInsumoDialog en /maestro-insumos: escribe directo a Supabase
// desde el cliente (la RLS de mano_obra_categorias ya permite
// lectura/escritura a cualquier autenticado -- ver la política
// "autenticados leen y modifican mano_obra_categorias").
// ---------------------------------------------------------------------------

function EditarCategoriaManoObraDialog({
  categoria,
  gruposConocidos,
  unidadesConocidas,
  onCerrar,
  onGuardado,
}: {
  categoria: CategoriaManoObraFila
  gruposConocidos: string[]
  unidadesConocidas: string[]
  onCerrar: () => void
  onGuardado: (actualizada: CategoriaManoObraFila) => void
}) {
  const [categoriaTexto, setCategoriaTexto] = useState(categoria.categoria)
  const [grupo, setGrupo] = useState(categoria.grupo ?? "")
  const [unidad, setUnidad] = useState(categoria.unidad)
  const [valorUnitario, setValorUnitario] = useState(String(categoria.valor_unitario ?? ""))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGuardar() {
    if (!categoriaTexto.trim()) {
      setError("La categoría no puede quedar vacía.")
      return
    }
    if (!unidad.trim()) {
      setError("La unidad no puede quedar vacía.")
      return
    }
    const valorNum = valorUnitario.trim() === "" ? null : Number(valorUnitario)
    if (valorUnitario.trim() !== "" && (Number.isNaN(valorNum) || (valorNum as number) < 0)) {
      setError("El valor debe ser un número válido.")
      return
    }

    setGuardando(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: errorUpdate } = await supabase
        .from("mano_obra_categorias")
        .update({
          categoria: categoriaTexto.trim(),
          grupo: grupo.trim() || null,
          unidad: unidad.trim().toUpperCase(),
          valor_unitario: valorNum,
        })
        .eq("id", categoria.id)
        .select("id, grupo, categoria, unidad, valor_unitario")
        .single()

      if (errorUpdate) throw new Error(errorUpdate.message)

      onGuardado(data as CategoriaManoObraFila)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el cambio.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !guardando && onCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar categoría de mano de obra</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Categoría</label>
            <textarea
              value={categoriaTexto}
              onChange={(e) => setCategoriaTexto(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Grupo</label>
              <input
                list="grupos-conocidos-mo-catalogo"
                value={grupo}
                onChange={(e) => setGrupo(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="grupos-conocidos-mo-catalogo">
                {gruposConocidos.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Unidad</label>
              <input
                list="unidades-conocidas-mo-catalogo"
                value={unidad}
                onChange={(e) => setUnidad(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="unidades-conocidas-mo-catalogo">
                {unidadesConocidas.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Valor</label>
              <input
                type="number"
                value={valorUnitario}
                onChange={(e) => setValorUnitario(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-right text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="rounded-lg border px-4 py-2 text-sm hover:bg-muted/40 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleGuardar}
            disabled={guardando}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar cambios"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}