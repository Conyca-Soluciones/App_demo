"use client"

import { COMODIN_LISTAR } from "@/lib/busqueda"
import { Suspense, useEffect, useMemo, useState } from "react"
import {
  listarSolicitudesManoObra,
  aprobarSolicitudManoObra,
  rechazarSolicitudManoObra,
  listarSolicitudesEquipo,
  aprobarSolicitudEquipo,
  rechazarSolicitudEquipo,
  type SolicitudManoObra,
  type SolicitudEquipo,
} from "@/app/(app)/presupuestos/actions"
import { createClient } from "@/lib/supabase/client"
import { traerTodo } from "@/lib/supabase/traer-todo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Pencil, Plus, Search, X } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, PaginacionExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { useSearchParams, useRouter } from "next/navigation"

const headClasses = "border-r bg-primary px-3 py-2.5 text-left text-xs font-medium text-primary-foreground last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

// Solicitudes pendientes o el catálogo completo (mano_obra_categorias o
// equipo_categorias según `recurso`). Las solicitudes resueltas se borran,
// así que no hay pestañas de aprobadas/rechazadas.
type Vista = "pendiente" | "catalogo"

const FILTROS: { valor: Vista; etiqueta: string }[] = [
  { valor: "pendiente", etiqueta: "Pendientes" },
  { valor: "catalogo", etiqueta: "Catálogo" },
]

// ---------------------------------------------------------------------------
// Esta página cubre DOS recursos (Mano de obra y Equipo) -- antes era
// solo mano de obra, pero ambos comparten exactamente el mismo flujo
// (solicitud -> aprobar con grupo/unidad/valor -> categoría nueva en el
// catálogo, o rechazar con motivo) y la misma forma de dato
// (SolicitudManoObra y SolicitudEquipo son estructuralmente idénticos),
// así que en vez de duplicar toda la página se agregó un selector de
// "recurso" arriba de las pestañas de estado, y el resto del código
// (TablaPendientes, CatalogoRecurso) quedó parametrizado
// por `recurso` en vez de hardcodeado a mano de obra.
// ---------------------------------------------------------------------------

type TipoRecurso = "mano_obra" | "equipo"

type SolicitudRecurso = SolicitudManoObra | SolicitudEquipo

const RECURSOS: Record<
  TipoRecurso,
  {
    etiqueta: string
    titulo: string
    subtitulo: string
    tablaCatalogo: "mano_obra_categorias" | "equipo_categorias"
    unidadesConocidas: string[]
    placeholderGrupo: string
    listar: () => Promise<SolicitudRecurso[]>
    aprobar: (input: { solicitudId: string; valorUnitario: number; grupo: string | null; unidad: string }) => Promise<unknown>
    rechazar: (id: string, motivo?: string) => Promise<void>
  }
> = {
  mano_obra: {
    etiqueta: "Mano de obra",
    titulo: "Solicitudes de mano de obra",
    subtitulo: "Categorías de actividad nuevas pedidas por ingenieros",
    tablaCatalogo: "mano_obra_categorias",
    unidadesConocidas: ["M", "M2", "M3", "ML", "UN", "JUEGO", "PTO"],
    placeholderGrupo: "ej. DEMOLICION",
    listar: listarSolicitudesManoObra,
    aprobar: aprobarSolicitudManoObra,
    rechazar: rechazarSolicitudManoObra,
  },
  equipo: {
    etiqueta: "Equipo",
    titulo: "Solicitudes de equipo",
    subtitulo: "Categorías de equipo/maquinaria nuevas pedidas por ingenieros",
    tablaCatalogo: "equipo_categorias",
    unidadesConocidas: ["HORA", "DIA", "MES"],
    placeholderGrupo: "ej. TRANSPORTE PESADO",
    listar: listarSolicitudesEquipo,
    aprobar: aprobarSolicitudEquipo,
    rechazar: rechazarSolicitudEquipo,
  },
}

// Contenido real de la página -- usa useSearchParams(), así que NO puede
// ser el export default directo: Next.js exige que cualquier componente
// que lea searchParams esté envuelto en <Suspense>, o el build falla con
// "useSearchParams() should be wrapped in a suspense boundary" al
// intentar prerenderizar la ruta. Ver AdminManoObraPage más abajo.
function AdminManoObraContent() {
  const [recurso, setRecurso] = useState<TipoRecurso>("mano_obra")
  const [vista, setVista] = useState<Vista>("pendiente")
  const [solicitudes, setSolicitudes] = useState<SolicitudRecurso[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [idsEnProceso, setIdsEnProceso] = useState<Set<string>>(new Set())

  const config = RECURSOS[recurso]

  const searchParams = useSearchParams()
  const router = useRouter()
  const [mostrarNoAutorizado, setMostrarNoAutorizado] = useState(
    searchParams.get("error") === "no-autorizado"
  )

  function descartarAviso() {
    setMostrarNoAutorizado(false)
    // OJO: antes mandaba a "/presupuestos" (ruta distinta), sacando al
    // usuario de admin-mano-obra en vez de solo limpiar el query param
    // en la página donde ya estaba.
    router.replace("/presupuestos/admin-mano-obra")
  }

  function cargar() {
    if (vista === "catalogo") return // el catálogo se carga solo, ver CatalogoRecurso abajo
    setCargando(true)
    setError(null)
    config
      .listar()
      .then(setSolicitudes)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las solicitudes."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, recurso])

  // Cambiar de recurso vuelve siempre a "Pendientes".
  function cambiarRecurso(nuevo: TipoRecurso) {
    setRecurso(nuevo)
    setVista("pendiente")
  }

  function marcarProcesando(id: string, activo: boolean) {
    setIdsEnProceso((prev) => {
      const next = new Set(prev)
      if (activo) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function handleAprobar(solicitud: SolicitudRecurso, valor: number, grupo: string, unidad: string) {
    marcarProcesando(solicitud.id, true)
    setError(null)
    try {
      await config.aprobar({
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
  async function handleRechazar(solicitud: SolicitudRecurso, motivo: string) {
    marcarProcesando(solicitud.id, true)
    setError(null)
    try {
      await config.rechazar(solicitud.id, motivo)
      setSolicitudes((prev) => prev.filter((s) => s.id !== solicitud.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar la solicitud.")
    } finally {
      marcarProcesando(solicitud.id, false)
    }
  }

  return (
    <>
    <EncabezadoPagina titulo={config.titulo} subtitulo={config.subtitulo} />
    <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 space-y-6 p-4 sm:p-6">

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

      {/* Selector de recurso -- separado de las pestañas de estado, para
          que sea claro que son dos dimensiones distintas (qué catálogo,
          y qué estado dentro de ese catálogo). */}
      <div className="inline-flex rounded-lg border bg-muted/30 p-1">
        {(Object.keys(RECURSOS) as TipoRecurso[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => cambiarRecurso(r)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              recurso === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {RECURSOS[r].etiqueta}
          </button>
        ))}
      </div>

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
        <CatalogoRecurso key={recurso} tabla={config.tablaCatalogo} unidadesSugeridas={config.unidadesConocidas} />
      ) : cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : solicitudes.length === 0 ? (
        <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          No hay solicitudes pendientes.
        </p>
      ) : (
        <TablaPendientes
          solicitudes={solicitudes}
          idsEnProceso={idsEnProceso}
          unidadesConocidas={config.unidadesConocidas}
          placeholderGrupo={config.placeholderGrupo}
          onAprobar={handleAprobar}
          onRechazar={handleRechazar}
        />
      )}
    </main>
    </>
  )
}

// El export default real: solo envuelve AdminManoObraContent en
// Suspense. El fallback se ve un instante mientras Next resuelve los
// searchParams -- en la práctica es casi instantáneo salvo en el
// primer load frío.
export default function AdminManoObraPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-[1400px] flex-1 p-6">
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </main>
      }
    >
      <AdminManoObraContent />
    </Suspense>
  )
}

// ---------------------------------------------------------------------------
// Tabla de PENDIENTES -- con los campos editables (grupo/valor) antes de
// aprobar. Igual que /admin-insumos, pero sin selector de "tipo" (ni
// mano de obra ni equipo tienen tipo) -- en su lugar, un campo de texto
// libre para el grupo (con lo que el ingeniero sugirió como valor
// inicial).
// ---------------------------------------------------------------------------

function TablaPendientes({
  solicitudes,
  idsEnProceso,
  unidadesConocidas,
  placeholderGrupo,
  onAprobar,
  onRechazar,
}: {
  solicitudes: SolicitudRecurso[]
  idsEnProceso: Set<string>
  unidadesConocidas: string[]
  placeholderGrupo: string
  onAprobar: (s: SolicitudRecurso, valor: number, grupo: string, unidad: string) => void
  onRechazar: (s: SolicitudRecurso, motivo: string) => void
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
              unidadesConocidas={unidadesConocidas}
              placeholderGrupo={placeholderGrupo}
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
  unidadesConocidas,
  placeholderGrupo,
  onAprobar,
  onRechazar,
}: {
  solicitud: SolicitudRecurso
  procesando: boolean
  unidadesConocidas: string[]
  placeholderGrupo: string
  onAprobar: (s: SolicitudRecurso, valor: number, grupo: string, unidad: string) => void
  onRechazar: (s: SolicitudRecurso, motivo: string) => void
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

  // Datalist único por fila (id de la solicitud) -- antes era fijo
  // ("unidades-conocidas-mo") y con Equipo en la misma página dos filas
  // de recursos distintos podían coincidir en pantalla con datalists
  // duplicados con el mismo id.
  const datalistId = `unidades-conocidas-${solicitud.id}`

  function intentarAprobar() {
    const valorNum = Number(valor)
    if (!valor || valorNum <= 0) {
      setError("Ingresa un valor real.")
      return
    }
    if (!unidad.trim()) {
      setError("Elige la unidad -- es importante para saber cómo aplicar el valor.")
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
          placeholder={placeholderGrupo}
          className="h-8 text-xs"
        />
      </td>
      <td className={celda}>
        <Input
          list={datalistId}
          value={unidad}
          onChange={(e) => setUnidad(e.target.value)}
          disabled={mostrandoRechazo}
          placeholder={unidadesConocidas[0] ?? ""}
          className="h-8 text-center text-xs"
        />
        <datalist id={datalistId}>
          {unidadesConocidas.map((u) => (
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
// Pestaña "Catálogo" -- tabla completa del catálogo (mano_obra_categorias
// o equipo_categorias, según `tabla`), mismo patrón que /maestro-insumos
// (búsqueda, filtros, orden, paginación, doble-click para editar). Ambas
// tablas comparten exactamente las mismas 4 columnas relevantes
// (grupo/categoria/unidad/valor_unitario), así que un solo componente
// parametrizado por nombre de tabla cubre los dos catálogos -- antes
// era CatalogoManoObra, hardcodeado a una sola tabla.
// ---------------------------------------------------------------------------

interface CategoriaRecursoFila {
  id: string
  grupo: string | null
  categoria: string
  unidad: string
  valor_unitario: number | null
}

type ColumnaOrdenableCatalogo = "grupo" | "categoria" | "unidad" | "valor_unitario"
type Direccion = "asc" | "desc"

const FILAS_POR_PAGINA_CATALOGO = 50

function CatalogoRecurso({
  tabla,
  unidadesSugeridas,
}: {
  tabla: "mano_obra_categorias" | "equipo_categorias"
  unidadesSugeridas: string[]
}) {
  const [categorias, setCategorias] = useState<CategoriaRecursoFila[]>([])
  const [loading, setLoading] = useState(true)

  const [busqueda, setBusqueda] = useState("")
  const [filtroGrupo, setFiltroGrupo] = useState("todos")
  const [filtroUnidad, setFiltroUnidad] = useState("todos")

  const [columnaOrden, setColumnaOrden] = useState<ColumnaOrdenableCatalogo>("grupo")
  const [direccionOrden, setDireccionOrden] = useState<Direccion>("asc")

  const [pagina, setPagina] = useState(1)
  const [categoriaEditando, setCategoriaEditando] = useState<CategoriaRecursoFila | null>(null)
  const [agregando, setAgregando] = useState(false)

  useEffect(() => {
    async function fetchCategorias() {
      setLoading(true)
      const supabase = createClient()
      // Por páginas (traerTodo): ver lib/supabase/traer-todo.ts. `id` al
      // final del orden para que las páginas sean estables (grupo se repite).
      let data: CategoriaRecursoFila[]
      try {
        data = await traerTodo<CategoriaRecursoFila>((desde, hasta) =>
          supabase
            .from(tabla)
            .select("id, grupo, categoria, unidad, valor_unitario")
            .order("grupo")
            .order("id")
            .range(desde, hasta)
        )
      } catch (error) {
        console.error(`Error obteniendo categorías de ${tabla}:`, error)
        setLoading(false)
        return
      }
      setCategorias(data ?? [])
      setLoading(false)
    }
    fetchCategorias()
  }, [tabla])

  const grupos = useMemo(
    () => Array.from(new Set(categorias.map((c) => c.grupo).filter((v): v is string => !!v))).sort(),
    [categorias]
  )
  const unidades = useMemo(
    () => Array.from(new Set(categorias.map((c) => c.unidad).filter((v): v is string => !!v))).sort(),
    [categorias]
  )
  const unidadesParaDialogo = unidades.length > 0 ? unidades : unidadesSugeridas

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
      if (!termino || termino === COMODIN_LISTAR) return true
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

  function handleGuardado(actualizada: CategoriaRecursoFila) {
    setCategorias((prev) => prev.map((c) => (c.id === actualizada.id ? actualizada : c)))
    setCategoriaEditando(null)
  }

  function handleCreada(nueva: CategoriaRecursoFila) {
    setCategorias((prev) => [nueva, ...prev])
    setAgregando(false)
  }

  // Mismo diseño que Proveedores (components/tabla-excel.tsx). La edición
  // sigue siendo con el diálogo de siempre: doble clic en la fila, o el
  // botón "Editar" (el doble clic no existe en pantallas táctiles).
  const botonEditar = (c: CategoriaRecursoFila) => (
    <button
      type="button"
      onClick={() => setCategoriaEditando(c)}
      aria-label={`Editar ${c.categoria}`}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
    >
      <Pencil className="size-3.5" /> Editar
    </button>
  )
  const columnasTabla: ColumnaExcel<CategoriaRecursoFila>[] = [
    { clave: "categoria", titulo: "Categoría", ancho: 340, fija: true, flexible: true, texto: (c) => c.categoria },
    { clave: "grupo", titulo: "Grupo", ancho: 240, texto: (c) => c.grupo ?? "" },
    { clave: "unidad", titulo: "Unidad", ancho: 110, alinear: "center", texto: (c) => c.unidad },
    { clave: "valor_unitario", titulo: "Valor", ancho: 160, alinear: "right", texto: (c) => formatearMoneda(c.valor_unitario), claseCelda: "tabular-nums" },
    { clave: "acciones", titulo: "", ancho: 96, alinear: "center", ordenable: false, texto: () => "", celda: botonEditar },
  ]
  const claseFiltro = "h-9 w-auto max-w-[16rem] rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <div className="space-y-4">
      {!loading && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por categoría o grupo…"
              className="h-9 w-full rounded-md border bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <select value={filtroGrupo} onChange={(e) => setFiltroGrupo(e.target.value)} className={claseFiltro} aria-label="Filtrar por grupo">
            <option value="todos">Todos los grupos</option>
            {grupos.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <select value={filtroUnidad} onChange={(e) => setFiltroUnidad(e.target.value)} className={claseFiltro} aria-label="Filtrar por unidad">
            <option value="todos">Todas las unidades</option>
            {unidades.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          {hayFiltrosActivos && (
            <button onClick={limpiarFiltros} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <X className="size-3.5" />
              Quitar filtros
            </button>
          )}

          <span className="text-xs text-muted-foreground tabular-nums sm:ml-auto">
            {`${filasProcesadas.length.toLocaleString("es-CO")} de ${categorias.length.toLocaleString("es-CO")} categorías`}
          </span>

          <Button size="sm" className="gap-1.5" onClick={() => setAgregando(true)}>
            <Plus className="size-4" /> Agregar categoría
          </Button>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && filasPagina.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No hay categorías que coincidan con la búsqueda o los filtros.
        </div>
      )}

      {!loading && filasPagina.length > 0 && (
        <TablaExcel
          filas={filasPagina}
          columnas={columnasTabla}
          claveFila={(c) => c.id}
          orden={{ clave: columnaOrden, dir: direccionOrden }}
          onOrdenar={(clave) => alternarOrden(clave as ColumnaOrdenableCatalogo)}
          onDobleClickFila={setCategoriaEditando}
          tituloFila="Doble clic para editar esta categoría"
          claseAltoMax="max-h-[calc(100svh-20rem)]"
          tarjeta={{
            titulo: (c) => c.categoria,
            subtitulo: (c) => c.grupo ?? "Sin grupo",
            esquina: botonEditar,
            campos: ["unidad", "valor_unitario"],
          }}
        />
      )}

      {!loading && <PaginacionExcel pagina={paginaActual} totalPaginas={totalPaginas} onCambiar={setPagina} />}

      {categoriaEditando && (
        <EditarCategoriaRecursoDialog
          tabla={tabla}
          categoria={categoriaEditando}
          gruposConocidos={grupos}
          unidadesConocidas={unidadesParaDialogo}
          onCerrar={() => setCategoriaEditando(null)}
          onGuardado={handleGuardado}
        />
      )}

      {agregando && (
        <AgregarCategoriaRecursoDialog
          tabla={tabla}
          gruposConocidos={grupos}
          unidadesConocidas={unidadesParaDialogo}
          onCerrar={() => setAgregando(false)}
          onCreada={handleCreada}
        />
      )}
    </div>
  )
}

// Escribir en los catálogos exige la acción aprobar_mano_obra (política RLS,
// migración 20261005100000_seguridad_catalogos.sql). Cuando RLS bloquea, la
// base no da un error claro: un UPDATE con .single() devuelve PGRST116 (0
// filas) y un INSERT devuelve 42501. Se traducen a un mensaje entendible.
function mensajeErrorCatalogo(error: { code?: string; message: string }): string {
  if (error.code === "PGRST116" || error.code === "42501") {
    return "No tienes permiso para modificar este catálogo. Se necesita la acción \"Aprobar mano de obra y equipos\"."
  }
  return error.message
}

// ---------------------------------------------------------------------------
// Diálogo de edición del catálogo -- mismo patrón que
// EditarInsumoDialog en /maestro-insumos: escribe directo a Supabase
// desde el cliente (la RLS de mano_obra_categorias/equipo_categorias ya
// permite lectura/escritura a cualquier autenticado). Parametrizado por
// `tabla` -- antes era EditarCategoriaManoObraDialog, hardcodeado.
// ---------------------------------------------------------------------------

function EditarCategoriaRecursoDialog({
  tabla,
  categoria,
  gruposConocidos,
  unidadesConocidas,
  onCerrar,
  onGuardado,
}: {
  tabla: "mano_obra_categorias" | "equipo_categorias"
  categoria: CategoriaRecursoFila
  gruposConocidos: string[]
  unidadesConocidas: string[]
  onCerrar: () => void
  onGuardado: (actualizada: CategoriaRecursoFila) => void
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
        .from(tabla)
        .update({
          categoria: categoriaTexto.trim(),
          grupo: grupo.trim() || null,
          unidad: unidad.trim().toUpperCase(),
          valor_unitario: valorNum,
        })
        .eq("id", categoria.id)
        .select("id, grupo, categoria, unidad, valor_unitario")
        .single()

      if (errorUpdate) throw new Error(mensajeErrorCatalogo(errorUpdate))

      onGuardado(data as CategoriaRecursoFila)
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
          <DialogTitle>Editar categoría</DialogTitle>
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
                list="grupos-conocidos-recurso-catalogo"
                value={grupo}
                onChange={(e) => setGrupo(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="grupos-conocidos-recurso-catalogo">
                {gruposConocidos.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Unidad</label>
              <input
                list="unidades-conocidas-recurso-catalogo"
                value={unidad}
                onChange={(e) => setUnidad(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="unidades-conocidas-recurso-catalogo">
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
// ---------------------------------------------------------------------------
// Diálogo de CREACIÓN -- hermano de EditarCategoriaRecursoDialog, mismos
// campos y misma validación, pero .insert() en vez de .update() y sin
// un `categoria` de partida (arranca todo vacío). Se separan en dos
// componentes en vez de meter un modo "crear/editar" adentro de uno
// solo porque la app ya tiene el patrón EditarXDialog/AgregarXDialog
// como componentes hermanos en otras pantallas (ver BuscadorInsumoCategoria
// en apu-editor-dialog.tsx) -- mantiene cada uno enfocado en un solo caso.
// ---------------------------------------------------------------------------

function AgregarCategoriaRecursoDialog({
  tabla,
  gruposConocidos,
  unidadesConocidas,
  onCerrar,
  onCreada,
}: {
  tabla: "mano_obra_categorias" | "equipo_categorias"
  gruposConocidos: string[]
  unidadesConocidas: string[]
  onCerrar: () => void
  onCreada: (nueva: CategoriaRecursoFila) => void
}) {
  const [categoriaTexto, setCategoriaTexto] = useState("")
  const [grupo, setGrupo] = useState("")
  const [unidad, setUnidad] = useState("")
  const [valorUnitario, setValorUnitario] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCrear() {
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
      const { data, error: errorInsert } = await supabase
        .from(tabla)
        .insert({
          categoria: categoriaTexto.trim(),
          grupo: grupo.trim() || null,
          unidad: unidad.trim().toUpperCase(),
          valor_unitario: valorNum,
        })
        .select("id, grupo, categoria, unidad, valor_unitario")
        .single()

      if (errorInsert) throw new Error(mensajeErrorCatalogo(errorInsert))

      onCreada(data as CategoriaRecursoFila)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la categoría.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && !guardando && onCerrar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar categoría</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Categoría</label>
            <textarea
              value={categoriaTexto}
              onChange={(e) => setCategoriaTexto(e.target.value)}
              rows={2}
              autoFocus
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Grupo</label>
              <input
                list="grupos-conocidos-recurso-nuevo"
                value={grupo}
                onChange={(e) => setGrupo(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="grupos-conocidos-recurso-nuevo">
                {gruposConocidos.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Unidad</label>
              <input
                list="unidades-conocidas-recurso-nuevo"
                value={unidad}
                onChange={(e) => setUnidad(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id="unidades-conocidas-recurso-nuevo">
                {unidadesConocidas.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Valor (opcional)</label>
              <input
                type="number"
                value={valorUnitario}
                onChange={(e) => setValorUnitario(e.target.value)}
                placeholder="se puede dejar en blanco"
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
            onClick={handleCrear}
            disabled={guardando}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {guardando ? "Creando…" : "Crear categoría"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}