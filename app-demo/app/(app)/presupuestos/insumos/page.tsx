"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { ArrowUp, ArrowDown, ArrowUpDown, Search, X } from "lucide-react"
import { SidebarTrigger } from "@/components/ui/sidebar"

interface Insumo {
  id: string
  codigo: number
  descripcion: string
  tipo: string | null
  u_m: string | null
  agrupacion: string | null
  // Precio base que precios_efectivos_insumos usa como respaldo cuando el
  // insumo no tiene historial de compras -- ya NO se edita desde acá
  // (decisión de negocio: esta pantalla pasó a ser de solo consulta; el
  // respaldo se fija al crear el insumo, vía el flujo de "solicitar
  // insumo nuevo" al armar un APU). Se sigue trayendo únicamente como
  // fallback local, por si el RPC de abajo no devuelve fila para este id.
  vr_unitario: number | null
  // Campo calculado del lado del cliente -- NO existe en maestro_insumos.
  // null mientras todavía no se ha calculado (ver fetchPreciosEfectivos).
  precioEfectivo: number | null
}

type ColumnaOrdenable = "codigo" | "descripcion" | "tipo" | "u_m" | "agrupacion" | "precioEfectivo"
type Direccion = "asc" | "desc"

const FILAS_POR_PAGINA = 50

// precios_efectivos_insumos no está pensado para recibir miles de ids de
// una sola vez -- se pide en lotes, en paralelo (mismo criterio que ya
// usa matchearYGuardarImportApu en presupuestos/actions.ts).
const TAMANO_LOTE_PRECIOS_EFECTIVOS = 200

const COLUMNAS: { key: ColumnaOrdenable; label: string; alinear?: "right" }[] = [
  { key: "codigo", label: "Código" },
  { key: "descripcion", label: "Descripción" },
  { key: "tipo", label: "Tipo" },
  { key: "u_m", label: "U.M." },
  { key: "agrupacion", label: "Agrupación" },
  // Promedio de compra si el insumo tiene historial, o el precio de
  // respaldo si no -- se recalcula cada vez que se abre esta pantalla.
  { key: "precioEfectivo", label: "Valor unitario", alinear: "right" },
]

export default function MaestroInsumos() {
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const [loading, setLoading] = useState(true)
  const [cargandoPreciosEfectivos, setCargandoPreciosEfectivos] = useState(false)

  const [busqueda, setBusqueda] = useState("")
  const [filtroTipo, setFiltroTipo] = useState("todos")
  const [filtroUM, setFiltroUM] = useState("todos")
  const [filtroAgrupacion, setFiltroAgrupacion] = useState("todos")

  const [columnaOrden, setColumnaOrden] = useState<ColumnaOrdenable>("codigo")
  const [direccionOrden, setDireccionOrden] = useState<Direccion>("asc")

  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    async function fetchInsumos() {
      const supabase = createClient()

      const { data, error } = await supabase
        .from("maestro_insumos")
        .select("id, codigo, descripcion, tipo, u_m, agrupacion, vr_unitario")
        .order("codigo")

      if (error) {
        console.error("Error obteniendo insumos:", error)
        setLoading(false)
        return
      }

      setInsumos((data ?? []).map((i) => ({ ...i, precioEfectivo: null })))
      setLoading(false)
    }

    fetchInsumos()
  }, [])

  // Calcula el precio EFECTIVO de todos los insumos apenas termina de
  // cargar la lista base. La dependencia es la CANTIDAD de filas, no el
  // array completo -- así, cuando este mismo efecto actualiza `insumos`
  // más abajo (sin cambiar su longitud), no se vuelve a disparar a sí
  // mismo en un loop.
  useEffect(() => {
    if (insumos.length === 0) return
    let cancelado = false

    async function fetchPreciosEfectivos() {
      setCargandoPreciosEfectivos(true)
      const supabase = createClient()
      const ids = insumos.map((i) => i.id)

      const lotes: string[][] = []
      for (let i = 0; i < ids.length; i += TAMANO_LOTE_PRECIOS_EFECTIVOS) {
        lotes.push(ids.slice(i, i + TAMANO_LOTE_PRECIOS_EFECTIVOS))
      }

      const precioPorId = new Map<string, number | null>()
      try {
        const resultados = await Promise.all(
          lotes.map((lote) => supabase.rpc("precios_efectivos_insumos", { p_insumo_ids: lote }))
        )
        for (const { data, error } of resultados) {
          if (error) throw new Error(error.message)
          for (const fila of data ?? []) {
            precioPorId.set(fila.insumo_id as string, fila.precio_efectivo as number | null)
          }
        }
      } catch (e) {
        // Si falla, cada insumo cae a su propio vr_unitario abajo -- no se
        // bloquea la tabla completa por un error de este cálculo.
        console.error("No se pudieron cargar los precios efectivos:", e)
      }

      if (cancelado) return
      setInsumos((prev) =>
        prev.map((i) => ({
          ...i,
          precioEfectivo: precioPorId.has(i.id) ? (precioPorId.get(i.id) as number | null) : i.vr_unitario,
        }))
      )
      setCargandoPreciosEfectivos(false)
    }

    fetchPreciosEfectivos()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insumos.length])

  // opciones únicas para los selects de filtro, calculadas de los datos reales
  const tipos = useMemo(
    () => Array.from(new Set(insumos.map((i) => i.tipo).filter((v): v is string => !!v))).sort(),
    [insumos]
  )
  const unidades = useMemo(
    () => Array.from(new Set(insumos.map((i) => i.u_m).filter((v): v is string => !!v))).sort(),
    [insumos]
  )
  const agrupaciones = useMemo(
    () => Array.from(new Set(insumos.map((i) => i.agrupacion).filter((v): v is string => !!v))).sort(),
    [insumos]
  )

  const hayFiltrosActivos =
    busqueda !== "" || filtroTipo !== "todos" || filtroUM !== "todos" || filtroAgrupacion !== "todos"

  function limpiarFiltros() {
    setBusqueda("")
    setFiltroTipo("todos")
    setFiltroUM("todos")
    setFiltroAgrupacion("todos")
  }

  // filtrado + búsqueda + orden, todo en un solo memo
  const filasProcesadas = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()

    const filtradas = insumos.filter((insumo) => {
      if (filtroTipo !== "todos" && insumo.tipo !== filtroTipo) return false
      if (filtroUM !== "todos" && insumo.u_m !== filtroUM) return false
      if (filtroAgrupacion !== "todos" && insumo.agrupacion !== filtroAgrupacion) return false

      if (!termino) return true
      return (
        insumo.descripcion.toLowerCase().includes(termino) ||
        String(insumo.codigo).includes(termino) ||
        (insumo.tipo ?? "").toLowerCase().includes(termino) ||
        (insumo.agrupacion ?? "").toLowerCase().includes(termino)
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
  }, [insumos, busqueda, filtroTipo, filtroUM, filtroAgrupacion, columnaOrden, direccionOrden])

  // volver a la página 1 cada vez que cambian filtros/búsqueda/orden
  useEffect(() => {
    setPagina(1)
  }, [busqueda, filtroTipo, filtroUM, filtroAgrupacion, columnaOrden, direccionOrden])

  const totalPaginas = Math.max(1, Math.ceil(filasProcesadas.length / FILAS_POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const filasPagina = filasProcesadas.slice(
    (paginaActual - 1) * FILAS_POR_PAGINA,
    paginaActual * FILAS_POR_PAGINA
  )

  function alternarOrden(columna: ColumnaOrdenable) {
    if (columnaOrden === columna) {
      setDireccionOrden((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setColumnaOrden(columna)
      setDireccionOrden("asc")
    }
  }

  function formatearMoneda(valor: number | null) {
    if (valor === null) return "—"
    return valor.toLocaleString("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    })
  }

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
      <div>
        <h1 className="text-3xl font-semibold">Maestro de Insumos</h1>
        <p className="mt-1 text-muted-foreground">
          {loading
            ? "Consultando insumos disponibles..."
            : `${filasProcesadas.length.toLocaleString("es-CO")} de ${insumos.length.toLocaleString("es-CO")} insumos -- valor unitario vigente (promedio de compra real, o precio de respaldo si el insumo no tiene historial)`}
        </p>
      </div>
      </header>

      {/* Barra de búsqueda + filtros */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por código o descripción..."
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="todos">Todos los tipos</option>
            {tipos.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={filtroUM}
            onChange={(e) => setFiltroUM(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="todos">Todas las U.M.</option>
            {unidades.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          <select
            value={filtroAgrupacion}
            onChange={(e) => setFiltroAgrupacion(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="todos">Todas las agrupaciones</option>
            {agrupaciones.map((a) => (
              <option key={a} value={a}>
                {a}
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

      {/* Loading */}
      {loading && <p className="text-sm text-muted-foreground">Cargando insumos...</p>}

      {/* Tabla -- de solo consulta, sin edición desde acá */}
      {!loading && (
        <>
          <div className="overflow-hidden rounded-xl border">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                  <tr>
                    {COLUMNAS.map((col) => (
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
                  {filasPagina.map((insumo, idx) => (
                    <tr
                      key={insumo.id}
                      className={`border-b last:border-b-0 ${idx % 2 === 1 ? "bg-muted/10" : ""}`}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {insumo.codigo}
                      </td>
                      <td className="px-4 py-2.5">{insumo.descripcion}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{insumo.tipo ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{insumo.u_m ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{insumo.agrupacion ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono">
                        {cargandoPreciosEfectivos && insumo.precioEfectivo === null ? (
                          <span className="text-muted-foreground">…</span>
                        ) : (
                          formatearMoneda(insumo.precioEfectivo)
                        )}
                      </td>
                    </tr>
                  ))}

                  {filasPagina.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNAS.length} className="px-4 py-10 text-center text-muted-foreground">
                        No hay insumos que coincidan con la búsqueda o los filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Paginación */}
          {filasProcesadas.length > FILAS_POR_PAGINA && (
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
    </div>
  )
}